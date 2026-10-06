import { createHash, randomBytes } from "node:crypto";
import { DreamConfig, type InviteRow } from "@jamot/contracts";
import type { CompanyPorts, CompanyStore, StoredNode } from "@jamot/ports";
import { AgentError } from "../agents/manage.js";
import { isRetired } from "../company/retired.js";
import { newHumanKey } from "./keys.js";

/**
 * Open roles and invitations (VISION.md, RUNTIME D52). A responsibility
 * nobody owns is an open role. The founder makes an invitation code for it
 * and gives it to someone they know; that person sends it to the company's
 * bot, sees the charter and the role — nothing else — and the founder says
 * yes or no. On a yes they join the company map owning the role, linked on
 * Telegram, and get a welcome that tells them how the company works.
 *
 * The agent never decides who joins: only the owner (and an acting
 * successor) can, from Telegram or the console.
 */

export const INVITES = "roles.invites";
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const KEEP_DECIDED_MS = 30 * 24 * 60 * 60 * 1000;

/** The person who used an invitation, as Telegram knows them. */
export interface Candidate {
	userId: string;
	chatId: string;
	name: string;
	/** Their @username, without the @, when they have one. */
	username?: string;
}

export interface Invite {
	id: string;
	responsibilityKey: string;
	codeHash: string;
	createdBy: string;
	createdAt: string;
	/** Until when the code can be used; a waiting invitation stays until decided. */
	expiresAt: string;
	status: "open" | "waiting" | "approved" | "declined";
	candidate?: Candidate;
	decidedBy?: string;
	decidedAt?: string;
	/** The node the candidate became, once approved. */
	nodeKey?: string;
}

type Invites = Record<string, Invite>;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Unambiguous characters only: people type this. */
function newCode(): string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	return [...randomBytes(10)]
		.map((b) => alphabet[b % alphabet.length])
		.join("");
}

const live = (inv: Invite, now = Date.now()) =>
	inv.status === "waiting" ||
	(inv.status === "open" && Date.parse(inv.expiresAt) >= now);

const owning = (relation: string) =>
	relation === "owns" || relation === "responsible_for";

async function openResponsibility(
	tx: CompanyPorts,
	key: string,
): Promise<StoredNode> {
	const r = (await tx.graph.listNodes()).find(
		(n) => n.kind === "responsibility" && n.key === key && !isRetired(n),
	);
	if (!r) throw new AgentError(`There's no responsibility "${key}".`);
	const owner = (await tx.graph.listEdges()).find(
		(e) => e.toNodeId === r.id && owning(e.relation),
	);
	if (owner)
		throw new AgentError(
			`Someone already owns ${r.name}. Let it go first (Stewards or Agents), then invite someone.`,
		);
	return r;
}

/**
 * A new invitation for an open role. The code is shown once and kept only as
 * a hash; a new one replaces an unused one for the same role.
 */
export async function createRoleInvite(
	store: CompanyStore,
	responsibilityKey: string,
	by: string,
): Promise<{ code: string; expiresAt: string }> {
	return store.transaction(async (tx) => {
		const r = await openResponsibility(tx, responsibilityKey);
		const invites = (await tx.settings.get<Invites>(INVITES)) ?? {};
		const longAgo = Date.now() - KEEP_DECIDED_MS;
		for (const inv of Object.values(invites)) {
			// Unused expired codes go, and answered invitations after a while
			// (the events keep the history).
			if (
				(inv.status === "open" && !live(inv)) ||
				Date.parse(inv.decidedAt ?? "") < longAgo
			)
				delete invites[inv.id];
			if (inv.responsibilityKey !== r.key || !live(inv)) continue;
			if (inv.status === "waiting")
				throw new AgentError(
					`${inv.candidate?.name ?? "Someone"} is waiting for your answer on ${r.name}: say yes or no first.`,
				);
			delete invites[inv.id];
		}
		const code = newCode();
		const id = randomBytes(6).toString("hex");
		const now = new Date();
		const expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString();
		invites[id] = {
			id,
			responsibilityKey: r.key,
			codeHash: sha256(code),
			createdBy: by,
			createdAt: now.toISOString(),
			expiresAt,
			status: "open",
		};
		await tx.settings.set(INVITES, invites);
		await tx.events.append({
			type: "invite.created",
			source: "console",
			subject: r.key,
			data: { by, invite: id },
			idempotencyKey: `invite-created:${id}`,
		});
		return { code, expiresAt };
	});
}

