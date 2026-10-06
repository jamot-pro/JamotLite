import { statfsSync } from "node:fs";
import type { CompanyStore } from "@jamot/ports";
import { computeReadiness, type Readiness } from "../readiness/readiness.js";

/**
 * The survival kernel's vital signs (RUNTIME §7): money, people, work and the
 * runtime itself. Measured, never guessed: when something can't be measured
 * (no ledger entries yet), it says "unknown" instead of looking healthy.
 */

export type Tier = "normal" | "low_funding" | "critical";

export interface Vitals {
	at: string;
	tier: Tier;
	money: {
		currency: string | null;
		/** Minor units. */
		balance: number | null;
		/** Minor units spent per day, over the last 30 days. */
		dailyBurn: number | null;
		/** Days of money left at that burn; null when unknown or nothing is spent. */
		runwayDays: number | null;
		/** What the agents cost in the last 30 days, in millionths of a dollar. */
		llmCostMicroUsd30d: number;
	};
	people: {
		readiness: Readiness;
		unowned: { key: string; name: string }[];
		/** People who own responsibilities and haven't been heard from in a while. */
		quiet: { key: string; name: string; lastSeen: string | null }[];
	};
	work: {
		/** Conversations whose last message is a person's, unanswered for a while. */
		waiting: { conversationId: string; personName: string; since: string }[];
		failedReplies24h: number;
		deadJobs24h: number;
	};
	runtime: {
		lastBackupAt: string | null;
		diskFreeBytes: number | null;
		/** Telegram stopped receiving messages (D57): when, and why. */
		telegramStopped: { at: string; reason: string } | null;
	};
}

export interface SurvivalSettings {
	/** The company's operating currency, e.g. "EUR". Default: the ledger's most used. */
	currency?: string;
	lowRunwayDays: number;
	criticalRunwayDays: number;
	/** How long before a quiet owner is flagged. */
	quietDays: number;
	/** How long a message may wait for an answer. */
	waitingMinutes: number;
	/** How long the owner may be silent before the successor is contacted. */
	successionDays: number;
}

export const DEFAULT_SURVIVAL: SurvivalSettings = {
	lowRunwayDays: 60,
	criticalRunwayDays: 14,
	quietDays: 14,
	waitingMinutes: 30,
	successionDays: 14,
};

export async function survivalSettings(
	store: CompanyStore,
): Promise<SurvivalSettings> {
	return {
		...DEFAULT_SURVIVAL,
		...((await store.settings.get<Partial<SurvivalSettings>>("survival")) ??
			{}),
	};
}

export async function computeVitals(
	store: CompanyStore,
	opts: { now?: Date; dataDir?: string } = {},
): Promise<Vitals> {
	const now = opts.now ?? new Date();
	const settings = await survivalSettings(store);
	const since = (days: number) =>
		new Date(now.getTime() - days * 86_400_000).toISOString();

	// Money
	const currency =
		settings.currency ?? (await store.ledger.currencies())[0] ?? null;
	let balance: number | null = null;
	let dailyBurn: number | null = null;
	let runwayDays: number | null = null;
	if (currency) {
		balance = await store.ledger.balance(currency);
		const flow = await store.ledger.flow(currency, since(30));
		dailyBurn = Math.round(flow.out / 30);
		runwayDays = dailyBurn > 0 ? Math.floor(balance / dailyBurn) : null;
	}
	const llm = await store.runs.totals({ since: since(30) });
	let tier: Tier = "normal";
	if (balance !== null && dailyBurn !== null && dailyBurn > 0) {
		if (balance <= 0 || (runwayDays ?? 0) < settings.criticalRunwayDays)
			tier = "critical";
		else if ((runwayDays ?? 0) < settings.lowRunwayDays) tier = "low_funding";
	}

	// People
	const nodes = await store.graph.listNodes();
	const edges = await store.graph.listEdges();
	const readiness = computeReadiness({ nodes, edges });
	const unowned =
		readiness.dimensions.find((d) => d.key === "responsibilities")?.missing ??
		[];
	const owning = new Set(
		edges
			.filter((e) => e.relation === "responsible_for" || e.relation === "owns")
			.map((e) => e.fromNodeId),
	);
	const quiet: Vitals["people"]["quiet"] = [];
	for (const n of nodes) {
		if (n.kind !== "human" || !n.refId || !owning.has(n.id)) continue;
		const person = await store.people.get(n.refId);
		// Never heard from is "unknown", not "quiet": only people who went silent count.
		if (
			person?.lastInteractionAt &&
			person.lastInteractionAt < since(settings.quietDays)
		) {
			quiet.push({
				key: n.key,
				name: n.name,
				lastSeen: person.lastInteractionAt,
			});
		}
	}

	// Work
	const waiting: Vitals["work"]["waiting"] = [];
	const waitingSince = new Date(
		now.getTime() - settings.waitingMinutes * 60_000,
	).toISOString();
	for (const c of await store.conversations.list({ limit: 200 })) {
		const [last] = await store.conversations.listMessages(c.id, { limit: 1 });
		if (last?.direction === "in" && last.createdAt < waitingSince) {
			const person = c.personId ? await store.people.get(c.personId) : null;
			waiting.push({
				conversationId: c.id,
				personName: person?.displayName ?? "someone",
				since: last.createdAt,
			});
		}
	}
	const failedReplies24h = (
		await store.events.list({
			type: "agent.reply_failed",
			since: since(1),
			limit: 1000,
		})
	).length;
	const deadJobs24h = (
		await store.jobs.list({ status: "dead", limit: 1000 })
	).filter((j) => j.updatedAt >= since(1)).length;

	// Runtime
	let diskFreeBytes: number | null = null;
	if (opts.dataDir) {
		try {
			const fs = statfsSync(opts.dataDir);
			diskFreeBytes = fs.bavail * fs.bsize;
		} catch {
			diskFreeBytes = null;
		}
	}

	return {
		at: now.toISOString(),
		tier,
		money: {
			currency,
			balance,
			dailyBurn,
			runwayDays,
			llmCostMicroUsd30d: llm.costMicroUsd,
		},
		people: {
			readiness,
			unowned: unowned.map((g) => ({ key: g.key ?? "", name: g.name })),
			quiet,
		},
		work: { waiting, failedReplies24h, deadJobs24h },
		runtime: {
			lastBackupAt:
				(await store.settings.get<string>("runtime.lastBackupAt")) ?? null,
			diskFreeBytes,
			telegramStopped:
				(await store.settings.get<{ at: string; reason: string }>(
					"telegram.stopped",
				)) ?? null,
		},
	};
}

/** What a survival tier allows an agent run to spend. */
export function budgetForTier(
	tier: Tier,
): { maxCostMicroUsd?: number; maxTurns?: number } | undefined {
	if (tier === "critical") return { maxCostMicroUsd: 5_000, maxTurns: 3 };
	if (tier === "low_funding") return { maxCostMicroUsd: 20_000, maxTurns: 6 };
	return undefined;
}
