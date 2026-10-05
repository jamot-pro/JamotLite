import type { CompanyStore, StoredNode } from "@jamot/ports";
import { computeReadiness } from "../readiness/readiness.js";
import {
	computeVitals,
	survivalSettings,
	type Tier,
} from "../survival/vitals.js";
import {
	type Notifier,
	OWNER_LAST_SEEN,
	type OwnerAction,
	SUCCESSION,
} from "./notify.js";

/**
 * One heartbeat run: Monitor → Evaluate → Act → Verify.
 *
 * Monitor what the heartbeat watches (the Dream, a team); evaluate it into
 * issues; act by telling the owner, with a proposed fix they can take in one
 * tap; verify on the next run — an issue that is gone is reported as fixed.
 * The owner hears about a new issue once, then a reminder a day later, never
 * every minute (the old survival loop's first bug).
 */

export interface HeartbeatDeps {
	store: CompanyStore;
	notifier: Notifier;
	now?: () => Date;
	dataDir?: string;
}

export interface Issue {
	key: string;
	title: string;
	proposal: string;
	actions?: OwnerAction[];
}

interface OpenIssue {
	title: string;
	openedAt: string;
	notifiedAt: string | null;
}

const REMIND_AFTER_MS = 24 * 60 * 60 * 1000;
const TIER = "survival.tier";

