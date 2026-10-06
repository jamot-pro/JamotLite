import { complete, type ModelAccess } from "@jamot/brain";
import {
	type CompanyEdge,
	CompanyFile,
	type CompanyNode,
	DreamConfig,
	type SetupDraft,
} from "@jamot/contracts";
import { jsonIn } from "@jamot/core";
import { z } from "zod";
import { lines } from "./questions.js";

/**
 * Drafting the company from the founder's answers (RUNTIME D56).
 *
 * One model call turns the answers into a plan — teams, responsibilities and
 * who owns each (the founder, an agent, a person they named, or open for an
 * invitation), agents with their instructions, the people named. The plan is
 * checked and clamped here, then code builds the company file from it:
 * heartbeats are generated so every team and the charter are watched, tools
 * come from the closest template (never invented), and the file must pass
 * the company-file schema. The model proposes; the founder reviews it before
 * anything exists.
 */

export const LIMITS = { teams: 4, agents: 4, people: 6, responsibilities: 8 };

export interface Template {
	id: string;
	name: string;
	summary: string;
	file: CompanyFile;
}

export interface Draft {
	file: CompanyFile;
	view: SetupDraft;
}

export const Plan = z.object({
	template: z.string(),
	summary: z.string().default(""),
	vision: z.string().nullable().default(null),
	mission: z.string(),
	values: z.array(z.string()).default([]),
	goals: z.array(z.string()).default([]),
	teams: z
		.array(
			z.object({
				key: z.string(),
				name: z.string(),
				purpose: z.string().default(""),
			}),
		)
		.min(1),
	agents: z
		.array(
			z.object({
				key: z.string(),
				name: z.string(),
				role: z.string().default(""),
				instructions: z.string().default(""),
				team: z.string().nullable().default(null),
			}),
		)
		.default([]),
	people: z
		.array(
			z.object({
				key: z.string(),
				name: z.string(),
				role: z.string().default(""),
				team: z.string().nullable().default(null),
			}),
		)
		.default([]),
	responsibilities: z
		.array(
			z.object({
				key: z.string(),
				name: z.string(),
				team: z.string().nullable().default(null),
				owner: z.string().default("open"),
			}),
		)
		.min(1),
	successor: z.string().nullable().default(null),
});
export type Plan = z.infer<typeof Plan>;

const SYSTEM = `You set up companies in Jamot, an operating system for founders. From the founder's answers, plan their company and reply with ONLY a JSON object, no prose:

{
  "template": "<id of the closest template from the list>",
  "summary": "<one line about the company>",
  "vision": "<the world it builds toward, in the founder's words, or null>",
  "mission": "<what it does and for whom, in the founder's words>",
  "values": ["<rules it never breaks>"],
  "goals": ["<what success looks like in three months>"],
  "teams": [{ "key": "kebab-key", "name": "...", "purpose": "..." }],
  "agents": [{ "key": "kebab-key", "name": "...", "role": "...", "instructions": "...", "team": "<team key>" }],
  "people": [{ "key": "kebab-key", "name": "...", "role": "...", "team": "<team key>" }],
  "responsibilities": [{ "key": "r-kebab-key", "name": "...", "team": "<team key>", "owner": "founder" | "<agent key>" | "<person key>" | "open" }],
  "successor": "<the name the founder gave, or null>"
}

Rules:
- Keep the founder's own words for vision, mission, values and goals; tidy them, don't invent new ones.
- 1 to ${LIMITS.teams} teams, 1 to ${LIMITS.agents} agents, 3 to ${LIMITS.responsibilities} responsibilities. Small is better.
- People: only those the founder named. Never invent a person or a name.
- Roles the founder wishes they had become responsibilities with owner "open": they will invite someone.
- What the founder doesn't want to do goes to an agent when an agent can do it: answering, drafting, reminding, monitoring, research, bookkeeping drafts. Money, contracts, hiring, physical work and legal decisions stay with people.
- Every agent's instructions say what it does and end with: "Propose; never pay, sign, hire or promise anything without the owner's approval."
- Use the founder's language for names.`;

