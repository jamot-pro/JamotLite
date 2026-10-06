import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * Interviews (RUNTIME D61): Jamot learns what it needs from a person by
 * talking with them. The founder's charter at setup and a newcomer's welcome
 * are the same engine with a different definition.
 *
 * A definition is a YAML file — a goal, the facts to gather, the skills to
 * follow — and skills are `SKILL.md` files (the agentskills format, §8b).
 * Changing what an interview asks is editing those files, never code. Each
 * turn is one model call that answers with JSON: the facts so far and what
 * to say next. Code keeps the facts honest — only known fields, clipped,
 * strings — and decides when the interview is complete. If the model fails,
 * the interview carries on with plain questions, so it never gets stuck.
 */

export const InterviewField = z.object({
	id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
	label: z.string().min(1),
	required: z.boolean().default(false),
	hint: z.string().default(""),
	/** "lines": one item per line (goals, rules). */
	kind: z.enum(["text", "lines"]).default("text"),
	max: z.number().int().min(20).max(4000).default(1000),
});
export type InterviewField = z.infer<typeof InterviewField>;

export const InterviewDefinition = z.object({
	id: z.string().regex(/^[a-z][a-z0-9-]*$/),
	name: z.string().min(1),
	goal: z.string().min(10),
	/** The first message; `{name}`, `{company}`… are filled from the context. */
	opening: z.string().optional(),
	skills: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).default([]),
	maxTurns: z.number().int().min(3).max(60).default(25),
	fields: z.array(InterviewField).min(1),
});
export type InterviewDefinition = z.infer<typeof InterviewDefinition>;

export interface Skill {
	name: string;
	description: string;
	body: string;
}

/** A definition with its skills, ready to run. */
export interface Interview {
	definition: InterviewDefinition;
	skills: Skill[];
}

export interface InterviewMessage {
	from: "person" | "jamot";
	text: string;
	at: string;
}

export interface InterviewState {
	interview: string;
	status: "asking" | "complete";
	facts: Record<string, string>;
	messages: InterviewMessage[];
	/** Model turns used. */
	turns: number;
}

export interface InterviewDeps {
	/** One question to the model; its text answer. */
	ask: (input: { system: string; prompt: string }) => Promise<string>;
	now?: () => Date;
	/**
	 * Told why a turn fell back to a plain question: the model's error, or
	 * the shape of a bad answer — never what the person said.
	 */
	log?: (message: string) => void;
}

export class InterviewError extends Error {}

/** The longest message a person can send; the most messages kept. */
export const INTERVIEW_LIMITS = { message: 2000, messages: 200, recent: 30 };

const frontmatter = (text: string) => {
	const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(
		text.replace(/\r\n/g, "\n"),
	);
	if (!m) return { data: {} as Record<string, unknown>, body: text.trim() };
	return {
		data: (parseYaml(m[1] ?? "") ?? {}) as Record<string, unknown>,
		body: (m[2] ?? "").trim(),
	};
};

/**
 * Loads an interview by id from the first folder that has it (a company's
 * own `interviews/` first, then the built-in one). Its skills are looked up
 * the same way, in each folder's `skills/<name>/SKILL.md`.
 */
export function loadInterview(id: string, dirs: string[]): Interview {
	const file = dirs
		.map((d) => join(d, `${id}.yaml`))
		.find((f) => existsSync(f));
	if (!file) throw new InterviewError(`there's no interview "${id}"`);
	const parsed = InterviewDefinition.safeParse(
		parseYaml(readFileSync(file, "utf8")),
	);
	if (!parsed.success)
		throw new InterviewError(
			`${file}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
		);
	const definition = parsed.data;
	const ids = new Set<string>();
	for (const f of definition.fields) {
		if (ids.has(f.id))
			throw new InterviewError(`${file}: the field "${f.id}" is there twice`);
		ids.add(f.id);
	}
	const skills = definition.skills.map((name) => {
		const path = dirs
			.map((d) => join(d, "skills", name, "SKILL.md"))
			.find((f) => existsSync(f));
		if (!path) throw new InterviewError(`${file}: there's no skill "${name}"`);
		const { data, body } = frontmatter(readFileSync(path, "utf8"));
		return {
			name,
			description: typeof data.description === "string" ? data.description : "",
			body,
		};
	});
	return { definition, skills };
}

