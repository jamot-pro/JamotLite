import {
	type AssistantMessage,
	getCurrentTools,
	getToolStateChanges,
	type JsonObject,
	type Message,
	normalizeContext,
	type SystemMessage,
	type Tool,
	type ToolCall,
	type ToolResultMessage,
	toToolDeclaration,
} from "@earendil-works/pi-ai";
import type {
	ApprovalStore,
	EventStore,
	RunStore,
	TranscriptStore,
} from "@jamot/ports";
import type {
	AgentSpec,
	Brain,
	BrainTool,
	RunOutcome,
	ToolResult,
} from "./types.js";

/** The storage the brain needs — a subset of the company store. */
export interface BrainPorts {
	runs: RunStore;
	transcripts: TranscriptStore;
	approvals: ApprovalStore;
	events: EventStore;
}

/** Said to every agent, before its own instructions. */
export const PREAMBLE = `You work for a company run on Jamot, alongside its people.
People decide: you prepare, propose and carry out what you are allowed to.
Some tools wait for a person's approval; when one does, say it is waiting and do not retry it.
Never invent facts about people or the company. Be brief and kind.`;

const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

interface ActiveSession {
	abort(): void;
}

/**
 * The native Brain runtime. A lightweight, native turn loop:
 * - Direct turn loop (model call -> tool execution -> model call).
 * - Policy gate (allow, approve, deny) and human approval suspension.
 * - Transcript persistence in the company's database that survives restarts.
 * - Token and cost accounting on every run.
 * - Budgets (turns and cost) and tool timeouts.
 * - Audit event for every tool call.
 */
