/**
 * What the agent brain stores: every run with its tokens and cost (the Runs
 * page, survival's burn rate), the transcript of each agent session, and the
 * approvals waiting for a human.
 */

export type RunStatus =
	| "running"
	| "done"
	| "awaiting_approval"
	| "error"
	| "aborted";

export interface RunUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	/** Millionths of a US dollar, so sums stay exact. */
	costMicroUsd: number;
}

export interface Run extends RunUsage {
	id: string;
	/** The transcript this run continued, e.g. "telegram:chat-1:host". */
	sessionId: string;
	/** Graph key of the agent. */
	agentKey: string;
	status: RunStatus;
	/** "provider/model", e.g. "anthropic/claude-sonnet-5". */
	model: string | null;
	/** What started it: a message, a heartbeat, a human's decision. */
	trigger: string;
	input: string | null;
	output: string | null;
	error: string | null;
	startedAt: string;
	endedAt: string | null;
}

export interface RunStore {
	start(input: {
		sessionId: string;
		agentKey: string;
		model: string | null;
		trigger: string;
		input: string | null;
	}): Promise<Run>;
	addUsage(runId: string, usage: RunUsage): Promise<void>;
	finish(
		runId: string,
		result: {
			status: Exclude<RunStatus, "running">;
			output?: string | null;
			error?: string | null;
		},
	): Promise<Run>;
	get(runId: string): Promise<Run | null>;
	/** Newest first. */
	list(filter?: {
		agentKey?: string;
		sessionId?: string;
		status?: RunStatus;
		limit?: number;
	}): Promise<Run[]>;
	/** Totals for runs started at or after `since` (all runs when omitted). */
	totals(filter?: {
		since?: string;
		agentKey?: string;
	}): Promise<RunUsage & { runs: number }>;
}

/** One agent session's transcript, as the brain's own JSON messages, in order. */
export interface TranscriptStore {
	load(sessionId: string): Promise<{ seq: number; message: unknown }[]>;
	append(sessionId: string, messages: unknown[]): Promise<void>;
	/** Rewrites one message — used when a human decides on a tool call that was waiting. */
	replace(sessionId: string, seq: number, message: unknown): Promise<void>;
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface Approval {
	id: string;
	runId: string;
	sessionId: string;
	agentKey: string;
	tool: string;
	toolCallId: string;
	args: Record<string, unknown>;
	status: ApprovalStatus;
	decidedBy: string | null;
	note: string | null;
	createdAt: string;
	decidedAt: string | null;
}

export interface ApprovalStore {
	create(input: {
		runId: string;
		sessionId: string;
		agentKey: string;
		tool: string;
		toolCallId: string;
		args: Record<string, unknown>;
	}): Promise<Approval>;
	get(approvalId: string): Promise<Approval | null>;
	/** Oldest first. */
	list(filter?: {
		status?: ApprovalStatus;
		sessionId?: string;
		limit?: number;
	}): Promise<Approval[]>;
	/** Records the decision. Throws if it was already decided, so a decision is taken once. */
	decide(
		approvalId: string,
		decision: { approved: boolean; by: string; note?: string | null },
	): Promise<Approval>;
}
