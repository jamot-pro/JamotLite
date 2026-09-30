import type { CompanyStore } from "@jamot/ports";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openCompanyStore, toFtsQuery } from "./index.js";

let store: CompanyStore;
beforeEach(() => {
	store = openCompanyStore(":memory:");
});
afterEach(() => store.close());

describe("people", () => {
	it("finds a person by any of their identities, however it was written", async () => {
		const rossi = await store.people.create({
			displayName: "Mrs. Rossi",
			email: "Rossi@Example.com ",
		});
		await store.people.addIdentity(rossi.id, {
			provider: "phone",
			value: "+39 333 123-4567",
		});
		await store.people.addIdentity(rossi.id, {
			provider: "telegram",
			value: "5550001",
		});

		expect(rossi.email).toBe("rossi@example.com");
		expect(
			(await store.people.findByIdentity("phone", "+393331234567"))?.id,
		).toBe(rossi.id);
		expect(
			(await store.people.findByIdentity("telegram", " 5550001"))?.id,
		).toBe(rossi.id);
		expect(await store.people.findByIdentity("telegram", "999")).toBeNull();
	});

	it("never gives one identity to two people", async () => {
		const a = await store.people.create({ displayName: "A" });
		const b = await store.people.create({ displayName: "B" });
		const first = await store.people.addIdentity(a.id, {
			provider: "telegram",
			value: "42",
		});
		expect(
			(
				await store.people.addIdentity(a.id, {
					provider: "telegram",
					value: "42",
				})
			).id,
		).toBe(first.id);
		await expect(
			store.people.addIdentity(b.id, { provider: "telegram", value: "42" }),
		).rejects.toThrow(/merge them/);
	});

	it("merges two records of the same person without losing anything", async () => {
		const keep = await store.people.create({
			displayName: "Marco",
			consent: { photos: true },
		});
		const drop = await store.people.create({
			displayName: "marco (telegram)",
			phone: "+62 811 000",
			consent: { marketing: false },
		});
		await store.people.addIdentity(drop.id, {
			provider: "telegram",
			value: "7",
		});
		const convo = await store.conversations.open({
			channel: "telegram",
			externalThreadId: "7",
			personId: drop.id,
		});
		await store.conversations.receive({
			conversationId: convo.id,
			text: "ciao",
			personId: drop.id,
		});
		await store.memory.store({
			scope: "person",
			ownerId: drop.id,
			kind: "fact",
			content: "Starts university in October",
			source: "conversation",
		});

		const merged = await store.people.merge(keep.id, drop.id);

		expect(merged).toMatchObject({
			displayName: "Marco",
			phone: "+62811000",
			consent: { photos: true, marketing: false },
		});
		expect(await store.people.get(drop.id)).toBeNull();
		expect((await store.people.findByIdentity("telegram", "7"))?.id).toBe(
			keep.id,
		);
		expect((await store.conversations.get(convo.id))?.personId).toBe(keep.id);
		expect(
			await store.memory.list({ scope: "person", ownerId: keep.id }),
		).toHaveLength(1);
	});

	it("searches by name, email or phone", async () => {
		await store.people.create({
			displayName: "Lucia Bianchi",
			email: "lucia@bakery.it",
		});
		await store.people.create({ displayName: "Marco", phone: "+39 111" });
		expect(
			(await store.people.list({ search: "bakery" })).map((p) => p.displayName),
		).toEqual(["Lucia Bianchi"]);
		expect(
			(await store.people.list({ search: "111" })).map((p) => p.displayName),
		).toEqual(["Marco"]);
		expect(await store.people.list({ search: "100%" })).toEqual([]);
	});
});

describe("conversations", () => {
	it("records a redelivered Telegram message once", async () => {
		const c = await store.conversations.open({
			channel: "telegram",
			externalThreadId: "chat-1",
		});
		const first = await store.conversations.receive({
			conversationId: c.id,
			text: "Table for 4?",
			externalId: "m1",
		});
		const again = await store.conversations.receive({
			conversationId: c.id,
			text: "Table for 4?",
			externalId: "m1",
		});
		expect(again).toEqual({ message: first.message, duplicate: true });
		expect(await store.conversations.listMessages(c.id)).toHaveLength(1);
	});

	it("reopens the same thread, and links its person once we know them", async () => {
		const a = await store.conversations.open({
			channel: "telegram",
			externalThreadId: "chat-2",
		});
		const person = await store.people.create({ displayName: "Guest" });
		const b = await store.conversations.open({
			channel: "telegram",
			externalThreadId: "chat-2",
			personId: person.id,
		});
		expect(b.id).toBe(a.id);
		expect(b.personId).toBe(person.id);
	});

	it("keeps outbound messages pending until the channel sends them", async () => {
		const c = await store.conversations.open({
			channel: "telegram",
			externalThreadId: "chat-3",
		});
		const out = await store.conversations.enqueue({
			conversationId: c.id,
			text: "Booked for 8pm",
			agentKey: "host",
		});
		expect(await store.conversations.listPending()).toEqual([out]);

		await store.conversations.markSent(out.id, "tg-99");
		expect(await store.conversations.listPending()).toEqual([]);
		const [sent] = await store.conversations.listMessages(c.id);
		expect(sent).toMatchObject({
			status: "sent",
			externalId: "tg-99",
			agentKey: "host",
		});
	});

	it("returns the latest messages, oldest first", async () => {
		const c = await store.conversations.open({
			channel: "telegram",
			externalThreadId: "chat-4",
		});
		for (const text of ["1", "2", "3", "4"])
			await store.conversations.receive({ conversationId: c.id, text });
		expect(
			(await store.conversations.listMessages(c.id, { limit: 2 })).map(
				(m) => m.text,
			),
		).toEqual(["3", "4"]);
	});
});