export function createPiBrain(ports: BrainPorts): Brain {
	const active = new Map<string, ActiveSession>();
	const sessionQueue = new Map<string, Promise<unknown>>();

	// One run at a time per session, so two messages never write one transcript at once.
	const serialize = <T>(
		sessionId: string,
		work: () => Promise<T>,
	): Promise<T> => {
		const previous = sessionQueue.get(sessionId) ?? Promise.resolve();
		const next = previous.then(work, work);
		const settled = next.catch(() => undefined);
		sessionQueue.set(sessionId, settled);
		void settled.then(() => {
			if (sessionQueue.get(sessionId) === settled)
				sessionQueue.delete(sessionId);
		});
		return next;
	};

	interface Drive {
		agent: AgentSpec;
		sessionId: string;
		trigger: string;
		input: string | null;
		/** Runs after the run is recorded and before the transcript is loaded. */
		before?: (runId: string) => Promise<string | null>;
	}

	async function drive({
		agent: spec,
		sessionId,
		trigger,
		input,
		before,
	}: Drive): Promise<RunOutcome> {
		checkTools(spec.tools);
		const runRow = await ports.runs.start({
			sessionId,
			agentKey: spec.key,
			model: spec.model.label,
			trigger,
			input,
		});
		const runId = runRow.id;
		const approvalIds: string[] = [];
		let stoppedBecause: string | null = null;
		const controller = new AbortController();

		active.set(sessionId, {
			abort: () => controller.abort(),
		});

		try {
			// A decision on a waiting tool call rewrites the transcript first, and may
			// hand back a note to continue with.
			const note = before ? await before(runId) : null;

			const rows = await ports.transcripts.load(sessionId);
			const messages = rows.map((r) => r.message as Message);
			let persisted = messages.length;

			messages.push(...repairInterruptedToolCalls(messages));
			messages.push(
				...syncSystemAndTools(messages, spec.instructions, spec.tools),
			);

			const last = messages.at(-1);
			if (input !== null) {
				messages.push({
					role: "user",
					content: input,
					timestamp: Date.now(),
				} as Message);
			} else if (last?.role === "toolResult" || last?.role === "user") {
				// Continue from existing transcript without adding a user message.
			} else {
				messages.push({
					role: "user",
					content: note ?? "Carry on.",
					timestamp: Date.now(),
				} as Message);
			}

			const flush = async () => {
				if (messages.length > persisted) {
					await ports.transcripts.append(sessionId, messages.slice(persisted));
					persisted = messages.length;
				}
			};

			let turns = 0;
			let costMicroUsd = 0;
			const byName = new Map(spec.tools.map((t) => [t.name, t]));

			while (!controller.signal.aborted) {
				const maxTurns = spec.budget?.maxTurns;
				if (maxTurns !== undefined && turns >= maxTurns) {
					stoppedBecause = `budget reached: ${turns} turns`;
					break;
				}

				await flush();

				const stream = await spec.model.streamFn(
					spec.model.model,
					normalizeContext({ messages }),
					{ signal: controller.signal },
				);
				const assistantMessage = await stream.result();
				messages.push(assistantMessage);
				await flush();

				const u = assistantMessage.usage;
				const cost = Math.round((u?.cost?.total ?? 0) * 1_000_000);
				costMicroUsd += cost;
				await ports.runs.addUsage(runId, {
					inputTokens: u?.input ?? 0,
					outputTokens: u?.output ?? 0,
					cacheReadTokens: u?.cacheRead ?? 0,
					cacheWriteTokens: u?.cacheWrite ?? 0,
					costMicroUsd: cost,
				});

				const maxCost = spec.budget?.maxCostMicroUsd;
				if (
					maxCost !== undefined &&
					costMicroUsd >= maxCost &&
					!stoppedBecause
				) {
					stoppedBecause = `budget reached: this run cost ${costMicroUsd} of ${maxCost} micro-USD`;
					break;
				}

				if (assistantMessage.stopReason === "error") {
					break;
				}
				if (
					assistantMessage.stopReason === "aborted" ||
					controller.signal.aborted
				) {
					break;
				}

				const toolCalls = (assistantMessage.content ?? []).filter(
					(c): c is ToolCall => c.type === "toolCall",
				);
				if (toolCalls.length === 0) {
					break;
				}

				if (assistantMessage.stopReason === "length") {
					for (const tc of toolCalls) {
						messages.push({
							role: "toolResult",
							toolCallId: tc.id,
							toolName: tc.name,
							content: [
								{
									type: "text",
									text: "Interrupted: tool call arguments truncated.",
								},
							],
							details: {},
							isError: true,
							timestamp: Date.now(),
						} as ToolResultMessage);
					}
					break;
				}

				for (const toolCall of toolCalls) {
					const policy = byName.get(toolCall.name)?.policy ?? "allow";
					if (policy === "deny") {
						messages.push({
							role: "toolResult",
							toolCallId: toolCall.id,
							toolName: toolCall.name,
							content: [
								{
									type: "text",
									text: `The company does not allow ${toolCall.name}. Don't try it again.`,
								},
							],
							details: {},
							isError: true,
							timestamp: Date.now(),
						} as ToolResultMessage);
						await ports.events.append({
							type: "agent.tool_called",
							source: `agent/${spec.key}`,
							subject: runId,
							data: { tool: toolCall.name, isError: true },
							idempotencyKey: `tool:${runId}:${toolCall.id}`,
						});
					} else if (policy === "approve") {
						const approval = await ports.approvals.create({
							runId,
							sessionId,
							agentKey: spec.key,
							tool: toolCall.name,
							toolCallId: toolCall.id,
							args: (toolCall.arguments ?? {}) as Record<string, unknown>,
						});
						approvalIds.push(approval.id);
						messages.push({
							role: "toolResult",
							toolCallId: toolCall.id,
							toolName: toolCall.name,
							content: [
								{
									type: "text",
									text: `Waiting for a person to approve ${toolCall.name} (approval ${approval.id}). Say it is waiting; don't retry it.`,
								},
							],
							details: { waitingApproval: true, approvalId: approval.id },
							isError: true,
							timestamp: Date.now(),
						} as ToolResultMessage);
						await ports.events.append({
							type: "agent.tool_called",
							source: `agent/${spec.key}`,
							subject: runId,
							data: { tool: toolCall.name, isError: false },
							idempotencyKey: `tool:${runId}:${toolCall.id}`,
						});
					} else {
						const tool = byName.get(toolCall.name);
						let result: ToolResult;
						if (!tool) {
							result = {
								text: `Tool ${toolCall.name} not found.`,
								isError: true,
							};
						} else {
							result = await runWithTimeout(
								tool,
								(toolCall.arguments ?? {}) as Record<string, unknown>,
								{ runId, sessionId, agentKey: spec.key },
								controller.signal,
							);
						}
						messages.push({
							role: "toolResult",
							toolCallId: toolCall.id,
							toolName: toolCall.name,
							content: [{ type: "text", text: result.text }],
							details: (result.details ?? {}) as JsonObject,
							isError: result.isError ?? false,
							timestamp: Date.now(),
						} as ToolResultMessage);
						await ports.events.append({
							type: "agent.tool_called",
							source: `agent/${spec.key}`,
							subject: runId,
							data: { tool: toolCall.name, isError: result.isError ?? false },
							idempotencyKey: `tool:${runId}:${toolCall.id}`,
						});
					}
				}

				turns++;
				if (maxTurns !== undefined && turns >= maxTurns && !stoppedBecause) {
					stoppedBecause = `budget reached: ${turns} turns`;
					break;
				}
			}

			await flush();

			const final = [...messages]
				.reverse()
				.find((m) => m.role === "assistant") as AssistantMessage | undefined;
			const text = final ? textOf(final) : "";
			const pending = [];
			for (const id of approvalIds) {
				if ((await ports.approvals.get(id))?.status === "pending")
					pending.push(id);
			}

			if (
				stoppedBecause ||
				final?.stopReason === "aborted" ||
				controller.signal.aborted
			) {
				const message = stoppedBecause ?? "stopped by a person";
				await ports.runs.finish(runId, {
					status: "aborted",
					output: text || null,
					error: message,
				});
				return { status: "aborted", runId, message };
			}
			if (final?.stopReason === "error") {
				const message = final.errorMessage ?? "the model returned an error";
				await ports.runs.finish(runId, {
					status: "error",
					output: text || null,
					error: message,
				});
				return { status: "error", runId, message };
			}
			if (pending.length > 0) {
				await ports.runs.finish(runId, {
					status: "awaiting_approval",
					output: text || null,
				});
				return {
					status: "awaiting_approval",
					runId,
					text,
					approvalIds: pending,
				};
			}
			await ports.runs.finish(runId, { status: "done", output: text });
			return { status: "done", runId, text };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			await ports.runs.finish(runId, { status: "error", error: message });
			return { status: "error", runId, message };
		} finally {
			active.delete(sessionId);
		}
	}

	return {
		run({ agent, sessionId, input, trigger }) {
			return serialize(sessionId, () =>
				drive({ agent, sessionId, trigger, input }),
			);
		},

		async decide({ agent, approvalId, approved, by, note }) {
			const waiting = await ports.approvals.get(approvalId);
			if (!waiting) throw new Error(`no approval ${approvalId}`);
			if (waiting.status !== "pending")
				throw new Error(`approval ${approvalId} was already ${waiting.status}`);
			return serialize(waiting.sessionId, () =>
				drive({
					agent,
					sessionId: waiting.sessionId,
					trigger: `approval:${approvalId}`,
					input: null,
					before: async (runId) => {
						const approval = await ports.approvals.decide(approvalId, {
							approved,
							by,
							note: note ?? null,
						});
						const tool = agent.tools.find((t) => t.name === approval.tool);
						let result: ToolResult;
						if (!approved) {
							result = {
								text: `${by} declined ${approval.tool}${note ? `: ${note}` : "."}`,
								isError: true,
							};
						} else if (!tool) {
							result = {
								text: `${approval.tool} was approved, but this agent no longer has that tool.`,
								isError: true,
							};
						} else {
							result = await runWithTimeout(tool, approval.args, {
								runId,
								sessionId: approval.sessionId,
								agentKey: agent.key,
							});
						}

						const rows = await ports.transcripts.load(approval.sessionId);
						const row = rows.find(
							(r) =>
								(r.message as Message).role === "toolResult" &&
								(r.message as ToolResultMessage).toolCallId ===
									approval.toolCallId,
						);
						if (row) {
							const placeholder = row.message as ToolResultMessage;
							await ports.transcripts.replace(approval.sessionId, row.seq, {
								...placeholder,
								content: [{ type: "text", text: result.text }],
								details: (result.details ?? {}) as JsonObject,
								isError: result.isError ?? false,
							} satisfies ToolResultMessage);
						}
						await ports.events.append({
							type: approved ? "approval.approved" : "approval.rejected",
							source: `agent/${agent.key}`,
							subject: approvalId,
							data: { tool: approval.tool, by },
							idempotencyKey: `approval:${approvalId}`,
						});
						return approved
							? `${by} approved ${approval.tool}. Result: ${result.text}`
							: result.text;
					},
				}),
			);
		},

		abort(sessionId) {
			active.get(sessionId)?.abort();
		},

		async recoverInterrupted() {
			const open = await ports.runs.list({ status: "running", limit: 10_000 });
			let closed = 0;
			for (const r of open) {
				if (active.has(r.sessionId)) continue;
				await ports.runs.finish(r.id, {
					status: "error",
					error: "interrupted: the runtime stopped during this run",
				});
				closed++;
			}
			return closed;
		},
	};
}