/**
 * Someone used an invitation code. Returns the invitation (now waiting for
 * the founder) and what to tell them, or null when the code is wrong, used
 * or expired.
 */
export async function acceptInvite(
	store: CompanyStore,
	code: string,
	candidate: Candidate,
): Promise<{ invite: Invite; reply: string } | null> {
	const hash = sha256(code.trim().toUpperCase());
	const invite = await store.transaction(async (tx) => {
		const invites = (await tx.settings.get<Invites>(INVITES)) ?? {};
		const inv = Object.values(invites).find(
			(i) => i.codeHash === hash && i.status === "open" && live(i),
		);
		if (!inv) return null;
		// The role may have been taken since the code was made.
		const r = (await tx.graph.listNodes()).find(
			(n) => n.kind === "responsibility" && n.key === inv.responsibilityKey,
		);
		const taken =
			!r ||
			isRetired(r) ||
			(await tx.graph.listEdges()).some(
				(e) => e.toNodeId === r.id && owning(e.relation),
			);
		if (taken) return null;
		inv.status = "waiting";
		inv.candidate = candidate;
		await tx.settings.set(INVITES, invites);
		await tx.events.append({
			type: "invite.accepted",
			source: "channel/telegram",
			subject: inv.responsibilityKey,
			data: { invite: inv.id },
			idempotencyKey: `invite-accepted:${inv.id}`,
		});
		return inv;
	});
	if (!invite) return null;
	return { invite, reply: await candidateBrief(store, invite) };
}

/**
 * The founder's yes or no. On a yes, in one transaction: the candidate
 * becomes a person of the map owning the role, and `link` (the channel's)
 * links their Telegram to them. Returns what to tell the founder.
 */
export async function decideInvite(
	store: CompanyStore,
	inviteId: string,
	approved: boolean,
	by: string,
	link?: (tx: CompanyPorts, nodeKey: string, who: Candidate) => Promise<void>,
): Promise<{ message: string; invite: Invite }> {
	return store.transaction(async (tx) => {
		const invites = (await tx.settings.get<Invites>(INVITES)) ?? {};
		const inv = invites[inviteId];
		if (inv?.status !== "waiting" || !inv.candidate)
			throw new AgentError(
				inv?.status === "approved" || inv?.status === "declined"
					? `Already ${inv.status}.`
					: "That invitation isn't waiting for an answer.",
			);
		const who = inv.candidate;
		inv.decidedBy = by;
		inv.decidedAt = new Date().toISOString();
		if (!approved) {
			inv.status = "declined";
			await tx.settings.set(INVITES, invites);
			await tx.events.append({
				type: "invite.declined",
				source: "console",
				subject: inv.responsibilityKey,
				data: { by, invite: inv.id },
				idempotencyKey: `invite-declined:${inv.id}`,
			});
			return {
				message: `Declined ${who.name}. The role is still open.`,
				invite: inv,
			};
		}
		const r = await openResponsibility(tx, inv.responsibilityKey);
		const nodes = await tx.graph.listNodes();
		const key = newHumanKey(nodes, who.name);
		const node = await tx.graph.addNode({
			key,
			kind: "human",
			name: who.name,
			config: {
				role: r.name,
				...(who.username ? { telegram: who.username } : {}),
				joinedBy: "invite",
			},
		});
		await tx.graph.addEdge({
			fromNodeId: node.id,
			toNodeId: r.id,
			relation: "responsible_for",
		});
		await link?.(tx, key, who);
		inv.status = "approved";
		inv.nodeKey = key;
		await tx.settings.set(INVITES, invites);
		await tx.events.append({
			type: "invite.approved",
			source: "console",
			subject: key,
			data: { by, invite: inv.id, responsibility: r.key },
			idempotencyKey: `invite-approved:${inv.id}`,
		});
		return {
			message: `${who.name} joined and now owns ${r.name}. They have their welcome on Telegram.`,
			invite: inv,
		};
	});
}

