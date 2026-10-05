import type { StoredNode } from "@jamot/ports";

const slug = (name: string) =>
	name
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 30) || "person";

/** A key for a new person, from their name, that no node has yet. */
export function newHumanKey(nodes: StoredNode[], name: string): string {
	const taken = new Set(nodes.map((n) => n.key));
	const base = slug(name);
	let key = base === "dream" ? "dream-person" : base;
	for (let i = 2; taken.has(key); i++) key = `${base}-${i}`;
	return key;
}

/** When each steward was last active on Telegram, by node key (D53). */
export const STEWARDS_LAST_SEEN = "stewards.lastSeen";
/** Check-ins, pauses and releases, by node key (D53). */
export const CHECKINS = "roles.checkins";
