import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Memory, MemoryFilter, MemoryStore } from "@jamot/ports";
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

const COLUMNS =
	"m.id, m.scope, m.owner_id, m.kind, m.content, m.data, m.source, m.confidence, m.created_at, m.updated_at";

/** Turns what a person or agent typed into a safe FTS5 query: every word as a
 *  quoted prefix, any of them may match. Returns null when nothing is left. */
export function toFtsQuery(text: string): string | null {
	const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
	if (words.length === 0) return null;
	return words.map((w) => `"${w}"*`).join(" OR ");
}

function where(filter: MemoryFilter): { sql: string; params: SqlValue[] } {
	const clauses: string[] = [];
	const params: SqlValue[] = [];
	if (filter.scope) {
		clauses.push("m.scope = ?");
		params.push(filter.scope);
	}
	if (filter.ownerId !== undefined) {
		clauses.push(
			filter.ownerId === null ? "m.owner_id IS NULL" : "m.owner_id = ?",
		);
		if (filter.ownerId !== null) params.push(filter.ownerId);
	}
	if (filter.kind) {
		clauses.push("m.kind = ?");
		params.push(filter.kind);
	}
	return { sql: clauses.length ? clauses.join(" AND ") : "1 = 1", params };
}

export function memoryOps(db: DatabaseSync): Sync<MemoryStore> {
	const get = (id: string) => {
		const row = one(db, `SELECT ${COLUMNS} FROM memories m WHERE m.id = ?`, id);
		return row ? toMemory(row) : null;
	};

	return {
		store(input) {
			const id = randomUUID();
			const now = nowIso();
			run(
				db,
				"INSERT INTO memories (id, scope, owner_id, kind, content, data, source, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
				id,
				input.scope,
				input.ownerId ?? null,
				input.kind,
				input.content,
				JSON.stringify(input.data ?? {}),
				input.source,
				input.confidence ?? 1,
				now,
				now,
			);
			return get(id) as Memory;
		},

		get,

		list(filter = {}) {
			const w = where(filter);
			return all(
				db,
				`SELECT ${COLUMNS} FROM memories m WHERE ${w.sql} ORDER BY m.seq DESC LIMIT ?`,
				...w.params,
				filter.limit ?? 50,
			).map(toMemory);
		},

		search(query, filter = {}) {
			const fts = toFtsQuery(query);
			if (!fts) return [];
			const w = where(filter);
			return all(
				db,
				`SELECT ${COLUMNS} FROM memories_fts f JOIN memories m ON m.seq = f.rowid
				 WHERE memories_fts MATCH ? AND ${w.sql} ORDER BY bm25(memories_fts), m.seq DESC LIMIT ?`,
				fts,
				...w.params,
				filter.limit ?? 20,
			).map(toMemory);
		},

		update(id, patch) {
			const current = get(id);
			if (!current) return null;
			run(
				db,
				"UPDATE memories SET content = ?, data = ?, confidence = ?, updated_at = ? WHERE id = ?",
				patch.content ?? current.content,
				JSON.stringify(patch.data ?? current.data),
				patch.confidence ?? current.confidence,
				nowIso(),
				id,
			);
			return get(id);
		},

		forget(id) {
			return run(db, "DELETE FROM memories WHERE id = ?", id) > 0;
		},
	};
}

function toMemory(row: Row): Memory {
	return {
		id: String(row.id),
		scope: row.scope as Memory["scope"],
		ownerId: (row.owner_id as string | null) ?? null,
		kind: String(row.kind),
		content: String(row.content),
		data: json(row.data),
		source: row.source as Memory["source"],
		confidence: Number(row.confidence),
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
	};
}