/** The invitations the Stewards page shows: unused codes and people waiting. */
export async function invitesView(store: CompanyStore): Promise<InviteRow[]> {
	const invites = (await store.settings.get<Invites>(INVITES)) ?? {};
	const names = new Map(
		(await store.graph.listNodes()).map((n) => [n.key, n.name]),
	);
	return Object.values(invites)
		.filter((inv) => live(inv))
		.map((inv) => ({
			id: inv.id,
			responsibility: {
				key: inv.responsibilityKey,
				name: names.get(inv.responsibilityKey) ?? inv.responsibilityKey,
			},
			status: inv.status as "open" | "waiting",
			candidate: inv.candidate?.name ?? null,
			expiresAt: inv.expiresAt,
		}));
}

/** The charter in its own words: the code name `dream` is never shown. */
async function charter(store: CompanyStore) {
	const nodes = await store.graph.listNodes();
	const dreamNode = nodes.find((n) => n.kind === "dream");
	const parsed = dreamNode ? DreamConfig.safeParse(dreamNode.config) : null;
	const dream = parsed?.success ? parsed.data : null;
	const lines: string[] = [];
	if (dream?.vision) lines.push(`Why it exists: ${dream.vision}`);
	if (dream?.objective) lines.push(`Its mission: ${dream.objective}`);
	if (dream?.constraints.length)
		lines.push("What it holds to:", ...dream.constraints.map((c) => `• ${c}`));
	return { nodes, lines };
}

/**
 * What a candidate sees before the founder decides: the charter and the role,
 * and who started the company. Never money, customers or other people's
 * details (D49).
 */
export async function candidateBrief(
	store: CompanyStore,
	invite: Invite,
): Promise<string> {
	const company = await store.graph.getCompany();
	const { nodes, lines } = await charter(store);
	const role = nodes.find((n) => n.key === invite.responsibilityKey);
	const founder = nodes.find((n) => n.key === company?.founderKey)?.name;
	return [
		`${company?.name ?? "This company"} has invited you to take on: ${role?.name ?? invite.responsibilityKey}.`,
		"",
		...lines,
		"",
		`I've told ${founder ?? "the founder"}. You'll hear from me here as soon as they say yes.`,
	].join("\n");
}

/**
 * The welcome a new steward gets once approved: the charter, their role,
 * who's who, what's still open and how the company works. Names and roles of
 * the people who run it only — never money or customers (D49).
 */
export async function onboardingBrief(
	store: CompanyStore,
	nodeKey: string,
): Promise<string> {
	const company = await store.graph.getCompany();
	const { nodes, lines } = await charter(store);
	const edges = await store.graph.listEdges();
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const me = nodes.find((n) => n.key === nodeKey);
	const owns = (n: StoredNode) =>
		edges
			.filter((e) => e.fromNodeId === n.id && owning(e.relation))
			.map((e) => byId.get(e.toNodeId))
			.filter((r): r is StoredNode => r?.kind === "responsibility")
			.map((r) => r.name);
	const people = nodes.filter(
		(n) => (n.kind === "human" || n.kind === "agent") && !isRetired(n),
	);
	const role = (n: StoredNode) =>
		typeof n.config.role === "string" && n.config.role ? n.config.role : null;
	const whoIsWho = people
		.filter((n) => n.key !== nodeKey)
		.slice(0, 12)
		.map((n) => {
			const what = owns(n);
			return `• ${n.name}${n.kind === "agent" ? " (agent)" : ""}${role(n) ? ` — ${role(n)}` : ""}${what.length ? `; owns ${what.join(", ")}` : ""}`;
		});
	const owned = new Set(
		edges.filter((e) => owning(e.relation)).map((e) => e.toNodeId),
	);
	const open = nodes
		.filter(
			(n) => n.kind === "responsibility" && !isRetired(n) && !owned.has(n.id),
		)
		.map((n) => n.name);
	const mine = me ? owns(me) : [];
	return [
		`Welcome to ${company?.name ?? "the company"}, ${me?.name ?? "and thank you"}. You now own ${mine.join(", ") || "your role"}.`,
		"",
		...lines,
		...(whoIsWho.length ? ["", "Who's who:", ...whoIsWho] : []),
		...(open.length
			? [
					"",
					`Still open: ${open.join(", ")}. Tell the founder if one suits you.`,
				]
			: []),
		"",
		"How it works here: your team's heartbeats come to this chat, and you can write to me here any time. Anything that can't be undone waits for the founder's yes.",
	].join("\n");
}
