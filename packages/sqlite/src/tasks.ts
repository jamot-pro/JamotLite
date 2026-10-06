import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Task, TaskStore } from "@jamot/ports";
import {
	all,
	nowIso,
	one,
	type Row,
	run,
	type SqlValue,
	type Sync,
} from "./sync.js";

const COLUMNS =
	"seq, id, title, details, status, responsibility_key, assignee_kind, assignee_key, requester_kind, requester_key, requester_name, result, note, due_at, nudged_at, created_at, updated_at, done_at";

/** Patch field → column. */
const FIELDS = {
	status: "status",
	responsibilityKey: "responsibility_key",
	assigneeKind: "assignee_kind",
	assigneeKey: "assignee_key",
	result: "result",
	note: "note",
	details: "details",
	nudgedAt: "nudged_at",
} as const;

export function taskOps(db: DatabaseSync): Sync<TaskStore> {
	const get = (id: string) => {
		const row = one(db, `SELECT ${COLUMNS} FROM tasks WHERE id = ?`, id);
		return row ? toTask(row) : null;
	};

	return {
		create(input) {
			const id = randomUUID();
			const now = nowIso();
			run(
				db,
				"INSERT INTO tasks (id, title, details, status, responsibility_key, requester_kind, requester_key, requester_name, due_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
				id,
				input.title,
				input.details ?? null,
				input.status,
				input.responsibilityKey ?? null,
				input.requesterKind,
				input.requesterKey ?? null,
				input.requesterName,
				input.dueAt ?? null,
				now,
				now,
			);
			return get(id) as Task;
		},

		get,

		byNumber(number) {
			const row = one(db, `SELECT ${COLUMNS} FROM tasks WHERE seq = ?`, number);
			return row ? toTask(row) : null;
		},

		update(id, from, patch) {
			if (from.length === 0) return null;
			const sets: string[] = [];
			const params: SqlValue[] = [];
			for (const [field, column] of Object.entries(FIELDS)) {
				const value = patch[field as keyof typeof patch];
				if (value === undefined) continue;
				sets.push(`${column} = ?`);
				params.push(value);
			}
			const now = nowIso();
			sets.push("updated_at = ?");
			params.push(now);
			if (patch.status === "done" || patch.status === "cancelled") {
				sets.push("done_at = ?");
				params.push(now);
			}
			const changed = run(
				db,
				`UPDATE tasks SET ${sets.join(", ")} WHERE id = ? AND status IN (${from.map(() => "?").join(", ")})`,
				...params,
				id,
				...from,
			);
			return changed ? get(id) : null;
		},

		list(filter = {}) {
			const clauses: string[] = [];
			const params: SqlValue[] = [];
			if (filter.status?.length) {
				clauses.push(`status IN (${filter.status.map(() => "?").join(", ")})`);
				params.push(...filter.status);
			}
			if (filter.assigneeKey) {
				clauses.push("assignee_key = ?");
				params.push(filter.assigneeKey);
			}
			if (filter.requesterKey) {
				clauses.push("requester_key = ?");
				params.push(filter.requesterKey);
			}
			const w = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
			return all(
				db,
				`SELECT ${COLUMNS} FROM tasks ${w} ORDER BY seq DESC LIMIT ?`,
				...params,
				filter.limit ?? 100,
			).map(toTask);
		},
	};
}

const text = (v: unknown) => (v as string | null) ?? null;

function toTask(row: Row): Task {
	return {
		id: String(row.id),
		number: Number(row.seq),
		title: String(row.title),
		details: text(row.details),
		status: row.status as Task["status"],
		responsibilityKey: text(row.responsibility_key),
		assigneeKind: text(row.assignee_kind) as Task["assigneeKind"],
		assigneeKey: text(row.assignee_key),
		requesterKind: row.requester_kind as Task["requesterKind"],
		requesterKey: text(row.requester_key),
		requesterName: String(row.requester_name),
		result: text(row.result),
		note: text(row.note),
		dueAt: text(row.due_at),
		nudgedAt: text(row.nudged_at),
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
		doneAt: text(row.done_at),
	};
}