export const createNativeBrain = createPiBrain;
export const createBrain = createPiBrain;

function checkTools(tools: BrainTool[]): void {
	const seen = new Set<string>();
	for (const t of tools) {
		if (!TOOL_NAME.test(t.name)) {
			throw new Error(
				`tool name "${t.name}" must use only letters, digits, _ and - (e.g. payment_send)`,
			);
		}
		if (seen.has(t.name)) throw new Error(`two tools are named "${t.name}"`);
		seen.add(t.name);
	}
}

/** A process that died mid-tool left calls without results. The model must see an
 *  answer for each before it can go on; we don't re-run them, since we can't
 *  know whether they already took effect. */
function repairInterruptedToolCalls(messages: Message[]): ToolResultMessage[] {
	const lastAssistant = messages.findLastIndex((m) => m.role === "assistant");
	if (lastAssistant < 0) return [];
	if (messages.slice(lastAssistant + 1).some((m) => m.role !== "toolResult"))
		return [];
	const answered = new Set(
		messages
			.slice(lastAssistant + 1)
			.map((m) => (m as ToolResultMessage).toolCallId),
	);
	const calls = (
		(messages[lastAssistant] as AssistantMessage).content ?? []
	).filter((c): c is ToolCall => c.type === "toolCall");
	return calls
		.filter((c) => !answered.has(c.id))
		.map((c) => ({
			role: "toolResult",
			toolCallId: c.id,
			toolName: c.name,
			content: [
				{
					type: "text",
					text: "Interrupted: the runtime stopped before this finished. It may or may not have taken effect — check before trying again.",
				},
			],
			details: { interrupted: true },
			isError: true,
			timestamp: Date.now(),
		}));
}

