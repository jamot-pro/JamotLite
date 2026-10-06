import type { CompanyStore, StoredNode } from "@jamot/ports";
import { isRetired } from "../company/retired.js";
import type { Notifier } from "../heartbeats/notify.js";
import { CHECKINS, STEWARDS_LAST_SEEN } from "./keys.js";
import { setStewardResponsibilities } from "./stewards.js";

export { CHECKINS, STEWARDS_LAST_SEEN };

/**
 * Noticing a dropped role (VISION.md, RUNTIME D53). People lose energy,
 * get busy, burn out: that's normal, and a role shouldn't die with it.
 *
 * Every paired steward's last activity on Telegram is kept. When someone who
 * owns responsibilities has been quiet for `quietDays`, they get a kind
 * check-in — still on it, hand it over, or pause for two weeks. With no
 * answer `graceDays` later, their responsibilities go back to being open
 * roles and the founder is told, with who could take them; the founder then
 * invites someone (D52). The person stays in the company and can take a role
 * again any time.
 *
 * The founder isn't checked here: the company's successor switch (D22)
 * covers them. Stewards not linked on Telegram are never released — Jamot
 * can't tell they're quiet.
 */

export const DROP_SETTINGS = "roles.dropCheck";
export const DEFAULT_DROP = { quietDays: 14, graceDays: 7 };
const PAUSE_DAYS = 14;
const DAY = 86_400_000;

interface Checkin {
	askedAt?: string;
	pausedUntil?: string;
	releasedAt?: string;
}
type Checkins = Record<string, Checkin>;
type Seen = Record<string, string>;

const owning = (relation: string) =>
	relation === "owns" || relation === "responsible_for";

async function settings(store: CompanyStore) {
	const s =
		await store.settings.get<Partial<typeof DEFAULT_DROP>>(DROP_SETTINGS);
	return { ...DEFAULT_DROP, ...(s ?? {}) };
}

/**
 * Sets (or, with undefined, removes) one person's entry in a per-person
 * setting, read and written in one transaction: a heartbeat and a button
 * press for someone else never overwrite each other.
 */
async function setEntry<T>(
	store: CompanyStore,
	setting: string,
	nodeKey: string,
	value: T | undefined,
): Promise<void> {
	await store.transaction(async (tx) => {
		const map = (await tx.settings.get<Record<string, T>>(setting)) ?? {};
		if (value === undefined) delete map[nodeKey];
		else map[nodeKey] = value;
		await tx.settings.set(setting, map);
	});
}
const entry = async <T>(store: CompanyStore, setting: string, key: string) =>
	(await store.settings.get<Record<string, T>>(setting))?.[key];

/** The keys of the responsibilities a node owns. */
async function ownedKeys(store: CompanyStore, nodeId: string) {
	const nodes = await store.graph.listNodes();
	const byId = new Map(nodes.map((n) => [n.id, n]));
	return (await store.graph.listEdges())
		.filter((e) => e.fromNodeId === nodeId && owning(e.relation))
		.map((e) => byId.get(e.toNodeId))
		.filter((r): r is StoredNode => r?.kind === "responsibility")
		.map((r) => r.key);
}

/** What each live person owns, by node key. */
async function ownership(store: CompanyStore) {
	const nodes = await store.graph.listNodes();
	const edges = await store.graph.listEdges();
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const owns = (n: StoredNode) =>
		edges
			.filter((e) => e.fromNodeId === n.id && owning(e.relation))
			.map((e) => byId.get(e.toNodeId))
			.filter((r): r is StoredNode => r?.kind === "responsibility")
			.map((r) => r.name);
	const people = nodes.filter((n) => n.kind === "human" && !isRetired(n));
	return { people, owns };
}

/** A steward did something: they're here. Ends a check-in or a release. */
export async function noteStewardActivity(
	store: CompanyStore,
	nodeKey: string,
	now = new Date(),
): Promise<void> {
	await store.transaction(async (tx) => {
		const seen = (await tx.settings.get<Seen>(STEWARDS_LAST_SEEN)) ?? {};
		seen[nodeKey] = now.toISOString();
		await tx.settings.set(STEWARDS_LAST_SEEN, seen);
		const checkins = (await tx.settings.get<Checkins>(CHECKINS)) ?? {};
		const c = checkins[nodeKey];
		// A pause lasts its time; anything else ends with them showing up.
		if (c && !(c.pausedUntil && Date.parse(c.pausedUntil) > now.getTime())) {
			delete checkins[nodeKey];
			await tx.settings.set(CHECKINS, checkins);
		}
	});
}

/**
 * Part of the company heartbeat: check in with stewards who've gone quiet,
 * and open the roles of those who didn't answer.
 */
