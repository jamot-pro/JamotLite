import { randomUUID } from "node:crypto";
import type {
	CompanyPorts,
	CompanyStore,
	StoredEdge,
	StoredNode,
	Task,
	TaskRequesterKind,
	TaskStatus,
} from "@jamot/ports";
import { AgentError } from "../agents/manage.js";
import { pickChannelAgent } from "../agents/spec.js";
import { isRetired } from "../company/retired.js";
import type { Notifier, OwnerAction } from "../heartbeats/notify.js";
import { recordContribution } from "../people/contributions.js";

/**
 * Tasks and the selector (VISION.md C5, RUNTIME D58): someone asks the
 * company to get something done, and the company decides who does it.
 *
 * A task is a row in the tasks table; the jobs queue moves it. The founder's
 * own tasks start at once; anyone else's wait for the founder's yes. The
 * selector finds the responsibility the task belongs to, and gives it to an
 * agent first — the one that owns it, one of the team that needs it, or the
 * company's default agent. The agent does it, asks the founder, or hands it
 * to a person: the responsibility's owner, or else the founder. A person
 * presses Done; the founder confirms, and it goes on their record (D54).
 */

export const TASK_ROUTE_JOB = "task.route";
export const TASK_RUN_JOB = "task.run";
export const TASK_TELL_JOB = "task.tell";
export const TASK_LIMITS = { title: 200, details: 2000, openPerRequester: 20 };
/** Not finished: on someone's list. */
export const OPEN_TASK: TaskStatus[] = [
	"proposed",
	"open",
	"working",
	"review",
	"blocked",
];
const DAY = 86_400_000;
/** A person with a task and no news is reminded after this long. */
export const NUDGE_AFTER_DAYS = 3;
export const TASKS_DIGEST_AT = "tasks.digestAt";

export interface TaskDeps {
	store: CompanyStore;
	notifier: Notifier;
	/**
	 * One question to the company's model (the selector, when it can't tell
	 * which responsibility a task belongs to). Absent: the default agent takes it.
	 */
	ask?: (input: { system: string; prompt: string }) => Promise<string>;
}

/** Who is acting: the founder (or an acting successor), or a person of the map. */
export interface TaskActor {
	founder: boolean;
	/** Their node key; the founder's is the company's founder key. */
	key: string | null;
	name: string;
}

const owning = (relation: string) =>
	relation === "owns" || relation === "responsible_for";

async function event(
	ports: CompanyPorts | CompanyStore,
	type: string,
	task: Task,
	data: Record<string, unknown> = {},
) {
	await ports.events.append({
		type,
		source: "tasks",
		subject: task.id,
		data: { number: task.number, ...data },
		idempotencyKey: `${type}:${task.id}:${randomUUID()}`,
	});
}

/** "Find three bakeries\nin Milan" → title and details. */
function split(text: string, details?: string | null) {
	const t = text.trim();
	if (!t) throw new AgentError("Say what needs doing.");
	const [first = "", ...rest] = t.split("\n");
	let title = first.trim();
	const more = [rest.join("\n").trim(), details?.trim() ?? ""].filter(Boolean);
	if (title.length > TASK_LIMITS.title) {
		more.unshift(title.slice(TASK_LIMITS.title - 1).trim());
		title = `${title.slice(0, TASK_LIMITS.title - 1)}…`;
	}
	const all = more.join("\n").trim();
	if (all.length > TASK_LIMITS.details)
		throw new AgentError(
			`That's too long for a task: keep it under ${TASK_LIMITS.details} characters.`,
		);
	return { title, details: all || null };
}

/**
 * Adds a task. The founder's starts at once; anyone else's waits for the
 * founder's yes, asked on Telegram.
 */