describe("memory", () => {
	it("finds memories by words, prefixes and accents", async () => {
		await store.memory.store({
			scope: "person",
			ownerId: "p1",
			kind: "preference",
			content: "Gluten-free, no nuts",
			source: "conversation",
		});
		await store.memory.store({
			scope: "person",
			ownerId: "p1",
			kind: "fact",
			content: "Café crème every morning",
			source: "conversation",
		});
		await store.memory.store({
			scope: "company",
			kind: "fact",
			content: "Flour supplier closes in August",
			source: "human",
		});

		expect((await store.memory.search("glut")).map((m) => m.content)).toEqual([
			"Gluten-free, no nuts",
		]);
		expect((await store.memory.search("creme")).map((m) => m.content)).toEqual([
			"Café crème every morning",
		]);
		expect(await store.memory.search("flour", { scope: "person" })).toEqual([]);
		expect(await store.memory.search('"; DROP TABLE memories; --')).toEqual([]);
	});

	it("keeps search in step with edits and forgetting", async () => {
		const m = await store.memory.store({
			scope: "company",
			kind: "fact",
			content: "Closed on Mondays",
			source: "human",
		});
		await store.memory.update(m.id, { content: "Closed on Tuesdays" });
		expect(await store.memory.search("mondays")).toEqual([]);
		expect(await store.memory.search("tuesdays")).toHaveLength(1);
		await store.memory.forget(m.id);
		expect(await store.memory.search("tuesdays")).toEqual([]);
	});

	it("builds safe full-text queries from anything typed", () => {
		expect(toFtsQuery("Gluten free?")).toBe('"gluten"* OR "free"*');
		expect(toFtsQuery('" OR *')).toBe('"or"*');
		expect(toFtsQuery('"*()-')).toBeNull();
	});
});

describe("events", () => {
	it("records the same event once and delivers it in order", async () => {
		const a = await store.events.append({
			type: "message.received",
			source: "channel/telegram",
			idempotencyKey: "tg:1",
		});
		const again = await store.events.append({
			type: "message.received",
			source: "channel/telegram",
			idempotencyKey: "tg:1",
		});
		const b = await store.events.append({
			type: "responsibility.uncovered",
			source: "heartbeat/h-pulse",
			idempotencyKey: "hb:1",
		});
		expect(again).toEqual({ event: a.event, created: false });

		expect((await store.events.listUndelivered()).map((e) => e.id)).toEqual([
			a.event.id,
			b.event.id,
		]);
		await store.events.markDelivered(a.event.id);
		expect((await store.events.listUndelivered()).map((e) => e.id)).toEqual([
			b.event.id,
		]);
		expect(
			(await store.events.listSince(a.event.seq)).map((e) => e.id),
		).toEqual([b.event.id]);
	});
});

