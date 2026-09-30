import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
	Identity,
	IdentityProvider,
	PeopleStore,
	Person,
	PersonPatch,
} from "@jamot/ports";
import {
	all,
	json,
	nowIso,
	one,
	type Row,
	run,
	type SqlValue,
	type Sync,
} from "./sync.js";

/** The same email or phone written two ways must match one identity. */
export function normalizeIdentity(
	provider: IdentityProvider,
	value: string,
): string {
	const v = value.trim();
	if (provider === "email") return v.toLowerCase();
	if (provider === "phone")
		return (v.startsWith("+") ? "+" : "") + v.replace(/\D/g, "");
	return v;
}

const PERSON_COLUMNS =
	"id, display_name, email, phone, consent, profile, context_summary, last_interaction_at, created_at, updated_at";

export function peopleOps(db: DatabaseSync): Sync<PeopleStore> {
	const get = (id: string) => {
		const row = one(
			db,
			`SELECT ${PERSON_COLUMNS} FROM people WHERE id = ?`,
			id,
		);
		return row ? toPerson(row) : null;
	};

	const update = (id: string, patch: PersonPatch): Person | null => {
		const columns: Record<keyof PersonPatch, string> = {
			displayName: "display_name",
			email: "email",
			phone: "phone",
			consent: "consent",
			profile: "profile",
			contextSummary: "context_summary",
			lastInteractionAt: "last_interaction_at",
		};
		const sets: string[] = [];
		const params: SqlValue[] = [];
		for (const [field, value] of Object.entries(patch) as [
			keyof PersonPatch,
			unknown,
		][]) {
			if (value === undefined) continue;
			sets.push(`${columns[field]} = ?`);
			params.push(
				field === "consent" || field === "profile"
					? JSON.stringify(value)
					: (value as SqlValue),
			);
		}
		if (sets.length > 0) {
			run(
				db,
				`UPDATE people SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`,
				...params,
				nowIso(),
				id,
			);
		}
		return get(id);
	};

	const listIdentities = (personId: string) =>
		all(
			db,
			"SELECT id, person_id, provider, value, verified, confidence, source, created_at FROM identities WHERE person_id = ? ORDER BY created_at, id",
			personId,
		).map(toIdentity);

	return {
		create(input) {
			const now = nowIso();
			const id = randomUUID();
			run(
				db,
				"INSERT INTO people (id, display_name, email, phone, consent, profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
				id,
				input.displayName,
				input.email ? normalizeIdentity("email", input.email) : null,
				input.phone ? normalizeIdentity("phone", input.phone) : null,
				JSON.stringify(input.consent ?? {}),
				JSON.stringify(input.profile ?? {}),
				now,
				now,
			);
			return get(id) as Person;
		},

		get,

		list(opts = {}) {
			const limit = opts.limit ?? 100;
			const order =
				"ORDER BY coalesce(last_interaction_at, created_at) DESC, seq DESC LIMIT ?";
			if (!opts.search?.trim())
				return all(
					db,
					`SELECT ${PERSON_COLUMNS} FROM people ${order}`,
					limit,
				).map(toPerson);
			const like = `%${opts.search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
			return all(
				db,
				`SELECT ${PERSON_COLUMNS} FROM people WHERE display_name LIKE ?1 ESCAPE '\\' OR email LIKE ?1 ESCAPE '\\' OR phone LIKE ?1 ESCAPE '\\' ${order.replace("?", "?2")}`,
				like,
				limit,
			).map(toPerson);
		},

		update,

		delete(id) {
			return run(db, "DELETE FROM people WHERE id = ?", id) > 0;
		},

		findByIdentity(provider, value) {
			const row = one(
				db,
				`SELECT ${PERSON_COLUMNS.split(", ")
					.map((c) => `p.${c}`)
					.join(
						", ",
					)} FROM identities i JOIN people p ON p.id = i.person_id WHERE i.provider = ? AND i.value = ?`,
				provider,
				normalizeIdentity(provider, value),
			);
			return row ? toPerson(row) : null;
		},

		addIdentity(personId, identity) {
			const value = normalizeIdentity(identity.provider, identity.value);
			const existing = one(
				db,
				"SELECT id, person_id, provider, value, verified, confidence, source, created_at FROM identities WHERE provider = ? AND value = ?",
				identity.provider,
				value,
			);
			if (existing) {
				if (existing.person_id !== personId) {
					throw new Error(
						`${identity.provider} ${value} already belongs to another person — merge them instead`,
					);
				}
				return toIdentity(existing);
			}
			const id = randomUUID();
			run(
				db,
				"INSERT INTO identities (id, person_id, provider, value, verified, confidence, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
				id,
				personId,
				identity.provider,
				value,
				identity.verified ? 1 : 0,
				identity.confidence ?? 1,
				identity.source ?? "observed",
				nowIso(),
			);
			return listIdentities(personId).find((i) => i.id === id) as Identity;
		},

		listIdentities,

		removeIdentity(identityId) {
			return run(db, "DELETE FROM identities WHERE id = ?", identityId) > 0;
		},

		merge(keepId, dropId) {
			if (keepId === dropId)
				throw new Error("cannot merge a person into themselves");
			const keep = get(keepId);
			const drop = get(dropId);
			if (!keep || !drop)
				throw new Error("both people must exist to merge them");

			run(
				db,
				"UPDATE identities SET person_id = ? WHERE person_id = ?",
				keepId,
				dropId,
			);
			run(
				db,
				"UPDATE conversations SET person_id = ? WHERE person_id = ?",
				keepId,
				dropId,
			);
			run(
				db,
				"UPDATE messages SET person_id = ? WHERE person_id = ?",
				keepId,
				dropId,
			);
			run(
				db,
				"UPDATE memories SET owner_id = ? WHERE scope = 'person' AND owner_id = ?",
				keepId,
				dropId,
			);

			const latest =
				[keep.lastInteractionAt, drop.lastInteractionAt]
					.filter(Boolean)
					.sort()
					.at(-1) ?? null;
			update(keepId, {
				email: keep.email ?? drop.email,
				phone: keep.phone ?? drop.phone,
				contextSummary: keep.contextSummary ?? drop.contextSummary,
				consent: { ...drop.consent, ...keep.consent },
				profile: { ...drop.profile, ...keep.profile },
				lastInteractionAt: latest,
			});
			run(db, "DELETE FROM people WHERE id = ?", dropId);
			return get(keepId) as Person;
		},
	};
}

function toPerson(row: Row): Person {
	return {
		id: String(row.id),
		displayName: String(row.display_name),
		email: (row.email as string | null) ?? null,
		phone: (row.phone as string | null) ?? null,
		consent: json(row.consent),
		profile: json(row.profile),
		contextSummary: (row.context_summary as string | null) ?? null,
		lastInteractionAt: (row.last_interaction_at as string | null) ?? null,
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
	};
}

function toIdentity(row: Row): Identity {
	return {
		id: String(row.id),
		personId: String(row.person_id),
		provider: String(row.provider),
		value: String(row.value),
		verified: Number(row.verified) === 1,
		confidence: Number(row.confidence),
		source: row.source as Identity["source"],
		createdAt: String(row.created_at),
	};
}
