import { randomUUID } from "node:crypto";
import type {
	ContributionRow,
	ContributionsView,
	ExperimentView,
	RewardRow,
} from "@jamot/contracts";
import type { CompanyStore, JamotEvent } from "@jamot/ports";
import { AgentError } from "../agents/manage.js";
import { isRetired } from "../company/retired.js";
import { STEWARDS_LAST_SEEN } from "./keys.js";

/**
 * The contribution record (VISION.md, RUNTIME D54): what each person did for
 * the company, on the record, so the founder can reward people fairly.
 *
 * It lives in the event log, which is append-only: joining and taking on a
 * role are read from the events those already write; work a person reports
 * with `/did` is a `contribution.recorded` event the founder confirms or
 * declines; a reward is a `reward.given` event — a note the founder writes
 * ("€50 for the menu", "2% when we raise"), never a payment.
 *
 * Only the founder confirms, declines and rewards. The agent never does.
 */

export const CONTRIBUTION_LIMIT = 280;
const DAY = 86_400_000;
const ALL = 10_000;

function text(v: unknown, what: string): string {
	if (typeof v !== "string") throw new AgentError(`Say ${what} in words.`);
	const t = v.trim();
	if (!t) throw new AgentError(`Say ${what} in words.`);
	if (t.length > CONTRIBUTION_LIMIT)
		throw new AgentError(
			`Keep it to ${CONTRIBUTION_LIMIT} characters: a line is enough.`,
		);
	return t;
}

async function person(store: CompanyStore, nodeKey: unknown) {
	const n =
		typeof nodeKey === "string"
			? (await store.graph.listNodes()).find(
					(x) => x.kind === "human" && x.key === nodeKey && !isRetired(x),
				)
			: undefined;
	if (!n)
		throw new AgentError(`There's no one "${String(nodeKey)}" in the company.`);
	return n;
}

/**
 * Records something a person did. `confirmed`: the founder recorded it, or it
 * is the founder's own; otherwise it waits for the founder (a claim).
 */
export async function recordContribution(
	store: CompanyStore,
	input: { nodeKey: unknown; what: unknown },
	by: string,
	confirmed: boolean,
): Promise<{ id: string; message: string }> {
	const who = await person(store, input.nodeKey);
	const what = text(input.what, "what they did");
	const { event } = await store.events.append({
		type: "contribution.recorded",
		source: confirmed ? "console" : "channel/telegram",
		subject: who.key,
		data: { what, by, confirmed },
		idempotencyKey: `contribution:${randomUUID()}`,
	});
	return {
		id: event.id,
		message: confirmed
			? `Recorded for ${who.name}: ${what}`
			: `Noted. The founder will confirm it: ${what}`,
	};
}

/**
 * The founder (or an acting successor) confirms or declines a claim. Nobody
 * decides their own: `deciderKey` is the decider's node, when they have one.
 */
export async function decideContribution(
	store: CompanyStore,
	id: string,
	confirm: boolean,
	by: string,
	deciderKey?: string | null,
): Promise<{ message: string; nodeKey: string; what: string }> {
	const claim = (
		await store.events.list({ type: "contribution.recorded", limit: ALL })
	).find((e) => e.id === id);
	if (!claim) throw new AgentError("That contribution isn't on the record.");
	const what = String(claim.data.what);
	const nodeKey = String(claim.subject);
	if (claim.data.confirmed === true)
		throw new AgentError("That one is already decided.");
	if (deciderKey && deciderKey === nodeKey)
		throw new AgentError("That's your own: the founder decides it.");
	// The idempotency key makes a second decision a no-op, even in a race.
	const { created } = await store.events.append({
		type: confirm ? "contribution.confirmed" : "contribution.declined",
		source: "console",
		subject: id,
		data: { by },
		idempotencyKey: `contribution-decided:${id}`,
	});
	if (!created) throw new AgentError("That one is already decided.");
	const name =
		(await store.graph.listNodes()).find((n) => n.key === nodeKey)?.name ??
		nodeKey;
	return {
		message: confirm
			? `Confirmed for ${name}: ${what}`
			: `Not recorded for ${name}: ${what}`,
		nodeKey,
		what,
	};
}