/** Asks the model for a plan; returns null when it can't give a usable one. */
async function askModel(
	model: ModelAccess,
	answers: Record<string, string>,
	templates: Template[],
	opts: DraftOptions,
): Promise<Plan | null> {
	const system = opts.rules ? `${SYSTEM}\n\n${opts.rules}` : SYSTEM;
	const prompt = [
		"The founder's answers:",
		JSON.stringify(answers, null, 1),
		"",
		"Templates to start from (id — name: summary):",
		...templates.map((t) => `${t.id} — ${t.name}: ${t.summary}`),
	].join("\n");
	for (let attempt = 0; attempt < 2; attempt++) {
		// A model error (a wrong key, an outage) is thrown: the founder is told.
		const text = await complete(model, {
			system,
			prompt:
				attempt === 0
					? prompt
					: `${prompt}\n\nYour last answer wasn't the JSON object asked for. Reply with the JSON object only.`,
		});
		const json = jsonIn(text);
		const plan = Plan.safeParse(json);
		if (plan.success) return plan.data;
		// Why, without the founder's words: the shape, never the content.
		opts.log?.(
			json === null
				? `[setup] the model's draft wasn't JSON (${text.length} characters)`
				: `[setup] the model's draft didn't fit: ${plan.error.issues
						.slice(0, 5)
						.map((i) => `${i.path.join(".") || "(top)"} ${i.message}`)
						.join("; ")}`,
		);
	}
	return null;
}

const keyOf = (s: string, prefix = "") => {
	const k =
		s
			.toLowerCase()
			.normalize("NFKD")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "x";
	return k.startsWith(prefix) ? k : `${prefix}${k}`;
};
const clip = (s: string, n: number) => s.trim().slice(0, n);
const LAW =
	"Propose; never pay, sign, hire or promise anything without the owner's approval.";