export async function createTask(
	deps: TaskDeps,
	input: {
		text: string;
		details?: string | null;
		requesterKind: TaskRequesterKind;
		requesterKey: string | null;
		requesterName: string;
		responsibilityKey?: string | null;
	},
): Promise<{ task: Task; message: string }> {
	const { store, notifier } = deps;
	const { title, details } = split(input.text, input.details);
	if (input.requesterKey) {
		const open = await store.tasks.list({
			requesterKey: input.requesterKey,
			status: OPEN_TASK,
			limit: TASK_LIMITS.openPerRequester,
		});
		if (open.length >= TASK_LIMITS.openPerRequester)
			throw new AgentError(
				`You have ${open.length} tasks open already. Let some finish first (/tasks).`,
			);
	}
	const founder = input.requesterKind === "founder";
	const task = await store.transaction(async (tx) => {
		const t = await tx.tasks.create({
			title,
			details,
			status: founder ? "open" : "proposed",
			responsibilityKey: input.responsibilityKey ?? null,
			requesterKind: input.requesterKind,
			requesterKey: input.requesterKey,
			requesterName: input.requesterName,
		});
		await event(tx, "task.created", t, {
			by: input.requesterName,
			kind: input.requesterKind,
		});
		if (founder)
			await tx.jobs.enqueue({
				kind: TASK_ROUTE_JOB,
				key: `task-route:${t.id}`,
				payload: { taskId: t.id },
			});
		return t;
	});
	if (!founder)
		await notifier.toOwner({
			text: `📋 ${input.requesterName} asks the company to: ${title}${details ? `\n${details}` : ""}\nGo ahead?`,
			actions: [
				{ label: "✅ Go ahead", action: `task:go:${task.number}` },
				{ label: "No", action: `task:no:${task.number}` },
			],
		});
	return {
		task,
		message: founder
			? `Got it: #${task.number} ${title}. I'll tell you when it's done, or if I need you.`
			: `Got it: #${task.number} ${title}. The founder says yes first; I'll tell you.`,
	};
}

/** The company map, read once for a decision. */
async function map(store: CompanyStore) {
	const nodes = (await store.graph.listNodes()).filter((n) => !isRetired(n));
	const edges = await store.graph.listEdges();
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const byKey = new Map(nodes.map((n) => [n.key, n]));
	return { nodes, edges, byId, byKey };
}
type CompanyMap = Awaited<ReturnType<typeof map>>;

/**
 * The agent that tries first: the one that owns the responsibility, else one
 * in a team that needs it, else the company's default agent.
 */
export function pickTaskAgent(
	nodes: StoredNode[],
	edges: StoredEdge[],
	respKey: string | null,
): StoredNode | null {
	const live = nodes.filter((n) => !isRetired(n));
	const byId = new Map(live.map((n) => [n.id, n]));
	const resp = respKey
		? live.find((n) => n.kind === "responsibility" && n.key === respKey)
		: undefined;
	if (resp) {
		const owner = edges
			.filter((e) => e.toNodeId === resp.id && owning(e.relation))
			.map((e) => byId.get(e.fromNodeId))
			.find((n) => n?.kind === "agent");
		if (owner) return owner;
		const teams = edges
			.filter((e) => e.toNodeId === resp.id && e.relation === "requires")
			.map((e) => byId.get(e.fromNodeId))
			.filter((n): n is StoredNode => n?.kind === "team");
		const teamAgent = live.find(
			(a) =>
				a.kind === "agent" &&
				edges.some(
					(e) =>
						e.fromNodeId === a.id &&
						e.relation === "member_of" &&
						teams.some((t) => t.id === e.toNodeId),
				),
		);
		if (teamAgent) return teamAgent;
	}
	return pickChannelAgent(live, edges, "telegram");
}

/** The person a task goes to when an agent can't: the owner, else the founder. */
async function personFor(store: CompanyStore, task: Task) {
	const m = await map(store);
	const company = await store.graph.getCompany();
	const resp = task.responsibilityKey
		? m.byKey.get(task.responsibilityKey)
		: undefined;
	const owner = resp
		? m.edges
				.filter((e) => e.toNodeId === resp.id && owning(e.relation))
				.map((e) => m.byId.get(e.fromNodeId))
				.find((n) => n?.kind === "human")
		: undefined;
	return (
		owner ??
		(company?.founderKey ? m.byKey.get(company.founderKey) : undefined) ??
		null
	);
}

