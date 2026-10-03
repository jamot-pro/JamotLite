import type {
	AgentSpec,
	Brain,
	BrainTool,
	ModelAccess,
	RunOutcome,
} from "@jamot/brain";
import { DreamConfig } from "@jamot/contracts";
import type { CompanyStore, Conversation, Person } from "@jamot/ports";
import { memoryTools } from "./memory-tools.js";
import { agentSpecFromNode, pickChannelAgent } from "./spec.js";

export interface ReplyDeps {
	store: CompanyStore;
	brain: Brain;
	/** The model agents use, built from settings and the secret store. */
	model: () => Promise<ModelAccess>;
	/** Told when an agent's run is waiting for a person's approval. */
	onApprovalNeeded?: (approvalIds: string[]) => Promise<void>;
	/** More tools for an agent — its MCP tools, for one. */
	extraTools?: (agentKey: string) => BrainTool[] | Promise<BrainTool[]>;
	/** What a run may spend right now — survival lowers it when money runs low. */
	budget?: () => Promise<AgentSpec["budget"]>;
}

/** The session of one agent in one conversation: "telegram:<chat id>:<agent key>". */
export const sessionIdFor = (conversation: Conversation, agentKey: string) =>
	`${conversation.channel}:${conversation.externalThreadId}:${agentKey}`;

/**
 * The `agent.reply` job: an agent answers a message a person sent. The final
 * text of the run is queued as the reply; the channel sends it and records it
 * as memory. Returns null when there is nothing to do.
 */
export async function replyToMessage(
	deps: ReplyDeps,
	job: { conversationId: string; messageId: string },
): Promise<RunOutcome | null> {
	const { store } = deps;
	const conversation = await store.conversations.get(job.conversationId);
	const inbound = await store.conversations.getMessage(job.messageId);
	if (!conversation || inbound?.direction !== "in" || !conversation.personId)
		return null;
	const person = await store.people.get(conversation.personId);
	if (!person) return null;

	const agent = await conversationAgent(deps, conversation, person);
	if (!agent) {
		await store.events.append({
			type: "agent.missing",
			source: `channel/${conversation.channel}`,
			subject: person.id,
			data: { conversationId: conversation.id, messageId: inbound.id },
			idempotencyKey: `agent-missing:${inbound.id}`,
		});
		return null;
	}

	const known = (
		await store.memory.list({ scope: "person", ownerId: person.id, limit: 50 })
	)
		.filter((m) => m.kind !== "interaction")
		.slice(0, 8);
	const input = [
		`${person.displayName} wrote on ${conversation.channel}:`,
		inbound.text,
		"",
		`What the company knows about ${person.displayName}:`,
		...(known.length ? known.map((m) => `- ${m.content}`) : ["- Nothing yet."]),
		"",
		"Answer with the message to send them.",
	].join("\n");

	const outcome = await deps.brain.run({
		agent,
		sessionId: sessionIdFor(conversation, agent.key),
		input,
		trigger: `message:${inbound.id}`,
	});
	await afterRun(deps, {
		outcome,
		conversation,
		person,
		agentKey: agent.key,
		once: `replied:${inbound.id}`,
	});
	return outcome;
}

/**
 * A person decided on a tool call an agent was waiting for (the owner pressed
 * Approve or Decline). The agent carries on in the same conversation, and
 * whatever it says next goes to the customer.
 */
export async function decideApproval(
	deps: ReplyDeps,
	decision: {
		approvalId: string;
		approved: boolean;
		by: string;
		note?: string;
	},
): Promise<RunOutcome | null> {
	const { store } = deps;
	const approval = await store.approvals.get(decision.approvalId);
	if (!approval) throw new Error(`no approval ${decision.approvalId}`);

	// "telegram:<chat id>:<agent key>" → the conversation and its person.
	const channel = approval.sessionId.slice(0, approval.sessionId.indexOf(":"));
	const threadId = approval.sessionId.slice(
		channel.length + 1,
		approval.sessionId.lastIndexOf(":"),
	);
	const conversation = (await store.conversations.list({ limit: 10_000 })).find(
		(c) => c.channel === channel && c.externalThreadId === threadId,
	);
	const person = conversation?.personId
		? await store.people.get(conversation.personId)
		: null;
	if (!conversation || !person)
		throw new Error(`the conversation for approval ${approval.id} is gone`);

	const agent = await conversationAgent(
		deps,
		conversation,
		person,
		approval.agentKey,
	);
	if (!agent)
		throw new Error(`agent ${approval.agentKey} is no longer in the company`);

	const outcome = await deps.brain.decide({ agent, ...decision });
	await afterRun(deps, {
		outcome,
		conversation,
		person,
		agentKey: agent.key,
		once: `decided:${approval.id}`,
	});
	return outcome;
}

/** The agent that talks in this conversation, as the brain runs it. */
async function conversationAgent(
	deps: ReplyDeps,
	conversation: Conversation,
	person: Person,
	agentKey?: string,
): Promise<AgentSpec | null> {
	const { store } = deps;
	const company = await store.graph.getCompany();
	if (!company) return null;
	const nodes = await store.graph.listNodes();
	const node = agentKey
		? (nodes.find((n) => n.kind === "agent" && n.key === agentKey) ?? null)
		: pickChannelAgent(
				nodes,
				await store.graph.listEdges(),
				conversation.channel,
			);
	if (!node) return null;

	const dreamNode = nodes.find((n) => n.kind === "dream");
	const dream = dreamNode ? DreamConfig.safeParse(dreamNode.config) : null;
	const budget = await deps.budget?.();
	const spec = agentSpecFromNode({
		node,
		company,
		dream: dream?.success ? dream.data : null,
		model: await deps.model(),
		tools: [
			...memoryTools(store, {
				personId: person.id,
				displayName: person.displayName,
			}),
			...((await deps.extraTools?.(node.key)) ?? []),
		],
	});
	return budget ? { ...spec, budget } : spec;
}

/** Queues what the agent said (once), or records that it said nothing. */
async function afterRun(
	deps: ReplyDeps,
	run: {
		outcome: RunOutcome;
		conversation: Conversation;
		person: Person;
		agentKey: string;
		once: string;
	},
): Promise<void> {
	const { store } = deps;
	const { outcome, conversation, person, agentKey } = run;
	if (
		(outcome.status === "done" || outcome.status === "awaiting_approval") &&
		outcome.text
	) {
		await store.transaction(async (tx) => {
			// A job retried after a crash must not send the same answer twice.
			const { created } = await tx.events.append({
				type: "agent.replied",
				source: `agent/${agentKey}`,
				subject: person.id,
				data: { conversationId: conversation.id, runId: outcome.runId },
				idempotencyKey: run.once,
			});
			if (created) {
				await tx.conversations.enqueue({
					conversationId: conversation.id,
					text: outcome.text,
					agentKey,
					personId: person.id,
				});
			}
		});
	} else if (outcome.status === "error" || outcome.status === "aborted") {
		// No answer went out: survival's Work vital counts these.
		await store.events.append({
			type: "agent.reply_failed",
			source: `agent/${agentKey}`,
			subject: person.id,
			data: {
				conversationId: conversation.id,
				runId: outcome.runId,
				reason: outcome.message,
			},
			idempotencyKey: `reply-failed:${outcome.runId}`,
		});
	}
	if (outcome.status === "awaiting_approval")
		await deps.onApprovalNeeded?.(outcome.approvalIds);
}
