import type { CompanyStore } from "@jamot/ports";
import { openCompanyStore } from "@jamot/sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type InboundMessage,
	REPLY_JOB,
	receiveMessage,
	recordSent,
} from "./intake.js";

let store: CompanyStore;
beforeEach(() => {
	store = openCompanyStore(":memory:");
});
afterEach(() => store.close());

const rossi = (messageId: string, text: string): InboundMessage => ({
	channel: "telegram",
	threadId: "chat-100",
	messageId,
	from: { userId: "100", displayName: "Mrs. Rossi" },
	text,
});

describe("messages in and out", () => {
	it("turns a first message into a person, a conversation, a memory and a reply job", async () => {
		const intake = await receiveMessage(
			store,
			rossi("1", "Do you have gluten-free bread?"),
		);
		expect(intake).toMatchObject({ newPerson: true, duplicate: false });

		const person = await store.people.findByIdentity("telegram", "100");
		expect(person).toMatchObject({
			id: intake.personId,
			displayName: "Mrs. Rossi",
		});
		expect(person?.lastInteractionAt).not.toBeNull();
		expect(
			(await store.memory.search("gluten", { ownerId: intake.personId })).map(
				(m) => m.content,
			),
		).toEqual(["Mrs. Rossi: Do you have gluten-free bread?"]);
		expect((await store.events.listUndelivered()).map((e) => e.type)).toEqual([
			"message.received",
		]);
		const [job] = await store.jobs.list({ kind: REPLY_JOB });
		expect(job?.payload).toEqual({
			conversationId: intake.conversationId,
			messageId: intake.messageId,
		});
	});

	it("knows the person the second time", async () => {
		const first = await receiveMessage(store, rossi("1", "Hello"));
		const second = await receiveMessage(store, rossi("2", "It's me again"));
		expect(second).toMatchObject({
			newPerson: false,
			personId: first.personId,
			conversationId: first.conversationId,
		});
		expect(await store.people.list()).toHaveLength(1);
	});

	it("records a redelivered message once, with no second reply", async () => {
		await receiveMessage(store, rossi("1", "Hello"));
		const again = await receiveMessage(store, rossi("1", "Hello"));
		expect(again.duplicate).toBe(true);
		expect(await store.jobs.list({ kind: REPLY_JOB })).toHaveLength(1);
		expect(await store.memory.list({ kind: "interaction" })).toHaveLength(1);
	});

	it("remembers what the company said, once it was sent", async () => {
		const intake = await receiveMessage(store, rossi("1", "Gluten-free?"));
		const out = await store.conversations.enqueue({
			conversationId: intake.conversationId,
			text: "Yes, on Fridays.",
			agentKey: "host",
			personId: intake.personId,
		});
		expect(await store.memory.search("fridays")).toEqual([]);

		await recordSent(store, out.id, "tg-555");
		await recordSent(store, out.id, "tg-555");
		expect(
			(await store.memory.search("fridays")).map((m) => m.content),
		).toEqual(["host → Mrs. Rossi: Yes, on Fridays."]);
		const [sent] = (
			await store.conversations.listMessages(intake.conversationId)
		).filter((m) => m.direction === "out");
		expect(sent).toMatchObject({ status: "sent", externalId: "tg-555" });
	});
});
