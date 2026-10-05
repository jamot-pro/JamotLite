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
	/** The stewards' Telegram group the bot posts heartbeats to (D49). */
	group: { title: string; connectedAt: string } | null;
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

/** One agent, as the Agents page shows it (RUNTIME D47). */
export interface AgentRow {
	key: string;
	name: string;
	role: string | null;
	instructions: string;
	teams: { key: string; name: string }[];
	/** Tools it uses itself (it can change these here)… */
	tools: string[];
	/** …and the ones it reaches through a team. */
	teamTools: string[];
	/** Responsibilities it owns, by name. */
	owns: string[];
	/** Channels it answers: "Telegram", "Web chat". */
	answers: string[];
	runs30d: { runs: number; costMicroUsd: number };
	lastRunAt: string | null;
	/** Outside AIs connected as this agent (`jamot mcp list`). */
	connections: number;
}

export interface ToolRow {
	key: string;
	name: string;
	purpose: string | null;
	/** What runs straight away and what waits for a person, in a sentence. */
	approval: string;
}

export interface AgentsView {
	agents: AgentRow[];
	retired: { key: string; name: string; retiredAt: string }[];
	teams: { key: string; name: string }[];
	tools: ToolRow[];
	/** The longest name, role and instructions the runtime accepts. */
	limits: { name: number; role: number; instructions: number };
}

/** A new agent, or changes to one (absent fields stay as they are). */
export interface AgentInput {
	name?: string;
	role?: string;
	instructions?: string;
	/** The team it works in; null for none. */
	teamKey?: string | null;
}

/** The tools an agent uses itself, by key — the whole list. */
export interface AgentToolsInput {
	tools: string[];
}

/** A person who runs the company, as the Stewards page shows them (D48). */
export interface StewardRow {
	key: string;
	name: string;
	role: string | null;
	/** Their Telegram and GitHub handles, as the owner wrote them. */
	telegram: string | null;
	github: string | null;
	teams: { key: string; name: string }[];
	owns: { key: string; name: string }[];
	/** The company's founder: always in it, never retired. */
	founder: boolean;
	/** Their Telegram is linked: the bot knows them, team alerts reach them. */
	paired: boolean;
	/** Outside AIs connected as this person. */
	connections: number;
}

export interface StewardsView {
	stewards: StewardRow[];
	retired: { key: string; name: string; retiredAt: string }[];
	teams: { key: string; name: string }[];
	/** Every responsibility and who owns it now (a person, an agent or a team). */
	responsibilities: {
		key: string;
		name: string;
		owner: { key: string; name: string } | null;
	}[];
	/** Invitations to open roles not yet decided (VISION.md, D52). */
	invites: InviteRow[];
}

/**
 * An invitation to an open role: "open" until someone uses the code, then
 * "waiting" for the founder's yes or no (D52).
 */
export interface InviteRow {
	id: string;
	responsibility: { key: string; name: string };
	status: "open" | "waiting";
	/** Who used the code, once someone has. */
	candidate: string | null;
	expiresAt: string;
}

/** A one-time invitation code for an open role, and the bot to send it to. */
export interface RoleInviteCode {
	code: string;
	expiresAt: string;
	/** The bot's username, for a t.me link; null when Telegram isn't connected yet. */
	bot: string | null;
}

/** A new person, or changes to one (absent fields stay as they are). */
export interface StewardInput {
	name?: string;
	role?: string;
	telegram?: string;
	github?: string;
	teamKey?: string | null;
}

/** The responsibilities a person owns, by key — the whole list. */
export interface StewardResponsibilitiesInput {
	responsibilities: string[];
}

/** A one-time code a steward sends the bot as `/start <code>`. */
export interface PairingCode {
	code: string;
}
