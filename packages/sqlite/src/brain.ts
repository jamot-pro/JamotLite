import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
	Approval,
	ApprovalStore,
	Run,
	RunStore,
	TranscriptStore,
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

const RUN_COLUMNS =
	"id, session_id, agent_key, status, model, trigger, input, output, error, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, started_at, ended_at";

export function runOps(db: DatabaseSync): Sync<RunStore> {
	const get = (id: string) => {
		const row = one(db, `SELECT ${RUN_COLUMNS} FROM runs WHERE id = ?`, id);
		return row ? toRun(row) : null;
	};

	return {
		start(input) {
			const id = randomUUID();
			run(
				db,
				"INSERT INTO runs (id, session_id, agent_key, status, model, trigger, input, started_at) VALUES (?, ?, ?, 'running', ?, ?, ?, ?)",
				id,
				input.sessionId,
				input.agentKey,
				input.model,
				input.trigger,
				input.input,
				nowIso(),
			);
			return get(id) as Run;
		},

		addUsage(runId, u) {
			for (const [field, value] of Object.entries(u)) {
				if (!Number.isSafeInteger(value) || value < 0)
					throw new Error(`usage ${field} must be a whole number ≥ 0`);
			}
			run(
				db,
				`UPDATE runs SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?,
				 cache_read_tokens = cache_read_tokens + ?, cache_write_tokens = cache_write_tokens + ?,
				 cost_micro_usd = cost_micro_usd + ? WHERE id = ?`,
				u.inputTokens,
				u.outputTokens,
				u.cacheReadTokens,
				u.cacheWriteTokens,
				u.costMicroUsd,
				runId,
			);
		},

		finish(runId, result) {
			run(
				db,
				"UPDATE runs SET status = ?, output = ?, error = ?, ended_at = ? WHERE id = ?",
				result.status,
				result.output ?? null,
				result.error ?? null,
				nowIso(),
				runId,
			);
			const finished = get(runId);
			if (!finished) throw new Error(`no run ${runId}`);
			return finished;
		},

		get,

		list(filter = {}) {
			const clauses: string[] = [];
			const params: SqlValue[] = [];
			for (const [field, column] of [
				["agentKey", "agent_key"],
				["sessionId", "session_id"],
				["status", "status"],
			] as const) {
				const value = filter[field];
				if (value) {
					clauses.push(`${column} = ?`);
					params.push(value);
				}
			}
			const w = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
			return all(
				db,
				`SELECT ${RUN_COLUMNS} FROM runs ${w} ORDER BY seq DESC LIMIT ?`,
				...params,
				filter.limit ?? 50,
			).map(toRun);
		},

		totals(filter = {}) {
			const clauses: string[] = [];
			const params: SqlValue[] = [];
			if (filter.since) {
				clauses.push("started_at >= ?");
				params.push(filter.since);
			}
			if (filter.agentKey) {
				clauses.push("agent_key = ?");
				params.push(filter.agentKey);
			}
			const w = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
			const row = one(
				db,
				`SELECT count(*) AS runs, coalesce(sum(input_tokens), 0) AS i, coalesce(sum(output_tokens), 0) AS o,
				 coalesce(sum(cache_read_tokens), 0) AS cr, coalesce(sum(cache_write_tokens), 0) AS cw,
				 coalesce(sum(cost_micro_usd), 0) AS c FROM runs ${w}`,
				...params,
			) as Row;
			return {
				runs: Number(row.runs),
				inputTokens: Number(row.i),
				outputTokens: Number(row.o),
				cacheReadTokens: Number(row.cr),
				cacheWriteTokens: Number(row.cw),
				costMicroUsd: Number(row.c),
			};
		},
	};
}

