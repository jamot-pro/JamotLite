import type { Channel, CompanyStore } from "@jamot/ports";

/**
 * Messages in and out of the company. The rule (AGENTS.md rule 2): resolve the
 * person first, then record the message and a memory of it — for every
 * message, both ways. Each happens in one transaction, so a message is never
 * recorded without its person, memory and follow-up.
 */

export interface InboundMessage {
	channel: Channel;
	/** The channel's chat id. */
	threadId: string;
	/** The channel's id for this message, so a redelivery is recorded once. */
	messageId: string;
	from: { userId: string; displayName: string };
	text: string;
	at?: string;
}

export interface Intake {
	personId: string;
	conversationId: string;
	messageId: string;
	duplicate: boolean;
	newPerson: boolean;
}

export const REPLY_JOB = "agent.reply";

export async function receiveMessage(
	store: CompanyStore,
	inbound: InboundMessage,
): Promise<Intake> {
	return store.transaction(async (tx) => {
		let person = await tx.people.findByIdentity(
			inbound.channel,
			inbound.from.userId,
		);
		const newPerson = !person;
		if (!person) {
			person = await tx.people.create({
				displayName: inbound.from.displayName,
			});
			// The channel vouches for its own user ids.
			await tx.people.addIdentity(person.id, {
				provider: inbound.channel,
				value: inbound.from.userId,
				verified: true,
			});
		}
		const conversation = await tx.conversations.open({
			channel: inbound.channel,
			externalThreadId: inbound.threadId,
			personId: person.id,
		});
		const { message, duplicate } = await tx.conversations.receive({
			conversationId: conversation.id,
			text: inbound.text,
			personId: person.id,
			externalId: inbound.messageId,
			...(inbound.at ? { at: inbound.at } : {}),
		});
		const result = {
			personId: person.id,
			conversationId: conversation.id,
			messageId: message.id,
			duplicate,
			newPerson,
		};
		if (duplicate) return result;

		await tx.people.update(person.id, { lastInteractionAt: message.createdAt });
		await tx.memory.store({
			scope: "person",
			ownerId: person.id,
			kind: "interaction",
			content: `${person.displayName}: ${inbound.text}`,
			data: {
				direction: "in",
				channel: inbound.channel,
				conversationId: conversation.id,
				messageId: message.id,
			},
			source: "conversation",
		});
		await tx.events.append({
			type: "message.received",
			source: `channel/${inbound.channel}`,
			subject: person.id,
			data: { conversationId: conversation.id, messageId: message.id },
			idempotencyKey: `${inbound.channel}:${inbound.threadId}:${inbound.messageId}`,
		});
		await tx.jobs.enqueue({
			kind: REPLY_JOB,
			key: `reply:${message.id}`,
			payload: { conversationId: conversation.id, messageId: message.id },
		});
		return result;
	});
}

/** After the channel delivered an outbound message: mark it sent and remember it. */
export async function recordSent(
	store: CompanyStore,
	messageId: string,
	externalId: string | null,
): Promise<void> {
	await store.transaction(async (tx) => {
		const pending = await tx.conversations.getMessage(messageId);
		// Nothing to record, or already recorded.
		if (pending?.direction !== "out" || pending.status !== "pending") return;
		await tx.conversations.markSent(messageId, externalId);
		const conversation = await tx.conversations.get(pending.conversationId);
		const personId = pending.personId ?? conversation?.personId ?? null;
		if (personId) {
			const person = await tx.people.get(personId);
			await tx.memory.store({
				scope: "person",
				ownerId: personId,
				kind: "interaction",
				content: `${pending.agentKey ?? "The company"} → ${person?.displayName ?? "them"}: ${pending.text}`,
				data: {
					direction: "out",
					channel: conversation?.channel ?? null,
					conversationId: pending.conversationId,
					messageId,
				},
				source: "conversation",
			});
		}
		await tx.events.append({
			type: "message.sent",
			source: `channel/${conversation?.channel ?? "unknown"}`,
			subject: personId,
			data: { conversationId: pending.conversationId, messageId },
			idempotencyKey: `sent:${messageId}`,
		});
	});
}