/** The leading system message on a new session; a replacement "instructions"
 *  section when the agent's instructions changed since. */
function instructionsUpdate(
	messages: Message[],
	instructions: string,
): SystemMessage[] {
	const systems = messages.filter(
		(m): m is SystemMessage => m.role === "system",
	);
	if (systems.length === 0) {
		return [
			{
				role: "system",
				content: PREAMBLE,
				sections: { instructions },
				timestamp: Date.now(),
			} as SystemMessage,
		];
	}
	const current = systems
		.map(
			(m) =>
				(m as { sections?: Record<string, string | null> }).sections
					?.instructions,
		)
		.filter((s) => s !== undefined)
		.at(-1);
	if (current === instructions) return [];
	return [
		{
			role: "system",
			content: "",
			sections: { instructions },
			timestamp: Date.now(),
		} as SystemMessage,
	];
}

function syncSystemAndTools(
	messages: Message[],
	instructions: string,
	tools: BrainTool[],
): Message[] {
	const newSys = instructionsUpdate(messages, instructions);
	const targetTools = tools.map((t) => toToolDeclaration(t as unknown as Tool));
	const currentTools = getCurrentTools(messages);
	const changes = getToolStateChanges(currentTools, targetTools);

	const added: Message[] = [];
	const sys = newSys[0];
	if (sys) {
		if (changes.toolsAdded.length > 0 || changes.toolsRemoved.length > 0) {
			sys.toolsAdded = changes.toolsAdded;
			sys.toolsRemoved = changes.toolsRemoved;
		}
		added.push(sys);
	} else if (changes.toolsAdded.length > 0 || changes.toolsRemoved.length > 0) {
		added.push({
			role: "system",
			content: "",
			toolsAdded: changes.toolsAdded,
			toolsRemoved: changes.toolsRemoved,
			timestamp: Date.now(),
		} as Message);
	}
	return added;
}

/** Per-tool timeout. A normal timer, not AbortSignal.timeout, whose timer doesn't keep the process alive. */
async function runWithTimeout(
	tool: BrainTool,
	args: Record<string, unknown>,
	ctx: { runId: string; sessionId: string; agentKey: string },
	outer?: AbortSignal,
): Promise<ToolResult> {
	const ms = tool.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(new Error(`${tool.name} timed out after ${ms} ms`)),
		ms,
	);
	const signal = outer
		? AbortSignal.any([outer, controller.signal])
		: controller.signal;
	try {
		return await Promise.race([
			tool.execute(args, { ...ctx, signal }),
			new Promise<never>((_, reject) => {
				if (signal.aborted) reject(signal.reason);
				signal.addEventListener("abort", () => reject(signal.reason), {
					once: true,
				});
			}),
		]);
	} catch (err) {
		return {
			text: err instanceof Error ? err.message : String(err),
			isError: true,
		};
	} finally {
		clearTimeout(timer);
	}
}

function textOf(message: AssistantMessage): string {
	return (message.content ?? [])
		.filter((c) => c.type === "text")
		.map((c) => (c as { text: string }).text)
		.join("")
		.trim();
}
