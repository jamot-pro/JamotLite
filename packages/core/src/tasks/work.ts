import type { AgentSpec, BrainTool, RunOutcome } from "@jamot/brain";
import { DreamConfig } from "@jamot/contracts";
import type { Approval, Task } from "@jamot/ports";
import { AgentError } from "../agents/manage.js";
import {
	isTransientModelError,
	ModelUnavailable,
	type ReplyDeps,
} from "../agents/reply.js";
import { agentSpecFromNode } from "../agents/spec.js";
import { isRetired } from "../company/retired.js";
import type { Notifier } from "../heartbeats/notify.js";
import {
	createTask,
	founderChoices,
	handToPerson,
	type TaskActor,
	type TaskDeps,
	taskLabel,
	tasksText,
	taskText,
	tellRequester,
} from "./tasks.js";

/**
 * An agent working on a task (RUNTIME D58), and the tools people's agents
 * use to add and report on tasks.
 *
 * The agent does the work with what it has, then says how it ended through
 * one of three tools: finished, hand to a person, or ask the founder. If it
 * only answers in words, the founder sees the answer and decides — an agent
 * never marks its own work done without saying so.
 */

export type TaskRunDeps = ReplyDeps & { notifier: Notifier };

export const TASK_SESSION_PREFIX = "task:";
const sessionFor = (taskId: string, agentKey: string) =>
	`${TASK_SESSION_PREFIX}${taskId}:${agentKey}`;
/** What fits in one Telegram message, with room around it. */
const RESULT_LIMIT = 3000;

/** The agent as the brain runs it for this task, or null when it's gone. */
async function taskAgent(
	deps: TaskRunDeps,
	task: Task,
	agentKey: string,
): Promise<AgentSpec | null> {
	const { store } = deps;
	const company = await store.graph.getCompany();
	const nodes = await store.graph.listNodes();
	const node = nodes.find(
		(n) => n.kind === "agent" && n.key === agentKey && !isRetired(n),
	);
	if (!company || !node) return null;
	const dreamNode = nodes.find((n) => n.kind === "dream");
	const dream = dreamNode ? DreamConfig.safeParse(dreamNode.config) : null;
	const budget = await deps.budget?.();
	const spec = agentSpecFromNode({
		node,
		company,
		dream: dream?.success ? dream.data : null,
		model: await deps.model(),
		tools: [
			...workTools(deps, task.id, node.key, node.name),
			...((await deps.extraTools?.(node.key)) ?? []),
		],
	});
	return budget ? { ...spec, budget } : spec;
}

/** What the agent is told about the task. */
async function brief(deps: TaskRunDeps, task: Task): Promise<string> {
	const company = await deps.store.graph.getCompany();
	const resp = task.responsibilityKey
		? (await deps.store.graph.listNodes()).find(
				(n) => n.key === task.responsibilityKey,
			)
		: undefined;
	return [
		`Task #${task.number} at ${company?.name ?? "the company"}: ${task.title}`,
		...(task.details ? [task.details] : []),
		`Asked by ${task.requesterName}${resp ? `, for ${resp.name}` : ""}.`,
		...(task.note ? [`Before: ${task.note}`] : []),
		"",
		"Do the work now with what you have: your tools, what you know, your own skill (writing, planning, working things out).",
		"Then call exactly one of these tools:",
		"- finish_task, with the result written for whoever asked: only if the work is really done;",
		"- hand_to_person, if it needs hands, a call, a visit, money or a tool you don't have: say why, and what you did already;",
		"- ask_founder, if you can't go on without an answer.",
		"Never say something is done when it isn't.",
	].join("\n");
}

/**
 * The `task.run` job: the assigned agent works on the task. A model that's
 * down is retried like a reply (D57); on the last try the founder is told.
 */
export async function runTask(
	deps: TaskRunDeps,
	job: { taskId: string; agentKey: string },
	opts: { lastTry?: boolean } = {},
): Promise<RunOutcome | null> {
	const { store } = deps;
	const task = await store.tasks.get(job.taskId);
	if (
		task?.status !== "working" ||
		task.assigneeKind !== "agent" ||
		task.assigneeKey !== job.agentKey
	)
		return null;
	const agent = await taskAgent(deps, task, job.agentKey);
	if (!agent) {
		await handToPerson(deps, task.id, ["working"], null);
		return null;
	}
	const input = await brief(deps, task);
	const run = (spec: AgentSpec) =>
		deps.brain.run({
			agent: spec,
			sessionId: sessionFor(task.id, job.agentKey),
			input,
			trigger: `task:${task.number}`,
		});
	let outcome = await run(agent);
	if (outcome.status === "error" && isTransientModelError(outcome.message)) {
		const fallback = await deps.fallbackModel?.();
		if (fallback) {
			await store.events.append({
				type: "model.fallback_used",
				source: `agent/${job.agentKey}`,
				subject: task.id,
				data: { reason: outcome.message, model: fallback.label },
				idempotencyKey: `fallback:${outcome.runId}`,
			});
			outcome = await run({ ...agent, model: fallback });
		}
		if (
			outcome.status === "error" &&
			isTransientModelError(outcome.message) &&
			!opts.lastTry
		)
			throw new ModelUnavailable(outcome.message);
	}
	await afterTaskRun(deps, task.id, job.agentKey, outcome);
	return outcome;
}

