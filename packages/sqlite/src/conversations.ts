import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
	Channel,
	Conversation,
	ConversationStore,
	Message,
} from "@jamot/ports";
import { all, nowIso, one, type Row, run, type Sync } from "./sync.js";

const CONVERSATION_COLUMNS =
	"id, channel, external_thread_id, person_id, title, created_at, last_message_at";
const MESSAGE_COLUMNS =
	"id, conversation_id, direction, status, text, person_id, agent_key, external_id, error, created_at, sent_at";

export function conversationOps(db: DatabaseSync): Sync<ConversationStore> {
	const get = (id: string) => {
		const row = one(
			db,
			`SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = ?`,
			id,
		);
		return row ? toConversation(row) : null;
	};
	const getMessage = (id: string) => {
		const row = one(
			db,
			`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ?`,
			id,
		);
		return row ? toMessage(row) : null;
	};

	const touch = (conversationId: string, at: string) =>
		run(
			db,
			"UPDATE conversations SET last_message_at = max(coalesce(last_message_at, ''), ?) WHERE id = ?",
			at,
			conversationId,
		);

	return {
		open(input) {
			const found = one(
				db,
				`SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE channel = ? AND external_thread_id = ?`,
				input.channel,
				input.externalThreadId,
			);
			if (found) {
				const c = toConversation(found);
				// A thread first seen before we knew who it was gets its person once we do.
				if (!c.personId && input.personId) {
					run(
						db,
						"UPDATE conversations SET person_id = ? WHERE id = ?",
						input.personId,
						c.id,
					);
					return get(c.id) as Conversation;
				}
				return c;
			}
			const id = randomUUID();
			run(
				db,
				"INSERT INTO conversations (id, channel, external_thread_id, person_id, title, created_at) VALUES (?, ?, ?, ?, ?, ?)",
				id,
				input.channel,
				input.externalThreadId,
				input.personId ?? null,
				input.title ?? null,
				nowIso(),
			);
			return get(id) as Conversation;
		},

		get,

		list(opts = {}) {
			const limit = opts.limit ?? 50;
			const order =
				"ORDER BY coalesce(last_message_at, created_at) DESC, seq DESC LIMIT ?";
			const rows = opts.personId
				? all(
						db,
						`SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE person_id = ? ${order}`,
						opts.personId,
						limit,
					)
				: all(
						db,
						`SELECT ${CONVERSATION_COLUMNS} FROM conversations ${order}`,
						limit,
					);
			return rows.map(toConversation);
		},

		receive(input) {
			if (input.externalId) {
				const seen = one(
					db,
					`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE conversation_id = ? AND direction = 'in' AND external_id = ?`,
					input.conversationId,
					input.externalId,
				);
				if (seen) return { message: toMessage(seen), duplicate: true };
			}
			const id = randomUUID();
			const at = input.at ?? nowIso();
			run(
				db,
				"INSERT INTO messages (id, conversation_id, direction, status, text, person_id, external_id, created_at) VALUES (?, ?, 'in', 'received', ?, ?, ?, ?)",
				id,
				input.conversationId,
				input.text,
				input.personId ?? null,
				input.externalId ?? null,
				at,
			);
			touch(input.conversationId, at);
			return { message: getMessage(id) as Message, duplicate: false };
		},

		enqueue(input) {
			const id = randomUUID();
			const at = nowIso();
			run(
				db,
				"INSERT INTO messages (id, conversation_id, direction, status, text, person_id, agent_key, created_at) VALUES (?, ?, 'out', 'pending', ?, ?, ?, ?)",
				id,
				input.conversationId,
				input.text,
				input.personId ?? null,
				input.agentKey ?? null,
				at,
			);
			touch(input.conversationId, at);
			return getMessage(id) as Message;
		},

		listPending(limit = 50) {
			return all(
				db,
				`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE status = 'pending' ORDER BY seq LIMIT ?`,
				limit,
			).map(toMessage);
		},

		markSent(messageId, externalId) {
			run(
				db,
				"UPDATE messages SET status = 'sent', sent_at = ?, external_id = coalesce(?, external_id), error = NULL WHERE id = ? AND direction = 'out'",
				nowIso(),
				externalId ?? null,
				messageId,
			);
		},

		markFailed(messageId, error) {
			run(
				db,
				"UPDATE messages SET status = 'failed', error = ? WHERE id = ? AND direction = 'out'",
				error,
				messageId,
			);
		},

		getMessage,

		listMessages(conversationId, opts = {}) {
			const rows = all(
				db,
				`SELECT ${MESSAGE_COLUMNS} FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq`,
				conversationId,
				opts.limit ?? 200,
			);
			return rows.map(toMessage);
		},
	};
}

function toConversation(row: Row): Conversation {
	return {
		id: String(row.id),
		channel: row.channel as Channel,
		externalThreadId: String(row.external_thread_id),
		personId: (row.person_id as string | null) ?? null,
		title: (row.title as string | null) ?? null,
		createdAt: String(row.created_at),
		lastMessageAt: (row.last_message_at as string | null) ?? null,
	};
}

function toMessage(row: Row): Message {
	return {
		id: String(row.id),
		conversationId: String(row.conversation_id),
		direction: row.direction as Message["direction"],
		status: row.status as Message["status"],
		text: String(row.text),
		personId: (row.person_id as string | null) ?? null,
		agentKey: (row.agent_key as string | null) ?? null,
		externalId: (row.external_id as string | null) ?? null,
		error: (row.error as string | null) ?? null,
		createdAt: String(row.created_at),
		sentAt: (row.sent_at as string | null) ?? null,
	};
}
