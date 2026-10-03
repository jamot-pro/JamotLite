import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Job, JobStore } from "@jamot/ports";
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
	"id, kind, key, payload, status, run_at, attempts, max_attempts, last_error, locked_until, created_at, updated_at";

export function jobOps(db: DatabaseSync): Sync<JobStore> {
	const get = (id: string) => {
		const row = one(db, `SELECT ${COLUMNS} FROM jobs WHERE id = ?`, id);
		return row ? toJob(row) : null;
	};

	return {
		enqueue(input) {
			if (input.key) {
				const seen = one(
					db,
					`SELECT ${COLUMNS} FROM jobs WHERE key = ?`,
					input.key,
				);
				if (seen) return { job: toJob(seen), created: false };
			}
			const id = randomUUID();
			const now = nowIso();
			run(
				db,
				"INSERT INTO jobs (id, kind, key, payload, status, run_at, max_attempts, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)",
				id,
				input.kind,
				input.key ?? null,
				JSON.stringify(input.payload ?? {}),
				input.runAt ?? now,
				input.maxAttempts ?? 5,
				now,
				now,
			);
			return { job: get(id) as Job, created: true };
		},

		claimDue({ now, leaseMs, limit = 10 }) {
			const lockedUntil = new Date(Date.parse(now) + leaseMs).toISOString();
			const due = all(
				db,
				`SELECT id FROM jobs
				 WHERE (status = 'queued' AND run_at <= ?1) OR (status = 'running' AND locked_until <= ?1)
				 ORDER BY run_at, seq LIMIT ?2`,
				now,
				limit,
			);
			const claimed: Job[] = [];
			for (const { id } of due) {
				// A running job whose lease expired has already used its attempts:
				// once they're gone it's dead rather than retried forever.
				const job = get(String(id)) as Job;
				if (job.status === "running" && job.attempts >= job.maxAttempts) {
					run(
						db,
						"UPDATE jobs SET status = 'dead', last_error = coalesce(last_error, 'lease expired'), locked_until = NULL, updated_at = ? WHERE id = ?",
						now,
						job.id,
					);
					continue;
				}
				run(
					db,
					"UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_until = ?, updated_at = ? WHERE id = ?",
					lockedUntil,
					now,
					job.id,
				);
				claimed.push(get(job.id) as Job);
			}
			return claimed;
		},

		complete(jobId) {
			run(
				db,
				"UPDATE jobs SET status = 'done', locked_until = NULL, updated_at = ? WHERE id = ?",
				nowIso(),
				jobId,
			);
		},

		fail(jobId, error, retryAt) {
			const job = get(jobId);
			if (!job) throw new Error(`no job ${jobId}`);
			const dead = job.attempts >= job.maxAttempts;
			run(
				db,
				"UPDATE jobs SET status = ?, last_error = ?, run_at = ?, locked_until = NULL, updated_at = ? WHERE id = ?",
				dead ? "dead" : "queued",
				error,
				dead ? job.runAt : retryAt,
				nowIso(),
				jobId,
			);
			return get(jobId) as Job;
		},

		get,

		list(filter = {}) {
			const clauses: string[] = [];
			const params: SqlValue[] = [];
			if (filter.status) {
				clauses.push("status = ?");
				params.push(filter.status);
			}
			if (filter.kind) {
				clauses.push("kind = ?");
				params.push(filter.kind);
			}
			const w = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
			return all(
				db,
				`SELECT ${COLUMNS} FROM jobs ${w} ORDER BY seq DESC LIMIT ?`,
				...params,
				filter.limit ?? 100,
			).map(toJob);
		},
	};
}

function toJob(row: Row): Job {
	return {
		id: String(row.id),
		kind: String(row.kind),
		key: (row.key as string | null) ?? null,
		payload: json(row.payload),
		status: row.status as Job["status"],
		runAt: String(row.run_at),
		attempts: Number(row.attempts),
		maxAttempts: Number(row.max_attempts),
		lastError: (row.last_error as string | null) ?? null,
		lockedUntil: (row.locked_until as string | null) ?? null,
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
	};
}
