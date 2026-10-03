import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";

/**
 * The Brain port. Everything outside `packages/brain` talks to agents through
 * these types only; pi's own types stay inside this package (RUNTIME D17), so
 * a pi upgrade — or replacing pi — touches one place.
 */

/** What decides whether a tool call may run. */
export type ToolPolicy =
	/** Runs straight away. */
	| "allow"
	/** Waits for a human to approve it (payments, contracts, anything irreversible). */
	| "approve"
	/** Never runs; the agent is told so. */
	| "deny";

export interface ToolContext {
	runId: string;
	sessionId: string;
	agentKey: string;
	signal: AbortSignal;
}

export interface ToolResult {
	/** What the model reads. */
	text: string;
	/** Structured detail for logs and the Runs page; not sent to the model. */
	details?: Record<string, unknown>;
	isError?: boolean;
}

export interface BrainTool {
	/** Letters, digits, `_` and `-` only — the rule every model provider enforces. */
	name: string;
	description: string;
	/** JSON Schema of the arguments (an object schema). */
	parameters: Record<string, unknown>;
	policy?: ToolPolicy;
	/** Default 30 seconds. The tool is told through `signal` when time is up. */
	timeoutMs?: number;
	execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

/** A model the brain can call. Build one with `connectModel` (or `fakeModel` in tests). */
export interface ModelAccess {
	/** "provider/model", recorded on every run. */
	label: string;
	model: Model<never>;
	streamFn: StreamFn;
}

export interface AgentSpec {
	/** Graph key of the agent node. */
	key: string;
	/** The agent's instructions, from its node's config. */
	instructions: string;
	model: ModelAccess;
	tools: BrainTool[];
	budget?: {
		/** Stop the run once it has cost this much (millionths of a dollar). */
		maxCostMicroUsd?: number;
		/** Stop after this many model turns. */
		maxTurns?: number;
	};
}

export type RunOutcome =
	| { status: "done"; runId: string; text: string }
	| {
			status: "awaiting_approval";
			runId: string;
			text: string;
			approvalIds: string[];
	  }
	| { status: "error"; runId: string; message: string }
	| { status: "aborted"; runId: string; message: string };

export interface Brain {
	/** Runs the agent on a session with new input (a message, a heartbeat's report). */
	run(input: {
		agent: AgentSpec;
		sessionId: string;
		input: string;
		trigger: string;
	}): Promise<RunOutcome>;
	/** Records a human's decision on a waiting tool call and lets the agent carry on. */
	decide(input: {
		agent: AgentSpec;
		approvalId: string;
		approved: boolean;
		by: string;
		note?: string;
	}): Promise<RunOutcome>;
	/** Stops the run currently working on a session, if any. */
	abort(sessionId: string): void;
	/** At boot: closes runs a stopped process left open, so they don't look alive. */
	recoverInterrupted(): Promise<number>;
}