/**
 * After the agent's turn. If one of its tools settled the task, nothing is
 * left to do. If it only answered in words, the founder sees the answer and
 * decides; if it couldn't run, the task waits for the founder.
 */
async function afterTaskRun(
	deps: TaskRunDeps,
	taskId: string,
	agentKey: string,
	outcome: RunOutcome,
): Promise<void> {
	const { store, notifier } = deps;
	if (outcome.status === "awaiting_approval") {
		await deps.onApprovalNeeded?.(outcome.approvalIds);
		return;
	}
	const task = await store.tasks.get(taskId);
	if (
		task?.status !== "working" ||
		task.assigneeKind !== "agent" ||
		task.assigneeKey !== agentKey
	)
		return;
	const name =
		(await store.graph.listNodes()).find((n) => n.key === agentKey)?.name ??
		agentKey;
	const said = outcome.status === "done" ? outcome.text.trim() : "";
	if (said) {
		const t = await store.tasks.update(task.id, ["working"], {
			status: "review",
			result: said.slice(0, RESULT_LIMIT),
		});
		if (!t) return;
		await notifier.toOwner({
			text: `${name} has an answer for ${taskLabel(t)}:\n\n${said.slice(0, RESULT_LIMIT)}\n\nIs that it?`,
			actions: [
				{ label: "✅ That's it", action: `task:ok:${t.number}` },
				{ label: "Give it to a person", action: `task:person:${t.number}` },
			],
		});
		return;
	}
	const why =
		outcome.status === "error" || outcome.status === "aborted"
			? (outcome.message ?? "it stopped")
			: "it gave no answer";
	const t = await store.tasks.update(task.id, ["working"], {
		status: "blocked",
		note: `${name} couldn't work on it: ${why}.`,
	});
	if (t)
		await notifier.toOwner({
			text: `📋 ${name} couldn't work on ${taskLabel(t)}: ${why}.`,
			actions: founderChoices(t),
		});
}

/**
 * A person decided on a tool call an agent was waiting for, inside a task:
 * the agent carries on with the task.
 */
export async function decideTaskApproval(
	deps: TaskRunDeps,
	approval: Approval,
	decision: { approved: boolean; by: string; note?: string },
): Promise<RunOutcome | null> {
	const [, taskId = "", agentKey = ""] = approval.sessionId.split(":");
	const task = await deps.store.tasks.get(taskId);
	if (!task) throw new Error(`the task for approval ${approval.id} is gone`);
	const agent = await taskAgent(deps, task, agentKey);
	if (!agent) throw new Error(`agent ${agentKey} is no longer in the company`);
	const outcome = await deps.brain.decide({
		agent,
		approvalId: approval.id,
		...decision,
	});
	await afterTaskRun(deps, taskId, agentKey, outcome);
	return outcome;
}

