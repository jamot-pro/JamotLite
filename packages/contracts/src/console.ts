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
	/**
	 * The runtime is being set up (D55): there's no company yet, and the
	 * console shows only the setup until the founder starts it.
	 */
	setup?: boolean;
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
	runtime: {
		lastBackupAt: string | null;
		diskFreeBytes: number | null;
		telegramStopped: { at: string; reason: string } | null;
	};
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
	/** The backup model for when the first is down or rate-limited (D57). */
	fallback: { provider: string; modelId: string; baseUrl?: string } | null;
	fallbackKeySet: boolean;
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
	/** When they were last active on Telegram, if Jamot has seen them (D53). */
	lastSeen: string | null;
	/** A check-in waiting for their answer, or a pause they chose (D53). */
	away: { state: "asked" | "paused"; at: string } | null;
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

/**
 * Something a person did for the company, on the record (VISION.md, D54):
 * joining, taking on a role, or work they reported with /did and the founder
 * confirmed.
 */
export interface ContributionRow {
	id: string;
	who: { key: string; name: string };
	what: string;
	at: string;
	kind: "joined" | "took" | "did";
	/** A /did waits for the founder's confirmation ("claimed"). */
	status: "confirmed" | "claimed" | "declined";
}

/** A reward the founder recorded — a note, never a payment (D54). */
export interface RewardRow {
	id: string;
	who: { key: string; name: string };
	note: string;
	at: string;
	contributionId: string | null;
}

/** The numbers VISION.md's experiment watches. */
export interface ExperimentView {
	invited: number;
	joined: number;
	/** Of those who joined: confirmed work within two weeks of joining. */
	firstWorkIn2Weeks: number;
	/** People who joined at least six weeks ago, and how many are still active. */
	joinedSixWeeksAgo: number;
	activeAfterSixWeeks: number;
	/** The last 30 days: agent runs, and people's confirmed contributions. */
	agentRuns30d: number;
	peopleContributions30d: number;
	/** Roles handed over (or opened for no answer), and how many have an owner again. */
	handedOver: number;
	pickedUpAgain: number;
}

export interface ContributionsView {
	contributions: ContributionRow[];
	rewards: RewardRow[];
	people: { key: string; name: string }[];
	experiment: ExperimentView;
}

/** The owner records something someone did. */
export interface ContributionInput {
	nodeKey: string;
	what: string;
}

export interface RewardInput {
	nodeKey: string;
	note: string;
	contributionId?: string | null;
}

/** One question of the setup interview (D55). */
export interface SetupQuestion {
	id: string;
	title: string;
	hint: string;
	/** "short": one line; "text": a few sentences; "lines": a list, one per line. */
	kind: "short" | "text" | "lines";
	/** Setup can't finish without it. */
	required: boolean;
	placeholder: string;
}

/** Where the setup stands — the same on the web and on Telegram. */
export interface SetupState {
	questions: SetupQuestion[];
	answers: Record<string, string>;
	/** Questions the founder chose to leave for later. */
	skipped: string[];
	/** Starting points the company can be built from. */
	templates: { id: string; name: string; summary: string }[];
	telegram: {
		/** The bot's @username, once Telegram is connected. */
		bot: string | null;
		/** The founder's name, once they claimed the setup on Telegram. */
		owner: string | null;
		/** A code to claim the setup on Telegram (`/start <code>`). */
		code: string | null;
	};
	/** Every required question is answered. */
	ready: boolean;
	/** The company drafted from the answers, once drafted (D56). */
	draft: SetupDraft | null;
	/** A model is set, so the company can be drafted; otherwise pick a template. */
	canDraft: boolean;
}

/**
 * The company Jamot drafted from the founder's answers (D56) — what the
 * review shows before "Start my company".
 */
export interface SetupDraft {
	/** The template whose tools it starts from. */
	basedOn: { id: string; name: string };
	charter: {
		vision: string | null;
		mission: string;
		values: string[];
		goals: string[];
	};
	teams: { name: string; purpose: string }[];
	responsibilities: {
		name: string;
		team: string | null;
		owner:
			| { kind: "founder" | "agent" | "person"; name: string }
			| { kind: "open"; name: null };
	}[];
	agents: { name: string; role: string; team: string | null }[];
	/** People the founder named, who join the map (and are invited after). */
	people: { name: string; role: string }[];
	successor: string | null;
}

export interface SetupAnswer {
	id: string;
	/** Empty: "I don't know yet". */
	value: string;
}

/** Start the company: from the draft, or from a template when there's none. */
export interface SetupFinish {
	template?: string;
}
