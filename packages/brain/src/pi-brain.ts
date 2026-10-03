import {
	Agent,
	type AgentMessage,
	type AgentTool,
} from "@earendil-works/pi-agent-core";
import type {
	AssistantMessage,
	JsonObject,
	ToolResultMessage,
	TSchema,
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

/**
 * The Brain, on pi (RUNTIME D17). pi runs the model loop; this adapter adds
 * what a company needs around it: the policy gate and human approvals, a
 * transcript in the company's own database that survives restarts, token and
 * cost accounting on every run, budgets, tool timeouts, and an audit event for
 * every tool call.
 */
export function createPiBrain(ports: BrainPorts): Brain {
	const active = new Map<string, Agent>();
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

		try {
			// A decision on a waiting tool call rewrites the transcript first, and may
			// hand back a note to continue with.
			const note = before ? await before(runId) : null;

			const rows = await ports.transcripts.load(sessionId);
			const messages = rows.map((r) => r.message as AgentMessage);
			let persisted = messages.length;
			messages.push(
				...repairInterruptedToolCalls(messages),
				...instructionsUpdate(messages, spec.instructions),
			);

			const tools = spec.tools.map((t) =>
				toPiTool(t, { runId, sessionId, agentKey: spec.key }),
			);
			const byName = new Map(spec.tools.map((t) => [t.name, t]));

			const agent = new Agent({
				initialState: { messages, model: spec.model.model, tools },
				streamFn: spec.model.streamFn,
				beforeToolCall: async ({ toolCall, args }) => {
					const policy = byName.get(toolCall.name)?.policy ?? "allow";
					if (policy === "deny") {
						return {
							block: true,
							reason: `The company does not allow ${toolCall.name}. Don't try it again.`,
						};
					}
					if (policy === "approve") {
						const approval = await ports.approvals.create({
							runId,
							sessionId,
							agentKey: spec.key,
							tool: toolCall.name,
							toolCallId: toolCall.id,
							args: (args ?? {}) as Record<string, unknown>,
						});
						approvalIds.push(approval.id);
						// No `terminate`: the agent gets one more turn to tell the person
						// it's waiting, in its own words. The decision comes later.
						return {
							block: true,
							reason: `Waiting for a person to approve ${toolCall.name} (approval ${approval.id}). Say it is waiting; don't retry it.`,
						};
					}
					return undefined;
				},
				afterToolCall: async ({ toolCall, isError }) => {
					await ports.events.append({
						type: "agent.tool_called",
						source: `agent/${spec.key}`,
						subject: runId,
						data: { tool: toolCall.name, isError },
						idempotencyKey: `tool:${runId}:${toolCall.id}`,
					});
					return undefined;
				},
			});
			active.set(sessionId, agent);

			// Save whatever the transcript gained. pi keeps system messages in the
			// transcript without announcing them, so compare lengths, not events.
			const flush = async () => {
				const all = agent.state.messages;
				if (all.length > persisted) {
					await ports.transcripts.append(sessionId, all.slice(persisted));
					persisted = all.length;
				}
			};

			let turns = 0;
			let costMicroUsd = 0;
			agent.subscribe(async (event) => {
				if (event.type === "message_end") {
					await flush();
					if (event.message.role === "assistant") {
						const u = (event.message as AssistantMessage).usage;
						const cost = Math.round((u?.cost?.total ?? 0) * 1_000_000);
						costMicroUsd += cost;
						await ports.runs.addUsage(runId, {
							inputTokens: u?.input ?? 0,
							outputTokens: u?.output ?? 0,
							cacheReadTokens: u?.cacheRead ?? 0,
							cacheWriteTokens: u?.cacheWrite ?? 0,
							costMicroUsd: cost,
						});
						const max = spec.budget?.maxCostMicroUsd;
						if (max !== undefined && costMicroUsd >= max && !stoppedBecause) {
							stoppedBecause = `budget reached: this run cost ${costMicroUsd} of ${max} micro-USD`;
							agent.abort();
						}
					}
				}
				if (event.type === "turn_end") {
					turns++;
					const max = spec.budget?.maxTurns;
					if (max !== undefined && turns >= max && !stoppedBecause) {
						stoppedBecause = `budget reached: ${turns} turns`;
						agent.abort();
					}
				}
			});

			const last = agent.state.messages.at(-1);
			if (input !== null) await agent.prompt(input);
			else if (last?.role === "toolResult" || last?.role === "user")
				await agent.continue();
			else await agent.prompt(note ?? "Carry on.");
			await flush();

			const final = [...agent.state.messages]
				.reverse()
				.find((m) => m.role === "assistant") as AssistantMessage | undefined;
			const text = final ? textOf(final) : "";
			const pending = [];
			for (const id of approvalIds) {
				if ((await ports.approvals.get(id))?.status === "pending")
					pending.push(id);
			}

			if (stoppedBecause || final?.stopReason === "aborted") {
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
			// Checked again when recording it, in case two people decide at once.
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

						// Put the real outcome where the "waiting for approval" placeholder was.
						const rows = await ports.transcripts.load(approval.sessionId);
						const row = rows.find(
							(r) =>
								(r.message as AgentMessage).role === "toolResult" &&
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
						// If the conversation moved on since, tell the agent what was decided.
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
function repairInterruptedToolCalls(
	messages: AgentMessage[],
): ToolResultMessage[] {
	const lastAssistant = messages.findLastIndex((m) => m.role === "assistant");
	if (lastAssistant < 0) return [];
	if (messages.slice(lastAssistant + 1).some((m) => m.role !== "toolResult"))
		return [];
	const answered = new Set(
		messages
			.slice(lastAssistant + 1)
			.map((m) => (m as ToolResultMessage).toolCallId),
	);
	const calls = (messages[lastAssistant] as AssistantMessage).content.filter(
		(c) => c.type === "toolCall",
	);
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
	messages: AgentMessage[],
	instructions: string,
): AgentMessage[] {
	const systems = messages.filter((m) => m.role === "system");
	if (systems.length === 0) {
		return [
			{
				role: "system",
				content: PREAMBLE,
				sections: { instructions },
				timestamp: Date.now(),
			} as AgentMessage,
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
		} as AgentMessage,
	];
}

function toPiTool(
	tool: BrainTool,
	ctx: { runId: string; sessionId: string; agentKey: string },
): AgentTool {
	return {
		name: tool.name,
		label: tool.name,
		description: tool.description,
		// pi accepts plain JSON Schema here and validates the model's arguments against it.
		parameters: tool.parameters as unknown as TSchema,
		execute: async (_id, params, signal) => {
			const result = await runWithTimeout(
				tool,
				(params ?? {}) as Record<string, unknown>,
				ctx,
				signal,
			);
			return {
				content: [{ type: "text", text: result.text }],
				details: result.details ?? {},
				isError: result.isError ?? false,
			};
		},
	};
}

/** pi has no per-tool timeout (O1 spike, item 8). A normal timer, not
 *  AbortSignal.timeout, whose timer doesn't keep the process alive. */
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
	return message.content
		.filter((c) => c.type === "text")
		.map((c) => (c as { text: string }).text)
		.join("")
		.trim();
}