/** Required facts not gathered yet. */
export const missingFacts = (interview: Interview, state: InterviewState) =>
	interview.definition.fields.filter((f) => f.required && !state.facts[f.id]);

const fill = (text: string, context: Record<string, string>) =>
	text.replace(/\{(\w+)\}/g, (all, key: string) => context[key] ?? all);

/**
 * A new interview, with its opening said. `facts` are what's known already
 * (the founder's name from Telegram); `context` fills the opening.
 */
export function startInterview(
	interview: Interview,
	opts: {
		facts?: Record<string, string>;
		context?: Record<string, string>;
		now?: Date;
	} = {},
): InterviewState {
	const fields = new Set(interview.definition.fields.map((f) => f.id));
	const facts = Object.fromEntries(
		Object.entries(opts.facts ?? {}).filter(([k, v]) => fields.has(k) && v),
	);
	const opening = interview.definition.opening
		? fill(interview.definition.opening, opts.context ?? {}).trim()
		: plainQuestion(interview, { facts } as InterviewState);
	return {
		interview: interview.definition.id,
		status: "asking",
		facts,
		messages: [
			{
				from: "jamot",
				text: opening,
				at: (opts.now ?? new Date()).toISOString(),
			},
		],
		turns: 0,
	};
}

const RULES = `You are Jamot, holding a conversation to learn what a company needs to know from a person.

How you reply: ONLY a JSON object, no prose around it:
{"facts": {"<field id>": "<value>"}, "say": "<your next message to the person>", "complete": false}

- "facts": every field you can fill or correct from the conversation so far, in the person's words, tidied. A "lines" field is one item per line. Leave out fields you know nothing about. Never invent a fact.
- "say": one message to the person: one question, or a short summary and a request to confirm.
- "complete": true only when every required field is clear and the person has confirmed your summary, or said it's enough.`;

/** The prompt for one turn: the facts, where they stand, and the conversation. */
function turnPrompt(interview: Interview, state: InterviewState) {
	const d = interview.definition;
	const recent = state.messages.slice(-INTERVIEW_LIMITS.recent);
	return {
		system: [
			RULES,
			"",
			`Your goal: ${d.goal}`,
			...interview.skills.flatMap((s) => ["", `## Skill: ${s.name}`, s.body]),
		].join("\n"),
		prompt: [
			"The facts to gather:",
			...d.fields.map(
				(f) =>
					`- ${f.id}${f.required ? " (required)" : ""}${f.kind === "lines" ? " (lines)" : ""}: ${f.label}${f.hint ? ` — ${f.hint}` : ""}\n  so far: ${state.facts[f.id] ? JSON.stringify(state.facts[f.id]) : "(nothing yet)"}`,
			),
			"",
			"The conversation so far:",
			...recent.map(
				(m) => `${m.from === "person" ? "Person" : "You"}: ${m.text}`,
			),
			"",
			`Turn ${state.turns + 1} of ${d.maxTurns}.${state.turns + 1 >= d.maxTurns ? " This is the last turn: sum up and ask them to confirm." : ""}`,
		].join("\n"),
	};
}

const Reply = z.object({
	facts: z.record(z.string(), z.unknown()).default({}),
	say: z.string().min(1),
	complete: z.boolean().default(false),
});

/** The JSON object in a model's answer, or null. Tolerates code fences and prose. */
export function jsonIn(text: string): unknown {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	try {
		return JSON.parse(text.slice(start, end + 1));
	} catch {
		return null;
	}
}

/** What to ask when the model can't: the next required fact, plainly. */
function plainQuestion(interview: Interview, state: InterviewState): string {
	const next =
		missingFacts(interview, state)[0] ??
		interview.definition.fields.find((f) => !state.facts[f.id]);
	if (!next)
		return "I think I have what I need. Is there anything you'd like to change?";
	return `${next.label}?${next.hint ? ` (${next.hint})` : ""}`;
}

/** Keeps only known fields, as clipped strings. */
function cleanFacts(interview: Interview, raw: Record<string, unknown>) {
	const out: Record<string, string> = {};
	for (const f of interview.definition.fields) {
		const v = raw[f.id];
		const s = Array.isArray(v)
			? v
					.map((x) => String(x).trim())
					.filter(Boolean)
					.join("\n")
			: typeof v === "string" || typeof v === "number"
				? String(v).trim()
				: "";
		if (s) out[f.id] = s.slice(0, f.max);
	}
	return out;
}