describe("jobs", () => {
	const t0 = "2026-10-01T08:00:00.000Z";
	const at = (seconds: number) =>
		new Date(Date.parse(t0) + seconds * 1000).toISOString();

	it("runs a job once per key, only when due", async () => {
		const { job } = await store.jobs.enqueue({
			kind: "heartbeat",
			key: "hb:h-pulse:2026-10-01T08:00",
			runAt: at(60),
		});
		expect(
			(
				await store.jobs.enqueue({
					kind: "heartbeat",
					key: "hb:h-pulse:2026-10-01T08:00",
				})
			).created,
		).toBe(false);
		expect(await store.jobs.claimDue({ now: t0, leaseMs: 30_000 })).toEqual([]);

		const [claimed] = await store.jobs.claimDue({
			now: at(60),
			leaseMs: 30_000,
		});
		expect(claimed).toMatchObject({
			id: job.id,
			status: "running",
			attempts: 1,
		});
		expect(await store.jobs.claimDue({ now: at(61), leaseMs: 30_000 })).toEqual(
			[],
		);
		await store.jobs.complete(job.id);
		expect((await store.jobs.get(job.id))?.status).toBe("done");
	});

	it("picks a job up again when its worker died, until attempts run out", async () => {
		const { job } = await store.jobs.enqueue({
			kind: "agent.run",
			runAt: t0,
			maxAttempts: 2,
		});
		await store.jobs.claimDue({ now: t0, leaseMs: 10_000 });
		// The process died: nobody completed it. After the lease, it's claimed again.
		const [retry] = await store.jobs.claimDue({ now: at(11), leaseMs: 10_000 });
		expect(retry).toMatchObject({ id: job.id, attempts: 2 });
		// Died again, and both attempts are used: it's dead, not retried forever.
		expect(await store.jobs.claimDue({ now: at(22), leaseMs: 10_000 })).toEqual(
			[],
		);
		expect((await store.jobs.get(job.id))?.status).toBe("dead");
	});

	it("retries a failed job later, then gives up", async () => {
		const { job } = await store.jobs.enqueue({
			kind: "send",
			runAt: t0,
			maxAttempts: 2,
		});
		await store.jobs.claimDue({ now: t0, leaseMs: 10_000 });
		expect(
			await store.jobs.fail(job.id, "429 rate limited", at(30)),
		).toMatchObject({ status: "queued", runAt: at(30) });
		await store.jobs.claimDue({ now: at(30), leaseMs: 10_000 });
		expect(await store.jobs.fail(job.id, "429 again", at(90))).toMatchObject({
			status: "dead",
			lastError: "429 again",
		});
	});
});

describe("ledger", () => {
	it("sums whole minor units exactly", async () => {
		await store.ledger.post([
			{ currency: "EUR", amountMinor: 1010, description: "Pop-up sales" },
			{
				currency: "EUR",
				amountMinor: -3,
				description: "LLM cost, run 1",
				ref: "run:1",
			},
			{ currency: "IDR", amountMinor: 50_000, description: "Coffee Pass" },
		]);
		expect(await store.ledger.balance("EUR")).toBe(1007);
		expect(await store.ledger.balance("IDR")).toBe(50_000);
		expect(await store.ledger.balance("USD")).toBe(0);
	});

	it("posts all entries or none", async () => {
		await expect(
			store.ledger.post([
				{ currency: "EUR", amountMinor: 500, description: "fine" },
				{ currency: "EUR", amountMinor: 0.5, description: "half a cent" },
			]),
		).rejects.toThrow(/whole number/);
		await expect(
			store.ledger.post([
				{ currency: "eur", amountMinor: 1, description: "x" },
			]),
		).rejects.toThrow(/ISO 4217/);
		expect(await store.ledger.balance("EUR")).toBe(0);
	});
});

describe("settings", () => {
	it("stores JSON values by key", async () => {
		await store.settings.set("model", {
			provider: "anthropic",
			id: "claude-sonnet-5",
		});
		expect(await store.settings.get("model")).toEqual({
			provider: "anthropic",
			id: "claude-sonnet-5",
		});
		expect(await store.settings.delete("model")).toBe(true);
		expect(await store.settings.get("model")).toBeNull();
	});
});

describe("transactions", () => {
	it("commits work across ports together", async () => {
		const { person, convo } = await store.transaction(async (tx) => {
			const person = await tx.people.create({ displayName: "New customer" });
			const convo = await tx.conversations.open({
				channel: "telegram",
				externalThreadId: "chat-9",
				personId: person.id,
			});
			await tx.conversations.receive({
				conversationId: convo.id,
				text: "Hi",
				personId: person.id,
			});
			await tx.events.append({
				type: "message.received",
				source: "channel/telegram",
				idempotencyKey: "tg:9",
			});
			return { person, convo };
		});
		expect(await store.people.get(person.id)).not.toBeNull();
		expect(await store.conversations.listMessages(convo.id)).toHaveLength(1);
	});

	it("rolls everything back when any step fails", async () => {
		await expect(
			store.transaction(async (tx) => {
				await tx.people.create({ displayName: "Half-saved" });
				await tx.events.append({
					type: "x",
					source: "test",
					idempotencyKey: "k",
				});
				throw new Error("channel went away");
			}),
		).rejects.toThrow("channel went away");
		expect(await store.people.list()).toEqual([]);
		expect(await store.events.listUndelivered()).toEqual([]);
	});

	it("makes other calls wait until the transaction ends", async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const tx = store.transaction(async (t) => {
			await t.people.create({ displayName: "Inside" });
			await gate;
		});
		const outside = store.people.list();
		release();
		await tx;
		expect((await outside).map((p) => p.displayName)).toEqual(["Inside"]);
	});

	it("refuses the outer store inside a transaction instead of hanging", async () => {
		await expect(
			store.transaction(async () => store.people.list()),
		).rejects.toThrow(/use the ports passed/);
	});
});
