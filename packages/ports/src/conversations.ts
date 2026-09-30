/**
 * Conversations and messages. Inbound messages are recorded once (Telegram
 * redelivers; `externalId` makes that harmless). Outbound messages wait in the
 * same table as `pending` until the channel worker sends them — the outbox.
 */

export type Channel = "telegram";

export interface Conversation {
	id: string;
	channel: Channel;
	/** The channel's own id for the thread (a Telegram chat id). */
	externalThreadId: string;
	personId: string | null;
	title: string | null;
	createdAt: string;
	lastMessageAt: string | null;
}

export type MessageStatus = "received" | "pending" | "sent" | "failed";

export interface Message {
	id: string;
	conversationId: string;
	direction: "in" | "out";
	status: MessageStatus;
	text: string;
	personId: string | null;
	/** Graph key of the agent that wrote an outbound message. */
	agentKey: string | null;
	externalId: string | null;
	error: string | null;
	createdAt: string;
	sentAt: string | null;
}

export interface ConversationStore {
	/** Finds or creates the conversation for a channel thread. */
	open(input: {
		channel: Channel;
		externalThreadId: string;
		personId?: string | null;
		title?: string | null;
	}): Promise<Conversation>;
	get(id: string): Promise<Conversation | null>;
	/** Most recent first. */
	list(opts?: { personId?: string; limit?: number }): Promise<Conversation[]>;
	/** Records an inbound message; `duplicate` is true when `externalId` was already recorded. */
	receive(input: {
		conversationId: string;
		text: string;
		personId?: string | null;
		externalId?: string | null;
		at?: string;
	}): Promise<{ message: Message; duplicate: boolean }>;
	/** Queues an outbound message. */
	enqueue(input: {
		conversationId: string;
		text: string;
		agentKey?: string | null;
		personId?: string | null;
	}): Promise<Message>;
	/** Oldest first. */
	listPending(limit?: number): Promise<Message[]>;
	markSent(messageId: string, externalId?: string | null): Promise<void>;
	markFailed(messageId: string, error: string): Promise<void>;
	getMessage(messageId: string): Promise<Message | null>;
	/** Oldest first; `limit` keeps the most recent ones. */
	listMessages(
		conversationId: string,
		opts?: { limit?: number },
	): Promise<Message[]>;
}