export async function runHeartbeat(
	deps: HeartbeatDeps,
	heartbeatKey: string,
): Promise<{
	issues: Issue[];
	opened: string[];
	resolved: string[];
	notified: boolean;
}> {
	const { store } = deps;
	const now = deps.now?.() ?? new Date();
	const company = await store.graph.getCompany();
	const nodes = await store.graph.listNodes();
	const edges = await store.graph.listEdges();
	const heartbeat = nodes.find(
		(n) => n.kind === "heartbeat" && n.key === heartbeatKey,
	);
	if (!company || !heartbeat)
		return { issues: [], opened: [], resolved: [], notified: false };

	const byId = new Map(nodes.map((n) => [n.id, n]));
	const targets = edges
		.filter((e) => e.fromNodeId === heartbeat.id && e.relation === "monitors")
		.map((e) => byId.get(e.toNodeId))
		.filter((n): n is StoredNode => n !== undefined);

	// Monitor + evaluate
	const issues: Issue[] = [];
	// The people of the teams this heartbeat watches: they hear about it too.
	const teamPeople = new Set<string>();
	const founder = company.founderKey
		? nodes.find((n) => n.key === company.founderKey)
		: undefined;
	const vitals = await computeVitals(store, {
		now,
		...(deps.dataDir ? { dataDir: deps.dataDir } : {}),
	});

	for (const target of targets) {
		if (target.kind === "dream") {
			for (const r of computeReadiness({ nodes, edges }).dimensions.find(
				(d) => d.key === "responsibilities",
			)?.missing ?? []) {
				if (!r.key) continue;
				const take = founder ? `assign:${r.key}:${founder.key}` : null;
				issues.push({
					key: `unowned:${r.key}`,
					title: `Nobody owns “${r.name}”`,
					proposal: "Take it yourself, or find the person or agent who should.",
					...(take && take.length <= 64
						? {
								actions: [
									{ label: `I'll take “${short(r.name)}”`, action: take },
								],
							}
						: {}),
				});
			}
			issues.push(...vitalIssues(vitals));
			await trackTier(store, vitals.tier, vitals);
			await checkSuccession(deps, now, company.name);
		} else if (target.kind === "team") {
			const members = edges
				.filter((e) => e.toNodeId === target.id && e.relation === "member_of")
				.map((e) => byId.get(e.fromNodeId))
				.filter((n) => n?.kind === "human" || n?.kind === "agent");
			for (const m of members) if (m?.kind === "human") teamPeople.add(m.key);
			if (members.length === 0) {
				issues.push({
					key: `empty-team:${target.key}`,
					title: `Nobody is in ${target.name}`,
					proposal: "Add a person or an agent to it.",
				});
			}
			for (const q of vitals.people.quiet) {
				if (members.some((m) => m?.key === q.key)) {
					issues.push({
						key: `quiet:${q.key}`,
						title: `${q.name} has been quiet since ${q.lastSeen?.slice(0, 10)}`,
						proposal:
							"Check in with them — what they own may need a new owner.",
					});
				}
			}
		}
	}

	// Act + verify
	const stateKey = `heartbeat.issues.${heartbeat.key}`;
	const open =
		(await store.settings.get<Record<string, OpenIssue>>(stateKey)) ?? {};
	const current = new Map(issues.map((i) => [i.key, i]));
	const resolved = Object.entries(open)
		.filter(([key]) => !current.has(key))
		.map(([key, issue]) => ({ key, title: issue.title }));
	const opened = issues.filter((i) => !open[i.key]);
	const remind = issues.filter((i) => {
		const was = open[i.key];
		return (
			was &&
			(was.notifiedAt === null ||
				now.getTime() - Date.parse(was.notifiedAt) >= REMIND_AFTER_MS)
		);
	});

	let notified = false;
	if (opened.length + remind.length + resolved.length > 0) {
		const lines = [`💓 ${heartbeat.name} — ${company.name}`];
		if (opened.length + remind.length > 0) {
			lines.push("", "Needs you:");
			for (const i of [...opened, ...remind])
				lines.push(
					`• ${i.title}${open[i.key] ? " (reminder)" : ""}`,
					`  → ${i.proposal}`,
				);
		}
		if (resolved.length > 0)
			lines.push(
				"",
				"Fixed since last time:",
				...resolved.map((r) => `✅ ${r.title}`),
			);
		const actions = [...opened, ...remind]
			.flatMap((i) => i.actions ?? [])
			.slice(0, 6);
		notified = await deps.notifier.toOwner({
			text: lines.join("\n"),
			...(actions.length ? { actions } : {}),
		});
		if (teamPeople.size > 0 && deps.notifier.toMembers)
			await deps.notifier
				.toMembers([...teamPeople], { text: lines.join("\n") })
				.catch(() => 0);
		if (!notified) {
			await store.events.append({
				type: "heartbeat.unrouted",
				source: `heartbeat/${heartbeat.key}`,
				subject: heartbeat.key,
				data: { issues: issues.length },
				idempotencyKey: `heartbeat-unrouted:${heartbeat.key}:${now.toISOString()}`,
			});
		}
	}

	const next: Record<string, OpenIssue> = {};
	const told = notified ? now.toISOString() : null;
	for (const i of issues) {
		const was = open[i.key];
		const reminded = remind.includes(i);
		next[i.key] = {
			title: i.title,
			openedAt: was?.openedAt ?? now.toISOString(),
			notifiedAt:
				!was || reminded ? (told ?? was?.notifiedAt ?? null) : was.notifiedAt,
		};
	}
	await store.settings.set(stateKey, next);
	for (const i of opened) {
		await store.events.append({
			type: "issue.opened",
			source: `heartbeat/${heartbeat.key}`,
			subject: i.key,
			data: { title: i.title },
			idempotencyKey: `issue-opened:${heartbeat.key}:${i.key}:${next[i.key]?.openedAt}`,
		});
	}
	for (const r of resolved) {
		await store.events.append({
			type: "issue.resolved",
			source: `heartbeat/${heartbeat.key}`,
			subject: r.key,
			data: { title: r.title },
			idempotencyKey: `issue-resolved:${heartbeat.key}:${r.key}:${open[r.key]?.openedAt}`,
		});
	}
	return {
		issues,
		opened: opened.map((i) => i.key),
		resolved: resolved.map((r) => r.key),
		notified,
	};
}