/** The founder records a reward: a note, never a payment. */
export async function giveReward(
	store: CompanyStore,
	input: { nodeKey: unknown; note: unknown; contributionId?: unknown },
	by: string,
): Promise<string> {
	const who = await person(store, input.nodeKey);
	const note = text(input.note, "the reward");
	const contributionId =
		typeof input.contributionId === "string" && input.contributionId
			? input.contributionId
			: null;
	await store.events.append({
		type: "reward.given",
		source: "console",
		subject: who.key,
		data: { note, by, contributionId },
		idempotencyKey: `reward:${randomUUID()}`,
	});
	return `Recorded a reward for ${who.name}: ${note}`;
}

const list = (store: CompanyStore, type: string) =>
	store.events.list({ type, limit: ALL });

/** Every contribution on the record, newest first, and the rewards. */
async function record(store: CompanyStore) {
	const nodes = await store.graph.listNodes();
	const name = (key: string) => ({
		key,
		name: nodes.find((n) => n.key === key)?.name ?? key,
	});
	const roleName = (key: unknown) =>
		nodes.find((n) => n.key === key)?.name ?? String(key);
	const [recorded, confirmed, declined, joined, changed, rewards] =
		await Promise.all([
			list(store, "contribution.recorded"),
			list(store, "contribution.confirmed"),
			list(store, "contribution.declined"),
			list(store, "invite.approved"),
			list(store, "steward.responsibilities_changed"),
			list(store, "reward.given"),
		]);
	const yes = new Set(confirmed.map((e) => e.subject));
	const no = new Set(declined.map((e) => e.subject));
	const rows: ContributionRow[] = [
		...recorded.map((e) => ({
			id: e.id,
			who: name(String(e.subject)),
			what: String(e.data.what),
			at: e.time,
			kind: "did" as const,
			status:
				e.data.confirmed === true || yes.has(e.id)
					? ("confirmed" as const)
					: no.has(e.id)
						? ("declined" as const)
						: ("claimed" as const),
		})),
		...joined.map((e) => ({
			id: e.id,
			who: name(String(e.subject)),
			what: `Joined, taking on ${roleName(e.data.responsibility)}`,
			at: e.time,
			kind: "joined" as const,
			status: "confirmed" as const,
		})),
		// Taking on a role counts; roles opened by a hand-over take nothing.
		...changed
			.filter(
				(e) =>
					Array.isArray(e.data.taken) && (e.data.taken as unknown[]).length,
			)
			.map((e) => ({
				id: e.id,
				who: name(String(e.subject)),
				what: `Took on ${(e.data.taken as string[]).join(", ")}`,
				at: e.time,
				kind: "took" as const,
				status: "confirmed" as const,
			})),
	].sort((a, b) => b.at.localeCompare(a.at));
	const rewardRows: RewardRow[] = rewards.map((e) => ({
		id: e.id,
		who: name(String(e.subject)),
		note: String(e.data.note),
		at: e.time,
		contributionId:
			typeof e.data.contributionId === "string" ? e.data.contributionId : null,
	}));
	return { rows, rewards: rewardRows, joined, nodes };
}