/** How the agent ends its turn on one task: one of three tools, once. */
function workTools(
	deps: TaskRunDeps,
	taskId: string,
	agentKey: string,
	agentName: string,
): BrainTool[] {
	const { store } = deps;
	let settled = false;
	/** The task, while it's still this agent's to settle. */
	const mine = async () => {
		if (settled) throw new AgentError("You've already settled this task.");
		const t = await store.tasks.get(taskId);
		if (
			t?.status !== "working" ||
			t.assigneeKind !== "agent" ||
			t.assigneeKey !== agentKey
		)
			throw new AgentError("This task isn't yours any more.");
		return t;
	};
	const said = (v: unknown, what: string) => {
		const s = typeof v === "string" ? v.trim() : "";
		if (!s) throw new AgentError(`Say ${what}.`);
		return s.slice(0, RESULT_LIMIT);
	};
	const guarded =
		(fn: (args: Record<string, unknown>) => Promise<string>) =>
		async (args: Record<string, unknown>) => {
			try {
				return { text: await fn(args) };
			} catch (err) {
				if (err instanceof AgentError)
					return { text: err.message, isError: true };
				throw err;
			}
		};

	return [
		{
			name: "finish_task",
			description:
				"The task is done: give the result, written for whoever asked. Only when the work is really done.",
			parameters: {
				type: "object",
				properties: { result: { type: "string", minLength: 1 } },
				required: ["result"],
			},
			execute: guarded(async (args) => {
				const task = await mine();
				const result = said(args.result, "what came of it");
				const t = await store.tasks.update(task.id, ["working"], {
					status: "done",
					result,
				});
				if (!t) throw new AgentError("This task isn't yours any more.");
				settled = true;
				await store.events.append({
					type: "task.done",
					source: `agent/${agentKey}`,
					subject: t.id,
					data: { number: t.number, by: agentName },
					idempotencyKey: `task-done:${t.id}`,
				});
				await tellRequester(
					deps,
					t,
					`✅ ${taskLabel(t)}, done by ${agentName}:\n\n${result}`,
				);
				return "Recorded as done; whoever asked has the result.";
			}),
		},
		{
			name: "hand_to_person",
			description:
				"A person must do this (hands, a call, a visit, money, a tool you don't have). Say why, and what you did already.",
			parameters: {
				type: "object",
				properties: {
					why: { type: "string", minLength: 1 },
					done_so_far: { type: "string" },
				},
				required: ["why"],
			},
			execute: guarded(async (args) => {
				const task = await mine();
				const why = said(args.why, "why a person must do it");
				const sofar =
					typeof args.done_so_far === "string" ? args.done_so_far.trim() : "";
				const t = await handToPerson(
					deps,
					task.id,
					["working"],
					[
						`${agentName} looked at it first: ${why}`,
						...(sofar ? [`Done so far: ${sofar.slice(0, RESULT_LIMIT)}`] : []),
					].join("\n"),
				);
				if (!t) throw new AgentError("This task isn't yours any more.");
				settled = true;
				const who =
					(await store.graph.listNodes()).find((n) => n.key === t.assigneeKey)
						?.name ?? "the founder";
				return t.status === "working"
					? `Handed to ${who}. Stop here.`
					: "Nobody can take it: the founder will decide. Stop here.";
			}),
		},
		{
			name: "ask_founder",
			description:
				"You can't go on without an answer from the founder. Ask one clear question; you'll pick the task up again when they answer.",
			parameters: {
				type: "object",
				properties: { question: { type: "string", minLength: 1 } },
				required: ["question"],
			},
			execute: guarded(async (args) => {
				const task = await mine();
				const question = said(args.question, "your question");
				const t = await store.tasks.update(task.id, ["working"], {
					status: "blocked",
					note: `${agentName} asks: ${question}`,
				});
				if (!t) throw new AgentError("This task isn't yours any more.");
				settled = true;
				await deps.notifier.toOwner({
					text: `❓ ${agentName} asks about ${taskLabel(t)}:\n${question}\n\nAnswer with /answer ${t.number} and your answer.`,
					actions: founderChoices(t),
				});
				return "Asked. Stop here; you'll carry on when they answer.";
			}),
		},
	];
}

/**
 * For an agent talking with the founder or a person of the map: add a task
 * in their name, and say where tasks stand. Never given to customers.
 */
export function conversationTaskTools(
	deps: TaskDeps,
	actor: TaskActor,
): BrainTool[] {
	return [
		{
			name: "add_task",
			description: actor.founder
				? "Add a task for the company when the founder asks for something to get done (not a question you can answer now). It starts at once."
				: `Add a task for the company when ${actor.name} asks for something to get done. The founder says yes first.`,
			parameters: {
				type: "object",
				properties: {
					what: { type: "string", minLength: 3 },
					details: { type: "string" },
				},
				required: ["what"],
			},
			async execute(args) {
				try {
					const { message } = await createTask(deps, {
						text: String(args.what ?? ""),
						details: typeof args.details === "string" ? args.details : null,
						requesterKind: actor.founder ? "founder" : "member",
						requesterKey: actor.key,
						requesterName: actor.name,
					});
					return { text: message };
				} catch (err) {
					if (err instanceof AgentError)
						return { text: err.message, isError: true };
					throw err;
				}
			},
		},
		{
			name: "tasks_report",
			description: actor.founder
				? "Where the company's tasks stand: all of them, or one by its number, with its result."
				: `Where ${actor.name}'s tasks stand: theirs and the ones they asked for, or one by its number.`,
			parameters: {
				type: "object",
				properties: { number: { type: "integer", minimum: 1 } },
			},
			async execute(args) {
				const n = Number(args.number);
				return {
					text:
						Number.isInteger(n) && n > 0
							? await taskText(deps.store, n, actor)
							: await tasksText(deps.store, actor),
				};
			},
		},
	];
}