function vitalIssues(v: Awaited<ReturnType<typeof computeVitals>>): Issue[] {
	const issues: Issue[] = [];
	if (v.tier !== "normal" && v.money.currency) {
		const left =
			v.money.runwayDays === null
				? "no money left"
				: `${v.money.runwayDays} days of money left`;
		issues.push({
			key: `money:${v.tier}`,
			title: `${v.tier === "critical" ? "Critical" : "Low"}: ${left} at the current spend (${v.money.currency})`,
			proposal:
				"Cut spending or bring money in. Agents now spend less per answer until this improves.",
		});
	}
	for (const w of v.work.waiting) {
		issues.push({
			key: `waiting:${w.conversationId}`,
			title: `${w.personName} has been waiting for an answer since ${w.since.slice(11, 16)} UTC`,
			proposal:
				"Answer them on Telegram, or check the agent's runs for what went wrong.",
		});
	}
	if (v.work.failedReplies24h > 0) {
		issues.push({
			key: "failed-replies",
			title: `${v.work.failedReplies24h} message(s) got no answer in the last day — the agent failed`,
			proposal:
				"Check the model and its key (`jamot doctor`), and the Runs page.",
		});
	}
	if (v.work.deadJobs24h > 0) {
		issues.push({
			key: "dead-jobs",
			title: `${v.work.deadJobs24h} background job(s) gave up in the last day`,
			proposal: "Run `jamot doctor` to see why.",
		});
	}
	if (
		v.runtime.lastBackupAt &&
		Date.parse(v.at) - Date.parse(v.runtime.lastBackupAt) > 48 * 3_600_000
	) {
		issues.push({
			key: "backup",
			title: `No backup since ${v.runtime.lastBackupAt.slice(0, 10)}`,
			proposal:
				"Daily backups have stopped: look for `backup failed` in the logs, then run `jamot backup`.",
		});
	}
	if (
		v.runtime.diskFreeBytes !== null &&
		v.runtime.diskFreeBytes < 500 * 1024 * 1024
	) {
		issues.push({
			key: "disk",
			title: "Less than 500 MB of disk left",
			proposal: "Free some space before the company can't save anything.",
		});
	}
	return issues;
}

/** Records the survival tier only when it changes (the old loop wrote it every minute). */
async function trackTier(
	store: CompanyStore,
	tier: Tier,
	vitals: unknown,
): Promise<void> {
	const previous = (await store.settings.get<Tier>(TIER)) ?? "normal";
	if (previous === tier) return;
	await store.settings.set(TIER, tier);
	await store.events.append({
		type: "survival.tier_changed",
		source: "survival",
		subject: tier,
		data: {
			from: previous,
			to: tier,
			vitals: vitals as Record<string, unknown>,
		},
		idempotencyKey: `tier:${previous}->${tier}:${new Date().toISOString()}`,
	});
}

/** The dead man's switch: an owner silent too long hands over to the successor. */
async function checkSuccession(
	deps: HeartbeatDeps,
	now: Date,
	companyName: string,
): Promise<void> {
	const { store } = deps;
	const lastSeen = await store.settings.get<string>(OWNER_LAST_SEEN);
	if (!lastSeen) return;
	const { successionDays } = await survivalSettings(store);
	const active = await store.settings.get<{ since: string }>(SUCCESSION);
	const silentFor = now.getTime() - Date.parse(lastSeen);

	if (!active && silentFor >= successionDays * 86_400_000) {
		const told = await deps.notifier.toSuccessor({
			text: [
				`🕯 ${companyName}: the owner has been silent since ${lastSeen.slice(0, 10)}.`,
				"You are the named successor. From now on, approvals and heartbeat alerts come to you as well, until the owner is back.",
			].join("\n"),
		});
		if (told) {
			await store.settings.set(SUCCESSION, { since: now.toISOString() });
			await store.events.append({
				type: "succession.started",
				source: "survival",
				subject: "successor",
				data: { ownerLastSeen: lastSeen },
				idempotencyKey: `succession:${lastSeen}`,
			});
		}
	} else if (active && Date.parse(lastSeen) > Date.parse(active.since)) {
		await store.settings.delete(SUCCESSION);
		await deps.notifier.toSuccessor({
			text: `${companyName}: the owner is back. Thank you for standing by.`,
		});
		await store.events.append({
			type: "succession.ended",
			source: "survival",
			subject: "successor",
			idempotencyKey: `succession-ended:${active.since}`,
		});
	}
}

function short(name: string): string {
	return name.length > 24 ? `${name.slice(0, 23)}…` : name;
}