/** Builds a valid company file from a plan, whatever the model sent. */
export function buildCompany(
	plan: Plan,
	answers: Record<string, string>,
	templates: Template[],
	timezone?: string,
): Draft {
	const base =
		templates.find((t) => t.id === plan.template) ?? (templates[0] as Template);
	const taken = new Set<string>(["dream", "founder"]);
	const unique = (k: string) => {
		let key = k;
		for (let i = 2; taken.has(key); i++) key = `${k}-${i}`;
		taken.add(key);
		return key;
	};

	// Teams first: everyone and everything is placed in one.
	const teamKeys = new Map<string, string>();
	const teams = plan.teams.slice(0, LIMITS.teams).map((t) => {
		const key = unique(keyOf(t.key || t.name));
		teamKeys.set(t.key, key);
		return { key, name: clip(t.name, 60), purpose: clip(t.purpose, 200) };
	});
	const firstTeam = (teams[0] as { key: string }).key;
	const team = (k: string | null) => (k && teamKeys.get(k)) || firstTeam;

	// The model's keys only point at what it planned: "founder" stays the
	// founder, and the first of two equal keys wins.
	const owners = new Map<string, string>([["founder", "founder"]]);
	const claim = (planKey: string, key: string) => {
		if (!owners.has(planKey)) owners.set(planKey, key);
	};
	const agents = plan.agents.slice(0, LIMITS.agents).map((a) => {
		const key = unique(keyOf(a.key || a.name));
		claim(a.key, key);
		const instructions = clip(a.instructions, 1200);
		return {
			key,
			name: clip(a.name, 60),
			role: clip(a.role, 160),
			instructions: instructions.includes("never pay")
				? instructions
				: `${instructions} ${LAW}`.trim(),
			team: team(a.team),
		};
	});
	// Only people the founder actually named: a model never adds anyone.
	// Whole words, so "Al" isn't found inside "Laura".
	const named = new Set(
		`${answers.people ?? ""} ${answers.successor ?? ""}`
			.toLowerCase()
			.split(/[^\p{L}\p{N}'-]+/u)
			.filter(Boolean),
	);
	const people = plan.people
		.filter((p) => {
			const first = p.name.trim().toLowerCase().split(/\s+/)[0] ?? "";
			return first.length > 1 && named.has(first);
		})
		.slice(0, LIMITS.people)
		.map((p) => {
			const key = unique(keyOf(p.key || p.name));
			claim(p.key, key);
			return {
				key,
				name: clip(p.name, 80),
				role: clip(p.role, 160),
				team: team(p.team),
			};
		});
	const responsibilities = plan.responsibilities
		.slice(0, LIMITS.responsibilities)
		.map((r) => ({
			key: unique(keyOf(r.key || r.name, "r-")),
			name: clip(r.name, 80),
			team: team(r.team),
			owner: owners.get(r.owner) ?? null,
		}));

	const founderName = (answers.founder ?? "").trim() || "Founder";
	const vision = plan.vision?.trim() || answers.why?.trim() || null;
	const mission = plan.mission.trim() || (answers.what ?? "").trim();
	const values = plan.values.length ? plan.values : lines(answers.never);
	const goals = plan.goals.length ? plan.goals : lines(answers.goals);

	const pulse = unique("h-pulse");
	const teamBeats = teams.map((t) => ({
		key: unique(`h-${t.key}`),
		team: t,
	}));
	const nodes: CompanyNode[] = [
		...teams.map((t) => ({
			key: t.key,
			kind: "team" as const,
			name: t.name,
			config: { purpose: t.purpose },
		})),
		{
			key: "founder",
			kind: "human",
			name: founderName,
			config: { role: "Founder" },
		},
		...people.map((p) => ({
			key: p.key,
			kind: "human" as const,
			name: p.name,
			config: { role: p.role },
		})),
		...agents.map((a) => ({
			key: a.key,
			kind: "agent" as const,
			name: a.name,
			config: { role: a.role, instructions: a.instructions },
		})),
		...responsibilities.map((r) => ({
			key: r.key,
			kind: "responsibility" as const,
			name: r.name,
			config: {},
		})),
		// Tools come from the template: a draft never invents an integration.
		...base.file.nodes
			.filter((n) => n.kind === "tool")
			.map((n) => ({ ...n, key: unique(n.key) })),
		{
			key: pulse,
			kind: "heartbeat",
			name: "Daily pulse",
			config: {
				schedule: "0 8 * * *",
				monitors: ["open responsibilities", "people who went quiet"],
				actions: ["tell the owner what needs them today", "verify it was seen"],
			},
		},
		...teamBeats.map(({ key, team: t }) => ({
			key,
			kind: "heartbeat" as const,
			name: `${t.name}: weekly check`,
			config: {
				schedule: "0 9 * * 1",
				monitors: [`${t.name}'s responsibilities`],
				actions: ["list what's stuck", "verify someone owns each item"],
			},
		})),
	];
	const founderTeam =
		responsibilities.find((r) => r.owner === "founder")?.team ?? firstTeam;
	const edges: CompanyEdge[] = [
		{ from: "founder", relation: "member_of", to: founderTeam },
		...[...people, ...agents].map((m) => ({
			from: m.key,
			relation: "member_of" as const,
			to: m.team,
		})),
		...responsibilities.map((r) => ({
			from: "dream",
			relation: "requires" as const,
			to: r.key,
		})),
		...responsibilities.flatMap((r) =>
			r.owner
				? [{ from: r.owner, relation: "responsible_for" as const, to: r.key }]
				: [],
		),
		{ from: pulse, relation: "monitors", to: "dream" },
		...teamBeats.map(({ key, team: t }) => ({
			from: key,
			relation: "monitors" as const,
			to: t.key,
		})),
	];

	const file = CompanyFile.parse({
		format: 1,
		company: {
			id: keyOf(answers.name ?? "company"),
			name: (answers.name ?? "").trim() || base.name,
			summary: clip(plan.summary || mission, 200),
			timezone: timezone ?? base.file.company.timezone,
		},
		dream: DreamConfig.parse({
			...(vision ? { vision } : {}),
			objective: mission,
			outcomes: goals,
			constraints: values,
			requiredResponsibilities: responsibilities.map((r) => r.name),
		}),
		founder: "founder",
		nodes,
		edges,
	});

	const nameOf = (key: string) => nodes.find((n) => n.key === key)?.name ?? key;
	const isAgent = (key: string) =>
		nodes.find((n) => n.key === key)?.kind === "agent";
	return {
		file,
		view: {
			basedOn: { id: base.id, name: base.name },
			charter: { vision, mission, values, goals },
			teams: teams.map((t) => ({ name: t.name, purpose: t.purpose })),
			responsibilities: responsibilities.map((r) => ({
				name: r.name,
				team: nameOf(r.team),
				owner: !r.owner
					? { kind: "open" as const, name: null }
					: r.owner === "founder"
						? { kind: "founder" as const, name: founderName }
						: {
								kind: isAgent(r.owner)
									? ("agent" as const)
									: ("person" as const),
								name: nameOf(r.owner),
							},
			})),
			agents: agents.map((a) => ({
				name: a.name,
				role: a.role,
				team: nameOf(a.team),
			})),
			people: people.map((p) => ({ name: p.name, role: p.role })),
			successor: plan.successor?.trim() || answers.successor?.trim() || null,
		},
	};
}

/**
 * Drafts the company: asks the model for a plan and builds the file from it.
 * Throws when the model can't give a usable plan — the founder then picks a
 * template instead.
 */
export interface DraftOptions {
	/** More rules for the drafter: the charter-rules skill (D61). */
	rules?: string;
	log?: (message: string) => void;
}

export async function draftCompany(
	model: ModelAccess,
	answers: Record<string, string>,
	templates: Template[],
	timezone?: string,
	opts: DraftOptions = {},
): Promise<Draft> {
	const plan = await askModel(model, answers, templates, opts);
	if (!plan)
		throw new Error(
			"Jamot couldn't draft the company this time. Pick the closest starting point instead.",
		);
	return buildCompany(plan, answers, templates, timezone);
}
