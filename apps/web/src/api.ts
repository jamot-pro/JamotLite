/** The runtime's JSON API. Every call sends the session cookie; a 401 means "sign in". */
export class SignedOut extends Error {}

export async function api<T>(
	path: string,
	init: { method?: string; body?: unknown } = {},
): Promise<T> {
	const res = await fetch(`/api${path}`, {
		method: init.method ?? "GET",
		credentials: "same-origin",
		headers:
			init.body !== undefined ? { "content-type": "application/json" } : {},
		...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
	});
	if (res.status === 401 && path !== "/login") throw new SignedOut();
	const type = res.headers.get("content-type") ?? "";
	const data = type.includes("json") ? await res.json() : await res.text();
	if (!res.ok)
		throw new Error(
			(data as { error?: string }).error ?? `request failed (${res.status})`,
		);
	return data as T;
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

export interface Overview {
	company: {
		id: string;
		name: string;
		summary: string;
		timezone: string;
		founderKey: string | null;
	};
	charter: {
		vision: string | null;
		mission: string | null;
		values: string[];
		goals: string[];
	} | null;
	vitals: Vitals;
	pendingApprovals: number;
	issues: { key: string; title: string; since: string }[];
}

export interface MapNode {
	id: string;
	key: string;
	kind:
		| "dream"
		| "team"
		| "human"
		| "agent"
		| "responsibility"
		| "tool"
		| "heartbeat";
	name: string;
	config: Record<string, unknown>;
}
export interface MapEdge {
	id: string;
	from: string;
	to: string;
	relation: string;
}

export interface Person {
	id: string;
	name: string;
	email: string | null;
	phone: string | null;
	lastInteractionAt: string | null;
}

export interface Run {
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

export interface Approval {
	id: string;
	agentKey: string;
	tool: string;
	args: Record<string, unknown>;
	createdAt: string;
}

export const usd = (micro: number) =>
	`$${(micro / 1_000_000).toFixed(micro < 10_000 ? 4 : 2)}`;
export const when = (iso: string | null) =>
	iso ? new Date(iso).toLocaleString() : "—";