export async function checkDroppedRoles(
	deps: { store: CompanyStore; notifier: Notifier },
	now: Date,
): Promise<void> {
	const { store, notifier } = deps;
	if (!notifier.toMember) return;
	const company = await store.graph.getCompany();
	if (!company) return;
	const { quietDays, graceDays } = await settings(store);
	const { people, owns } = await ownership(store);

	for (const person of people) {
		if (person.key === company.founderKey) continue;
		const roles = owns(person);
		if (roles.length === 0) continue;
		// Read fresh for each person: they may have answered meanwhile.
		const c = (await entry<Checkin>(store, CHECKINS, person.key)) ?? {};
		if (c.releasedAt) {
			// Given a role again since: the clock starts over.
			await setEntry(store, CHECKINS, person.key, undefined);
			await setEntry(store, STEWARDS_LAST_SEEN, person.key, now.toISOString());
			continue;
		}
		if (c.pausedUntil && Date.parse(c.pausedUntil) > now.getTime()) continue;
		const last = await entry<string>(store, STEWARDS_LAST_SEEN, person.key);
		if (!last) {
			// First time we look: the clock starts now.
			await setEntry(store, STEWARDS_LAST_SEEN, person.key, now.toISOString());
			continue;
		}
		const since = Math.max(
			Date.parse(last),
			Date.parse(c.pausedUntil ?? "") || 0,
		);

		if (!c.askedAt) {
			if (now.getTime() - since < quietDays * DAY) continue;
			const asked = await notifier.toMember(person.key, {
				text: [
					`Hi ${person.name}, it's been a while since we heard from you at ${company.name}. You own ${roles.join(", ")}.`,
					"How's it going? Whatever you choose is fine.",
				].join("\n"),
				actions: [
					{ label: "I'm still on it", action: `still:${person.key}` },
					{ label: "Hand it over", action: `handover:${person.key}` },
					{ label: "Pause for 2 weeks", action: `pause:${person.key}` },
				],
			});
			if (!asked) continue; // not on Telegram: we can't tell they're quiet
			await setEntry<Checkin>(store, CHECKINS, person.key, {
				askedAt: now.toISOString(),
			});
			await store.events.append({
				type: "steward.checkin",
				source: "survival",
				subject: person.key,
				data: { quietSince: new Date(since).toISOString() },
				idempotencyKey: `checkin:${person.key}:${now.toISOString()}`,
			});
		} else if (now.getTime() - Date.parse(c.askedAt) >= graceDays * DAY) {
			await handOver(deps, person.key, "no answer", now);
		}
	}
}

/**
 * A steward's responsibilities become open roles — because they chose to
 * hand them over, or didn't answer a check-in — and the founder is told who
 * could take them.
 */
export async function handOver(
	deps: { store: CompanyStore; notifier: Notifier },
	nodeKey: string,
	why: "they chose" | "no answer",
	now = new Date(),
): Promise<string[]> {
	const { store, notifier } = deps;
	const { people, owns } = await ownership(store);
	const person = people.find((p) => p.key === nodeKey);
	if (!person) return [];
	const roles = owns(person);
	const roleKeys = await ownedKeys(store, person.id);
	if (roles.length)
		await setStewardResponsibilities(
			store,
			nodeKey,
			[],
			why === "they chose"
				? `${person.name} (handed over)`
				: "survival (no answer)",
		);
	await setEntry<Checkin>(store, CHECKINS, nodeKey, {
		releasedAt: now.toISOString(),
	});
	await store.events.append({
		type: "steward.handed_over",
		source: why === "they chose" ? "channel/telegram" : "survival",
		subject: nodeKey,
		data: { why, roles, roleKeys },
		idempotencyKey: `handed-over:${nodeKey}:${now.toISOString()}`,
	});
	if (roles.length === 0) return roles;

	const company = await store.graph.getCompany();
	const { people: after, owns: ownsNow } = await ownership(store);
	const others = after
		.filter((p) => p.key !== nodeKey && p.key !== company?.founderKey)
		.map((p) => ({ name: p.name, count: ownsNow(p).length }))
		.sort((a, b) => a.count - b.count)
		.slice(0, 3)
		.map(
			(p) => `${p.name} (${p.count ? `owns ${p.count}` : "owns nothing yet"})`,
		);
	await notifier.toOwner({
		text: [
			why === "they chose"
				? `🤝 ${person.name} handed over ${roles.join(", ")}.`
				: `🕯 ${person.name} has been quiet and didn't answer my check-in, so I've opened their roles: ${roles.join(", ")}.`,
			others.length ? `Who could take them: ${others.join(", ")}.` : "",
			"Or invite someone you know: Stewards → Open roles in the console.",
		]
			.filter(Boolean)
			.join("\n"),
	});
	return roles;
}

/**
 * A steward answered a check-in from their own Telegram. Returns what to tell
 * them.
 */
export async function answerCheckin(
	deps: { store: CompanyStore; notifier: Notifier },
	nodeKey: string,
	answer: "still" | "handover" | "pause",
	now = new Date(),
): Promise<string> {
	const { store, notifier } = deps;
	const company = (await store.graph.getCompany())?.name ?? "the company";
	if (answer === "still") {
		const released = (await entry<Checkin>(store, CHECKINS, nodeKey))
			?.releasedAt;
		await noteStewardActivity(store, nodeKey, now);
		return released
			? "Good to hear from you. Your roles were opened when I didn't hear back; tell the founder if you'd like one again."
			: "Thanks, good to hear. Nothing changes.";
	}
	if (answer === "handover") {
		const roles = await handOver(deps, nodeKey, "they chose", now);
		return roles.length
			? `Thank you for everything you did for ${roles.join(", ")}. It's open now, and the founder knows. You're still part of ${company}: tell the founder whenever you'd like a role again.`
			: "You don't own anything right now, so there's nothing to hand over.";
	}
	const until = new Date(now.getTime() + PAUSE_DAYS * DAY).toISOString();
	await setEntry(store, STEWARDS_LAST_SEEN, nodeKey, now.toISOString());
	await setEntry<Checkin>(store, CHECKINS, nodeKey, { pausedUntil: until });
	const { people, owns } = await ownership(store);
	const person = people.find((p) => p.key === nodeKey);
	await notifier.toOwner({
		text: `⏸ ${person?.name ?? nodeKey} is pausing until ${until.slice(0, 10)}; they still own ${(person && owns(person).join(", ")) || "nothing right now"}.`,
	});
	return `Enjoy the break. I'll check in again after ${until.slice(0, 10)}; your roles stay yours.`;
}