/** "That's enough": the interview ends if the required facts are there. */
export const ENOUGH =
	/^\s*(\/done|that'?s (enough|it|all)|enough|done)\s*[.!]?\s*$/i;

/**
 * The person said something: one turn. Returns the new state (the input
 * isn't changed) and what Jamot says back. A complete interview can go on —
 * the person correcting something after the summary — and stays complete.
 */
export async function interviewTurn(
	deps: InterviewDeps,
	interview: Interview,
	state: InterviewState,
	text: string,
): Promise<{ state: InterviewState; reply: string }> {
	const said = text.trim();
	if (!said) throw new InterviewError("Say something first.");
	if (said.length > INTERVIEW_LIMITS.message)
		throw new InterviewError(
			`Keep it under ${INTERVIEW_LIMITS.message} characters: you can say more in the next message.`,
		);
	const now = (deps.now?.() ?? new Date()).toISOString();
	const next: InterviewState = {
		...state,
		facts: { ...state.facts },
		messages: [...state.messages, { from: "person", text: said, at: now }],
	};
	const d = interview.definition;

	let reply: string;
	if (ENOUGH.test(said)) {
		reply = finishAsking(interview, next);
	} else if (next.turns >= d.maxTurns) {
		// The model's budget is spent: plain questions until the required are in.
		reply = finishAsking(interview, next);
	} else {
		next.turns++;
		const answer = await modelTurn(deps, interview, next);
		if (answer) {
			Object.assign(next.facts, cleanFacts(interview, answer.facts));
			reply = answer.say.trim();
			if (answer.complete && missingFacts(interview, next).length === 0)
				next.status = "complete";
		} else {
			reply = plainQuestion(interview, next);
		}
	}
	next.messages.push({ from: "jamot", text: reply, at: now });
	next.messages = next.messages.slice(-INTERVIEW_LIMITS.messages);
	return { state: next, reply };
}

/** Ends the asking when the required facts are in; otherwise asks for them. */
function finishAsking(interview: Interview, state: InterviewState): string {
	const missing = missingFacts(interview, state);
	if (missing.length === 0) {
		state.status = "complete";
		return "Thank you, that's what I need.";
	}
	return `Almost there — I still need: ${missing.map((f) => f.label.toLowerCase()).join("; ")}. ${plainQuestion(interview, state)}`;
}

/** One model call, asked once more if the answer isn't usable. */
async function modelTurn(
	deps: InterviewDeps,
	interview: Interview,
	state: InterviewState,
): Promise<z.infer<typeof Reply> | null> {
	const { system, prompt } = turnPrompt(interview, state);
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const text = await deps.ask({
				system,
				prompt:
					attempt === 0
						? prompt
						: `${prompt}\n\nYour last answer wasn't the JSON object asked for. Reply with the JSON object only.`,
			});
			const json = jsonIn(text);
			const parsed = Reply.safeParse(json);
			if (parsed.success) return parsed.data;
			deps.log?.(
				json === null
					? `[interview] ${interview.definition.id}: the model's answer wasn't JSON (${text.length} characters)`
					: `[interview] ${interview.definition.id}: the model's answer didn't fit: ${parsed.error.issues
							.slice(0, 3)
							.map((i) => `${i.path.join(".") || "(top)"} ${i.message}`)
							.join("; ")}`,
			);
		} catch (err) {
			// The model is down or refused: plain questions carry on, and the
			// log says why.
			deps.log?.(
				`[interview] ${interview.definition.id}: the model failed: ${err instanceof Error ? err.message : err}`,
			);
			return null;
		}
	}
	return null;
}

/** The facts as a short text, in the definition's order. */
export function factsText(interview: Interview, state: InterviewState): string {
	return interview.definition.fields
		.filter((f) => state.facts[f.id])
		.map((f) =>
			f.kind === "lines"
				? `${f.label}:\n${(state.facts[f.id] ?? "")
						.split("\n")
						.map((l) => `• ${l}`)
						.join("\n")}`
				: `${f.label}: ${state.facts[f.id]}`,
		)
		.join("\n");
}