export function transcriptOps(db: DatabaseSync): Sync<TranscriptStore> {
	return {
		load(sessionId) {
			return all(
				db,
				"SELECT seq, message FROM transcript_messages WHERE session_id = ? ORDER BY seq",
				sessionId,
			).map((r) => ({
				seq: Number(r.seq),
				message: JSON.parse(String(r.message)) as unknown,
			}));
		},
		append(sessionId, messages) {
			const next = one<{ n: number }>(
				db,
				"SELECT coalesce(max(seq), -1) + 1 AS n FROM transcript_messages WHERE session_id = ?",
				sessionId,
			);
			let seq = Number(next?.n ?? 0);
			const now = nowIso();
			const insert = db.prepare(
				"INSERT INTO transcript_messages (session_id, seq, message, created_at) VALUES (?, ?, ?, ?)",
			);
			for (const m of messages)
				insert.run(sessionId, seq++, JSON.stringify(m), now);
		},
		replace(sessionId, seq, message) {
			const changed = run(
				db,
				"UPDATE transcript_messages SET message = ? WHERE session_id = ? AND seq = ?",
				JSON.stringify(message),
				sessionId,
				seq,
			);
			if (changed === 0)
				throw new Error(`no message ${seq} in session ${sessionId}`);
		},
	};
}

const APPROVAL_COLUMNS =
	"id, run_id, session_id, agent_key, tool, tool_call_id, args, status, decided_by, note, created_at, decided_at";

export function approvalOps(db: DatabaseSync): Sync<ApprovalStore> {
	const get = (id: string) => {
		const row = one(
			db,
			`SELECT ${APPROVAL_COLUMNS} FROM approvals WHERE id = ?`,
			id,
		);
		return row ? toApproval(row) : null;
	};
	return {
		create(input) {
			const id = randomUUID();
			run(
				db,
				"INSERT INTO approvals (id, run_id, session_id, agent_key, tool, tool_call_id, args, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
				id,
				input.runId,
				input.sessionId,
				input.agentKey,
				input.tool,
				input.toolCallId,
				JSON.stringify(input.args),
				nowIso(),
			);
			return get(id) as Approval;
		},
		get,
		list(filter = {}) {
			const clauses: string[] = [];
			const params: SqlValue[] = [];
			if (filter.status) {
				clauses.push("status = ?");
				params.push(filter.status);
			}
			if (filter.sessionId) {
				clauses.push("session_id = ?");
				params.push(filter.sessionId);
			}
			const w = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
			return all(
				db,
				`SELECT ${APPROVAL_COLUMNS} FROM approvals ${w} ORDER BY seq LIMIT ?`,
				...params,
				filter.limit ?? 50,
			).map(toApproval);
		},
		decide(approvalId, decision) {
			const changed = run(
				db,
				"UPDATE approvals SET status = ?, decided_by = ?, note = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
				decision.approved ? "approved" : "rejected",
				decision.by,
				decision.note ?? null,
				nowIso(),
				approvalId,
			);
			const approval = get(approvalId);
			if (!approval) throw new Error(`no approval ${approvalId}`);
			if (changed === 0)
				throw new Error(
					`approval ${approvalId} was already ${approval.status}`,
				);
			return approval;
		},
	};
}

function toRun(row: Row): Run {
	return {
		id: String(row.id),
		sessionId: String(row.session_id),
		agentKey: String(row.agent_key),
		status: row.status as Run["status"],
		model: (row.model as string | null) ?? null,
		trigger: String(row.trigger),
		input: (row.input as string | null) ?? null,
		output: (row.output as string | null) ?? null,
		error: (row.error as string | null) ?? null,
		inputTokens: Number(row.input_tokens),
		outputTokens: Number(row.output_tokens),
		cacheReadTokens: Number(row.cache_read_tokens),
		cacheWriteTokens: Number(row.cache_write_tokens),
		costMicroUsd: Number(row.cost_micro_usd),
		startedAt: String(row.started_at),
		endedAt: (row.ended_at as string | null) ?? null,
	};
}

function toApproval(row: Row): Approval {
	return {
		id: String(row.id),
		runId: String(row.run_id),
		sessionId: String(row.session_id),
		agentKey: String(row.agent_key),
		tool: String(row.tool),
		toolCallId: String(row.tool_call_id),
		args: json(row.args),
		status: row.status as Approval["status"],
		decidedBy: (row.decided_by as string | null) ?? null,
		note: (row.note as string | null) ?? null,
		createdAt: String(row.created_at),
		decidedAt: (row.decided_at as string | null) ?? null,
	};
}
