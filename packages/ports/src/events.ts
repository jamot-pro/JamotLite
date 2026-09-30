/**
 * Events — the outbox. Everything that happened, in order, recorded in the
 * same transaction as the change that caused it, then delivered to whoever
 * reacts (agents, heartbeats, the hub). Shaped like a CloudEvent.
 */

export interface JamotEvent {
	id: string;
	/** Position in the log; strictly increasing. */
	seq: number;
	/** e.g. "message.received", "responsibility.uncovered". */
	type: string;
	/** Where it came from, e.g. "channel/telegram", "heartbeat/h-pulse". */
	source: string;
	/** What it is about, e.g. a person or node id. */
	subject: string | null;
	time: string;
	data: Record<string, unknown>;
	/** The same key twice records the event once. */
	idempotencyKey: string;
	deliveredAt: string | null;
}

export interface NewEvent {
	type: string;
	source: string;
	subject?: string | null;
	data?: Record<string, unknown>;
	idempotencyKey: string;
	time?: string;
}

export interface EventStore {
	append(input: NewEvent): Promise<{ event: JamotEvent; created: boolean }>;
	/** Oldest first. */
	listUndelivered(limit?: number): Promise<JamotEvent[]>;
	markDelivered(eventId: string): Promise<void>;
	/** Newest first, filtered by type and time. */
	list(filter?: {
		type?: string;
		since?: string;
		limit?: number;
	}): Promise<JamotEvent[]>;
	/** Events after `seq`, oldest first — for anyone following the log. */
	listSince(seq: number, limit?: number): Promise<JamotEvent[]>;
}
