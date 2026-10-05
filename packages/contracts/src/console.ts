/**
 * What the console's JSON API (`/api`) returns: the one place these shapes
 * are written. The runtime's routes are typed with them and the web console
 * imports them, so a change here fails the build on both sides instead of a
 * screen at runtime (RUNTIME D46). Types only: nothing here runs.
 */

export interface Me {
	signedIn: boolean;
	passwordSet: boolean;
	/** A demo company (`jamot demo`): the console says so. */
	demo: boolean;
}

export interface Vitals {
	tier: "normal" | "low_funding" | "critical";
	money: {
		currency: string | null;
		balance: number | null;
		dailyBurn: number | null;
		runwayDays: number | null;
		llmCostMicroUsd30d: number;
	};
	people: {
		readiness: {
			overall: number;
			covered: boolean;
			dimensions: {
				key: string;
				label: string;
				score: number;
				missing: { key: string | null; name: string }[];
			}[];
		};
		unowned: { key: string; name: string }[];
		quiet: { key: string; name: string; lastSeen: string | null }[];
	};
	work: {
		waiting: { conversationId: string; personName: string; since: string }[];
		failedReplies24h: number;
		deadJobs24h: number;
	};
	runtime: { lastBackupAt: string | null; diskFreeBytes: number | null };
}

export interface Charter {
	vision: string | null;
	mission: string | null;
	values: string[];
	goals: string[];
}

export interface OverviewView {
	company: {
		id: string;
		name: string;
		summary: string;
		timezone: string;
		founderKey: string | null;
	} | null;
	charter: Charter | null;
	/** The charter under its old code name, for clients that read it. */
	dream: Record<string, unknown> | null;
	vitals: Vitals;
	pendingApprovals: number;
	issues: { key: string; title: string; since: string }[];
}

export type NodeKind =
	| "dream"
	| "team"
	| "human"
	| "agent"
	| "responsibility"
	| "tool"
	| "heartbeat";

export interface MapNode {
	id: string;
	key: string;
	kind: NodeKind;
	name: string;
	config: Record<string, unknown>;
	refId: string | null;
}
export interface MapEdge {
	id: string;
	from: string;
	to: string;
	relation: string;
}
export interface MapView {
	nodes: MapNode[];
	edges: MapEdge[];
}

export interface PersonRow {
	id: string;
	name: string;
	email: string | null;
	phone: string | null;
	lastInteractionAt: string | null;
}

export interface PersonProfile {
	person: {
		id: string;
		displayName: string;
		email: string | null;
		phone: string | null;
		lastInteractionAt: string | null;
	};
	identities: { id: string; provider: string; value: string }[];
	memories: {
		id: string;
		kind: string;
		content: string;
		source: string;
		createdAt: string;
	}[];
	conversations: {
		id: string;
		channel: string;
		lastMessageAt: string | null;
	}[];
}

export interface MessageRow {
	id: string;
	direction: "in" | "out";
	text: string;
	agentKey: string | null;
	status: string;
	createdAt: string;
}

export interface RunRow {
	id: string;
	agentKey: string;
	status: string;
	trigger: string;
	model: string | null;
	output: string | null;
	error: string | null;
	inputTokens: number;
	outputTokens: number;
	costMicroUsd: number;
	startedAt: string;
}
export interface RunTotals {
	runs: number;
	inputTokens: number;
	outputTokens: number;
	costMicroUsd: number;
}
export interface RunsView {
	last30Days: RunTotals;
	runs: RunRow[];
}

export interface ApprovalRow {
	id: string;
	agentKey: string;
	tool: string;
	args: Record<string, unknown>;
	createdAt: string;
}
export interface ApprovalsView {
	pending: ApprovalRow[];
}

export interface SettingsView {
	model: { provider: string; modelId: string; baseUrl?: string } | null;
	modelKeySet: boolean;
	owner: { name: string } | null;
	successor: { name: string } | null;
	/** Money settings for the survival tier, when set. */
	survival: unknown;
	version: string;
}

export interface McpInfo {
	url: string;
	token: string;
}

/** What an action tells the owner it did. */
export interface ActionResult {
	message: string;
}