/** Which responsibility a task belongs to: asked of the model, checked here. */
async function chooseResponsibility(
	deps: TaskDeps,
	task: Task,
	m: CompanyMap,
): Promise<string | null> {
	const resps = m.nodes.filter((n) => n.kind === "responsibility");
	if (resps.length === 0) return null;
	if (resps.length === 1) return (resps[0] as StoredNode).key;
	if (!deps.ask) return null;
	try {
		const answer = await deps.ask({
			system:
				"You sort a company's tasks. Answer with one key from the list, exactly as written, or `none` if no responsibility fits. Nothing else.",
			prompt: [
				`Task: ${task.title}`,
				...(task.details ? [task.details] : []),
				"",
				"Responsibilities:",
				...resps.map((r) => `- ${r.key}: ${r.name}`),
			].join("\n"),
		});
		const key = answer.trim().replace(/^[`"'\s-]+|[`"'.\s]+$/g, "");
		return resps.some((r) => r.key === key) ? key : null;
	} catch {
		return null; // the default agent takes it
	}
}

/**
 * The `task.route` job: the selector. Picks the responsibility and gives
 * the task to an agent; with no agent at all, to a person.
 */
export async function routeTask(deps: TaskDeps, taskId: string): Promise<void> {
	const { store } = deps;
	const task = await store.tasks.get(taskId);
	if (task?.status !== "open") return;
	const m = await map(store);
	const respKey =
		task.responsibilityKey && m.byKey.get(task.responsibilityKey)
			? task.responsibilityKey
			: await chooseResponsibility(deps, task, m);
	const agent = pickTaskAgent(m.nodes, m.edges, respKey);
	if (!agent) {
		await store.tasks.update(task.id, ["open"], { responsibilityKey: respKey });
		await handToPerson(deps, task.id, ["open"], null);
		return;
	}
	await store.transaction(async (tx) => {
		const t = await tx.tasks.update(task.id, ["open"], {
			status: "working",
			responsibilityKey: respKey,
			assigneeKind: "agent",
			assigneeKey: agent.key,
			note: null,
		});
		if (!t) return;
		await event(tx, "task.assigned", t, {
			to: agent.key,
			kind: "agent",
			responsibility: respKey,
		});
		await tx.jobs.enqueue({
			kind: TASK_RUN_JOB,
			payload: { taskId: t.id, agentKey: agent.key },
		});
	});
}

/**
 * Gives a task to a person — `to`, or the responsibility's owner, else the
 * founder — and queues the message that tells them. `note`: what came
 * before (an agent's try). Null when the task wasn't in `from`.
 */
export async function handToPerson(
	deps: Pick<TaskDeps, "store">,
	taskId: string,
	from: TaskStatus[],
	note: string | null,
	to?: string,
): Promise<Task | null> {
	const { store } = deps;
	const task = await store.tasks.get(taskId);
	if (!task) return null;
	const person = to
		? ((await map(store)).byKey.get(to) ?? null)
		: await personFor(store, task);
	return store.transaction(async (tx) => {
		const t = await tx.tasks.update(task.id, from, {
			status: person ? "working" : "blocked",
			assigneeKind: person ? "human" : null,
			assigneeKey: person?.key ?? null,
			note: person ? note : "There's nobody in the company to give it to.",
			nudgedAt: null,
		});
		if (!t) return null;
		await event(tx, "task.assigned", t, {
			to: person?.key ?? null,
			kind: "human",
		});
		await tx.jobs.enqueue({
			kind: TASK_TELL_JOB,
			payload: { taskId: t.id },
		});
		return t;
	});
}

export const taskLabel = (task: Task) => `#${task.number} ${task.title}`;

/** What the founder can do about a task that waits for them. */
export const founderChoices = (task: Task): OwnerAction[] => [
	{ label: "Give it to a person", action: `task:person:${task.number}` },
	{ label: "I'll do it", action: `task:mine:${task.number}` },
	{ label: "Cancel", action: `task:drop:${task.number}` },
];

/**
 * The `task.tell` job: tells whoever has the task now. A person gets it with
 * Done and Can't buttons; a task nobody can take goes to the founder.
 */
export async function tellAssignee(
	deps: TaskDeps,
	taskId: string,
): Promise<void> {
	const { store, notifier } = deps;
	const task = await store.tasks.get(taskId);
	if (!task) return;
	const company = await store.graph.getCompany();
	if (task.status === "blocked") {
		await notifier.toOwner({
			text: `📋 ${taskLabel(task)} is waiting for you: ${task.note ?? "nobody can take it."}`,
			actions: founderChoices(task),
		});
		return;
	}
	if (task.status !== "working" || task.assigneeKind !== "human") return;
	const key = task.assigneeKey as string;
	const text = [
		`📋 Task #${task.number} for you, from ${task.requesterName}: ${task.title}`,
		...(task.details ? [task.details] : []),
		...(task.note ? ["", task.note] : []),
		"",
		"Press Done when it's finished.",
	].join("\n");
	const actions = [
		{ label: "✅ Done", action: `task:done:${task.number}` },
		{ label: "I can't", action: `task:cant:${task.number}` },
	];
	if (key === company?.founderKey) {
		await notifier.toOwner({ text, actions });
		return;
	}
	if (await notifier.toMember?.(key, { text, actions })) return;
	const name = (await map(store)).byKey.get(key)?.name ?? key;
	const blocked = await store.tasks.update(task.id, ["working"], {
		status: "blocked",
		note: `It's for ${name}, who isn't linked on Telegram.`,
	});
	if (blocked)
		await notifier.toOwner({
			text: `📋 ${taskLabel(blocked)} is for ${name}, who isn't linked on Telegram. Tell them yourself, or:`,
			actions: founderChoices(blocked),
		});
}

/** Tells whoever asked that their task moved on (the founder or a person of the map). */
export async function tellRequester(
	deps: Pick<TaskDeps, "notifier">,
	task: Task,
	text: string,
): Promise<void> {
	if (task.requesterKind === "founder") {
		await deps.notifier.toOwner({ text });
	} else if (task.requesterKind === "member" && task.requesterKey) {
		await deps.notifier.toMember?.(task.requesterKey, { text });
	}
	// Agents and customers read theirs over MCP (C6).
}

export type TaskVerb =
	| "go"
	| "no"
	| "done"
	| "cant"
	| "ok"
	| "redo"
	| "person"
	| "mine"
	| "drop";
export const TASK_VERBS: readonly TaskVerb[] = [
	"go",
	"no",
	"done",
	"cant",
	"ok",
	"redo",
	"person",
	"mine",
	"drop",
];
const FOUNDER_ONLY = new Set<TaskVerb>([
	"go",
	"no",
	"ok",
	"redo",
	"person",
	"mine",
	"drop",
]);

/** Records a person's finished task as a contribution (D54), confirmed. */
async function onRecord(store: CompanyStore, task: Task, by: string) {
	if (task.assigneeKind !== "human" || !task.assigneeKey) return;
	await recordContribution(
		store,
		{
			nodeKey: task.assigneeKey,
			what: `#${task.number} ${task.title}`.slice(0, 280),
		},
		by,
		true,
	).catch(() => undefined); // a node gone from the map: the task is still done
}

/**
 * A button pressed on a task. The founder decides; the person who has the
 * task says Done or Can't. Returns what to tell whoever pressed it.
 */
export async function taskAction(
	deps: TaskDeps,
	verb: TaskVerb,
	number: number,
	actor: TaskActor,
): Promise<string> {
	const { store, notifier } = deps;
	const task = await store.tasks.byNumber(number);
	if (!task) return `There's no task #${number}.`;
	if (FOUNDER_ONLY.has(verb) && !actor.founder)
		return "Only the founder decides this.";
	if (
		(verb === "done" || verb === "cant") &&
		(task.assigneeKind !== "human" || task.assigneeKey !== actor.key)
	)
		return `#${task.number} isn't yours right now.`;
	const gone = `#${task.number} has moved on: see /tasks.`;
	const m = await map(store);
	const nameOf = (key: string | null) =>
		(key && m.byKey.get(key)?.name) || key || "someone";

	switch (verb) {
		case "go": {
			const t = await store.transaction(async (tx) => {
				const t = await tx.tasks.update(task.id, ["proposed"], {
					status: "open",
				});
				if (!t) return null;
				await event(tx, "task.accepted", t, { by: actor.name });
				await tx.jobs.enqueue({
					kind: TASK_ROUTE_JOB,
					key: `task-route:${t.id}`,
					payload: { taskId: t.id },
				});
				return t;
			});
			if (!t) return gone;
			await tellRequester(
				deps,
				t,
				`✅ The founder said yes to ${taskLabel(t)}. It's on its way.`,
			);
			return `Going ahead with ${taskLabel(t)}.`;
		}
		case "no": {
			const t = await store.tasks.update(task.id, ["proposed"], {
				status: "cancelled",
			});
			if (!t) return gone;
			await event(store, "task.cancelled", t, { by: actor.name });
			await tellRequester(
				deps,
				t,
				`The founder decided not to go ahead with ${taskLabel(t)}.`,
			);
			return `Not doing ${taskLabel(t)}.`;
		}
		case "done": {
			// The founder's own work needs nobody's confirmation.
			const own = actor.founder;
			const t = await store.tasks.update(task.id, ["working"], {
				status: own ? "done" : "review",
			});
			if (!t) return gone;
			await event(store, own ? "task.done" : "task.finished", t, {
				by: actor.name,
			});
			if (own) {
				await onRecord(store, t, actor.name);
				if (t.requesterKind !== "founder")
					await tellRequester(deps, t, `✅ ${taskLabel(t)} is done.`);
				return `✅ ${taskLabel(t)} is done.`;
			}
			await notifier.toOwner({
				text: `${actor.name} finished ${taskLabel(t)}. Confirm it?`,
				actions: [
					{ label: "✅ Confirm", action: `task:ok:${t.number}` },
					{ label: "Not yet", action: `task:redo:${t.number}` },
				],
			});
			return `Thanks! The founder will confirm ${taskLabel(t)}.`;
		}
		case "cant": {
			const t = await store.tasks.update(task.id, ["working"], {
				status: "blocked",
				note: `${actor.name} can't do it.`,
			});
			if (!t) return gone;
			await event(store, "task.blocked", t, { by: actor.name, why: "cant" });
			if (actor.founder)
				return `OK. ${taskLabel(t)} waits: decide what happens to it.`;
			await notifier.toOwner({
				text: `${actor.name} can't do ${taskLabel(t)}.`,
				actions: founderChoices(t),
			});
			return "No problem, thanks for saying. The founder will find another way.";
		}
		case "ok": {
			const t = await store.tasks.update(task.id, ["review"], {
				status: "done",
			});
			if (!t) return gone;
			await event(store, "task.done", t, { by: actor.name });
			await onRecord(store, t, actor.name);
			if (t.assigneeKind === "human" && t.assigneeKey)
				await notifier.toMember?.(t.assigneeKey, {
					text: `✅ The founder confirmed ${taskLabel(t)}. It's on your record.`,
				});
			if (t.requesterKind !== "founder" && t.requesterKey !== t.assigneeKey)
				await tellRequester(deps, t, `✅ ${taskLabel(t)} is done.`);
			return `✅ ${taskLabel(t)} is done${t.assigneeKind === "human" ? `, and on ${nameOf(t.assigneeKey)}'s record` : ""}.`;
		}
		case "redo": {
			if (task.assigneeKind !== "human")
				return `${taskLabel(task)} was an agent's: give it to a person instead.`;
			const t = await store.tasks.update(task.id, ["review"], {
				status: "working",
				nudgedAt: null,
			});
			if (!t) return gone;
			await event(store, "task.reopened", t, { by: actor.name });
			if (t.assigneeKey)
				await notifier.toMember?.(t.assigneeKey, {
					text: `The founder says ${taskLabel(t)} isn't finished yet. Ask them what's missing, then press Done again.`,
					actions: [{ label: "✅ Done", action: `task:done:${t.number}` }],
				});
			return `Back to ${nameOf(t.assigneeKey)}: ${taskLabel(t)}.`;
		}
		case "person": {
			const t = await handToPerson(
				deps,
				task.id,
				["review", "blocked"],
				task.note,
			);
			if (!t) return gone;
			return t.status === "working"
				? `${taskLabel(t)} goes to ${nameOf(t.assigneeKey)}.`
				: `Nobody can take ${taskLabel(t)}: invite someone (Stewards → Open roles), or do it yourself.`;
		}
		case "mine": {
			const company = await store.graph.getCompany();
			if (!company?.founderKey) return "The company has no founder in its map.";
			const t = await handToPerson(
				deps,
				task.id,
				["review", "blocked", "working", "open"],
				task.note,
				company.founderKey,
			);
			return t ? `${taskLabel(t)} is yours.` : gone;
		}
		case "drop": {
			const t = await store.tasks.update(task.id, OPEN_TASK, {
				status: "cancelled",
			});
			if (!t) return gone;
			await event(store, "task.cancelled", t, { by: actor.name });
			if (
				t.assigneeKind === "human" &&
				t.assigneeKey &&
				t.assigneeKey !== actor.key
			)
				await notifier.toMember?.(t.assigneeKey, {
					text: `${taskLabel(t)} was cancelled: you can leave it.`,
				});
			return `Cancelled ${taskLabel(t)}.`;
		}
	}
}

/**
 * The founder answers an agent's question (`/answer 12 …`): the answer joins
 * the task's details and the same agent carries on.
 */
export async function answerTask(
	deps: TaskDeps,
	number: number,
	answer: string,
	actor: TaskActor,
): Promise<string> {
	const { store } = deps;
	if (!actor.founder) return "Only the founder answers these.";
	const task = await store.tasks.byNumber(number);
	if (!task) return `There's no task #${number}.`;
	const said = answer.trim();
	if (!said) return `Say your answer after the number: /answer ${number} …`;
	const details = [task.details, `${actor.name} answered: ${said}`]
		.filter(Boolean)
		.join("\n")
		.slice(-TASK_LIMITS.details);
	const agent = task.assigneeKind === "agent" ? task.assigneeKey : null;
	const t = await store.transaction(async (tx) => {
		const t = await tx.tasks.update(task.id, ["blocked"], {
			status: agent ? "working" : "open",
			details,
			note: null,
		});
		if (!t) return null;
		await event(tx, "task.answered", t, { by: actor.name });
		await tx.jobs.enqueue(
			agent
				? { kind: TASK_RUN_JOB, payload: { taskId: t.id, agentKey: agent } }
				: {
						kind: TASK_ROUTE_JOB,
						key: `task-route:${t.id}:${randomUUID()}`,
						payload: { taskId: t.id },
					},
		);
		return t;
	});
	return t
		? `Thanks — ${taskLabel(t)} carries on.`
		: `#${number} isn't waiting for an answer.`;
}

const STATUS_TEXT: Record<TaskStatus, string> = {
	proposed: "waiting for the founder's yes",
	open: "being given to someone",
	working: "in progress",
	review: "finished, waiting for the founder to confirm",
	blocked: "waiting for the founder",
	done: "done",
	cancelled: "cancelled",
};

const days = (from: string, now: Date) =>
	Math.floor((now.getTime() - Date.parse(from)) / DAY);

/** One line of a list: "• #12 Find three bakeries — Rio, in progress (3 d)". */
async function lines(store: CompanyStore, tasks: Task[], now: Date) {
	const m = await map(store);
	return tasks.map((t) => {
		const who = t.assigneeKey
			? `${m.byKey.get(t.assigneeKey)?.name ?? t.assigneeKey}${t.assigneeKind === "agent" ? " (agent)" : ""}, `
			: "";
		const age = days(t.updatedAt, now);
		const why = t.status === "blocked" && t.note ? `: ${t.note}` : "";
		return `• ${taskLabel(t)} — ${who}${STATUS_TEXT[t.status]}${why}${age >= 1 ? ` (${age} d)` : ""}`;
	});
}

const recentlyDone = async (store: CompanyStore, now: Date, within: number) =>
	(await store.tasks.list({ status: ["done"], limit: 200 })).filter(
		(t) => t.doneAt && now.getTime() - Date.parse(t.doneAt) < within,
	);

/**
 * The tasks as `/tasks` tells them: the founder sees everything open; a
 * person sees what they have and what they asked for.
 */
export async function tasksText(
	store: CompanyStore,
	actor: TaskActor,
	now = new Date(),
): Promise<string> {
	if (actor.founder) {
		const open = await store.tasks.list({ status: OPEN_TASK, limit: 50 });
		const done = await recentlyDone(store, now, 7 * DAY);
		if (open.length === 0 && done.length === 0)
			return "No tasks yet. Add one: /task and what needs doing.";
		const waiting = open.filter((t) =>
			["blocked", "review", "proposed"].includes(t.status),
		);
		const rest = open.filter((t) => !waiting.includes(t));
		return [
			...(waiting.length
				? [
						"Waiting for you:",
						...(await lines(store, waiting.slice(0, 10), now)),
						"",
					]
				: []),
			...(rest.length
				? ["Under way:", ...(await lines(store, rest.slice(0, 15), now)), ""]
				: []),
			`Done in the last 7 days: ${done.length}.`,
		].join("\n");
	}
	if (!actor.key) return "Only the people who run the company have tasks here.";
	const mine = await store.tasks.list({
		assigneeKey: actor.key,
		status: ["working", "review"],
		limit: 20,
	});
	const asked = (
		await store.tasks.list({
			requesterKey: actor.key,
			status: OPEN_TASK,
			limit: 20,
		})
	).filter((t) => t.assigneeKey !== actor.key);
	if (mine.length === 0 && asked.length === 0)
		return "Nothing on your list. Ask the company for something: /task and what needs doing.";
	return [
		...(mine.length ? ["Yours:", ...(await lines(store, mine, now)), ""] : []),
		...(asked.length
			? ["You asked for:", ...(await lines(store, asked, now))]
			: []),
	]
		.join("\n")
		.trim();
}

/** One task in full, for whoever may see it: the founder, its person, who asked. */
export async function taskText(
	store: CompanyStore,
	number: number,
	actor: TaskActor,
	now = new Date(),
): Promise<string> {
	const t = await store.tasks.byNumber(number);
	const mayRead =
		t &&
		(actor.founder ||
			(actor.key !== null &&
				(t.assigneeKey === actor.key || t.requesterKey === actor.key)));
	if (!t || !mayRead) return `There's no task #${number} you can see.`;
	const [line = ""] = await lines(store, [t], now);
	return [
		line.slice(2),
		`Asked by ${t.requesterName} on ${t.createdAt.slice(0, 10)}.`,
		...(t.details ? [t.details] : []),
		...(t.result ? ["", `Result: ${t.result}`] : []),
	].join("\n");
}

/**
 * Part of the company heartbeat: remind people of tasks with no news for
 * `NUDGE_AFTER_DAYS`, and send the founder one summary a day.
 */
export async function followUpTasks(deps: TaskDeps, now: Date): Promise<void> {
	const { store, notifier } = deps;
	const company = await store.graph.getCompany();
	const open = await store.tasks.list({ status: OPEN_TASK, limit: 500 });

	for (const t of open) {
		if (
			t.status !== "working" ||
			t.assigneeKind !== "human" ||
			!t.assigneeKey ||
			t.assigneeKey === company?.founderKey
		)
			continue;
		const since = Date.parse(t.nudgedAt ?? t.updatedAt);
		if (now.getTime() - since < NUDGE_AFTER_DAYS * DAY) continue;
		const reached = await notifier.toMember?.(t.assigneeKey, {
			text: `How's ${taskLabel(t)} going? It's been ${days(t.updatedAt, now)} days.`,
			actions: [
				{ label: "✅ Done", action: `task:done:${t.number}` },
				{ label: "I can't", action: `task:cant:${t.number}` },
			],
		});
		if (reached)
			await store.tasks.update(t.id, ["working"], {
				nudgedAt: now.toISOString(),
			});
	}

	const last = await store.settings.get<string>(TASKS_DIGEST_AT);
	if (last && now.getTime() - Date.parse(last) < 20 * 60 * 60 * 1000) return;
	const done = await recentlyDone(store, now, DAY);
	if (open.length === 0 && done.length === 0) return;
	const waiting = open.filter((t) =>
		["blocked", "review", "proposed"].includes(t.status),
	);
	const slow = open.filter(
		(t) =>
			t.status === "working" &&
			t.assigneeKind === "human" &&
			days(t.updatedAt, now) >= NUDGE_AFTER_DAYS,
	);
	const byAgents = open.filter(
		(t) => t.status === "working" && t.assigneeKind === "agent",
	).length;
	const byPeople = open.filter(
		(t) => t.status === "working" && t.assigneeKind === "human",
	).length;
	const sent = await notifier.toOwner({
		text: [
			"📋 Tasks today",
			`Done since yesterday: ${done.length}${done.length ? ` (${done.map((t) => `#${t.number}`).join(", ")})` : ""}.`,
			`Under way: ${byAgents} with agents, ${byPeople} with people.`,
			...(waiting.length
				? [
						"",
						"Waiting for you:",
						...(await lines(store, waiting.slice(0, 8), now)),
					]
				: []),
			...(slow.length
				? [
						"",
						"No news for a while:",
						...(await lines(store, slow.slice(0, 5), now)),
					]
				: []),
			"",
			"/tasks for the whole list.",
		].join("\n"),
	});
	if (sent) await store.settings.set(TASKS_DIGEST_AT, now.toISOString());
}
