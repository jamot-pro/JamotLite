import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { EventStore, JamotEvent } from "@jamot/ports";
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
	"seq, id, type, source, subject, time, data, idempotency_key, delivered_at";

export function eventOps(db: DatabaseSync): Sync<EventStore> {
	const byKey = (key: string) =>
		one(db, `SELECT ${COLUMNS} FROM events WHERE idempotency_key = ?`, key);

	return {
		append(input) {
			const seen = byKey(input.idempotencyKey);
			if (seen) return { event: toEvent(seen), created: false };
			run(
				db,
				"INSERT INTO events (id, type, source, subject, time, data, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?)",
				randomUUID(),
				input.type,
				input.source,
				input.subject ?? null,
				input.time ?? nowIso(),
				JSON.stringify(input.data ?? {}),
				input.idempotencyKey,
			);
			return {
				event: toEvent(byKey(input.idempotencyKey) as Row),
				created: true,
			};
		},

		listUndelivered(limit = 100) {
			return all(
				db,
				`SELECT ${COLUMNS} FROM events WHERE delivered_at IS NULL ORDER BY seq LIMIT ?`,
				limit,
			).map(toEvent);
		},

		markDelivered(eventId) {
			run(
				db,
				"UPDATE events SET delivered_at = coalesce(delivered_at, ?) WHERE id = ?",
				nowIso(),
				eventId,
			);
		},

		list(filter = {}) {
			const clauses: string[] = [];
			const params: SqlValue[] = [];
			if (filter.type) {
				clauses.push("type = ?");
				params.push(filter.type);
			}
			if (filter.since) {
				clauses.push("time >= ?");
				params.push(filter.since);
			}
			const w = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
			return all(
				db,
				`SELECT ${COLUMNS} FROM events ${w} ORDER BY seq DESC LIMIT ?`,
				...params,
				filter.limit ?? 100,
			).map(toEvent);
		},

		listSince(seq, limit = 100) {
			return all(
				db,
				`SELECT ${COLUMNS} FROM events WHERE seq > ? ORDER BY seq LIMIT ?`,
				seq,
				limit,
			).map(toEvent);
		},
	};
}

function toEvent(row: Row): JamotEvent {
	return {
		id: String(row.id),
		seq: Number(row.seq),
		type: String(row.type),
		source: String(row.source),
		subject: (row.subject as string | null) ?? null,
		time: String(row.time),
		data: json(row.data),
		idempotencyKey: String(row.idempotency_key),
		deliveredAt: (row.delivered_at as string | null) ?? null,
	};
}