/** The numbers VISION.md's experiment watches. */
async function experiment(
	store: CompanyStore,
	rows: ContributionRow[],
	joined: JamotEvent[],
	now: Date,
): Promise<ExperimentView> {
	const ago = (days: number) => now.getTime() - days * DAY;
	const seen =
		(await store.settings.get<Record<string, string>>(STEWARDS_LAST_SEEN)) ??
		{};
	const done = rows.filter((r) => r.status === "confirmed");
	const did = done.filter((r) => r.kind === "did");
	const nodes = await store.graph.listNodes();
	const retired = new Set(nodes.filter(isRetired).map((n) => n.key));

	const firstWork = joined.filter((j) =>
		did.some(
			(r) =>
				r.who.key === j.subject &&
				Date.parse(r.at) <= Date.parse(j.time) + 14 * DAY,
		),
	).length;
	const old = joined.filter((j) => Date.parse(j.time) <= ago(42));
	const active = old.filter((j) => {
		const key = String(j.subject);
		if (retired.has(key)) return false;
		const last = seen[key];
		return (
			(last !== undefined && Date.parse(last) >= ago(14)) ||
			did.some((r) => r.who.key === key && Date.parse(r.at) >= ago(14))
		);
	}).length;

	const handed = new Set(
		(await list(store, "steward.handed_over")).flatMap((e) =>
			Array.isArray(e.data.roleKeys) ? (e.data.roleKeys as string[]) : [],
		),
	);
	const byId = new Map(nodes.map((n) => [n.id, n.key]));
	const owned = new Set(
		(await store.graph.listEdges())
			.filter((e) => e.relation === "owns" || e.relation === "responsible_for")
			.map((e) => byId.get(e.toNodeId)),
	);

	return {
		invited: (await list(store, "invite.created")).length,
		joined: joined.length,
		firstWorkIn2Weeks: firstWork,
		joinedSixWeeksAgo: old.length,
		activeAfterSixWeeks: active,
		agentRuns30d: (
			await store.runs.totals({ since: new Date(ago(30)).toISOString() })
		).runs,
		peopleContributions30d: done.filter((r) => Date.parse(r.at) >= ago(30))
			.length,
		handedOver: handed.size,
		pickedUpAgain: [...handed].filter((k) => owned.has(k)).length,
	};
}

/** What the Contributions page shows (owner only). */
export async function contributionsView(
	store: CompanyStore,
	now = new Date(),
): Promise<ContributionsView> {
	const { rows, rewards, joined, nodes } = await record(store);
	return {
		contributions: rows,
		rewards,
		people: nodes
			.filter((n) => n.kind === "human" && !isRetired(n))
			.map((n) => ({ key: n.key, name: n.name })),
		experiment: await experiment(store, rows, joined, now),
	};
}

/**
 * The record as `/ledger` tells it on Telegram. A steward sees their own
 * lines and their own rewards; the founder (`nodeKey` null) sees everyone's
 * latest, and totals per person.
 */
export async function ledgerText(
	store: CompanyStore,
	nodeKey: string | null,
): Promise<string> {
	const { rows, rewards } = await record(store);
	const day = (iso: string) => iso.slice(0, 10);
	const mark = (r: ContributionRow) =>
		r.status === "claimed" ? " (waiting for the founder)" : "";
	if (nodeKey) {
		const mine = rows.filter(
			(r) => r.who.key === nodeKey && r.status !== "declined",
		);
		const given = rewards.filter((r) => r.who.key === nodeKey);
		if (mine.length === 0 && given.length === 0)
			return "Nothing on your record yet. Send /did and what you did, and the founder confirms it.";
		return [
			"Your record:",
			...mine.slice(0, 15).map((r) => `• ${day(r.at)} ${r.what}${mark(r)}`),
			...(given.length
				? ["", "Rewards:", ...given.map((r) => `• ${day(r.at)} ${r.note}`)]
				: []),
		].join("\n");
	}
	if (rows.length === 0) return "Nothing on the record yet.";
	const totals = new Map<string, number>();
	for (const r of rows.filter((r) => r.status === "confirmed"))
		totals.set(r.who.name, (totals.get(r.who.name) ?? 0) + 1);
	return [
		"Latest:",
		...rows
			.filter((r) => r.status !== "declined")
			.slice(0, 10)
			.map((r) => `• ${day(r.at)} ${r.who.name}: ${r.what}${mark(r)}`),
		"",
		"Confirmed, per person:",
		...[...totals].sort((a, b) => b[1] - a[1]).map(([n, c]) => `• ${n}: ${c}`),
	].join("\n");
}
