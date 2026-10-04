import { OWNER_LAST_SEEN, SUCCESSION } from "@jamot/core";
import type { CompanyStore } from "@jamot/ports";
import { openCompanyStore } from "@jamot/sqlite";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTelegramChannel, type TelegramChannel } from "./channel.js";

type Call = { method: string; payload: Record<string, unknown> };
let store: CompanyStore;
let bot: Bot;
let calls: Call[];
let refuse: Map<string, { error_code: number; description: string }>;
let decisions: [string, boolean, string][];
let acts: [string, string][];
let channel: TelegramChannel;

beforeEach(() => {
	store = openCompanyStore(":memory:");
	calls = [];
	refuse = new Map();
	decisions = [];
	acts = [];
	let nextId = 500;
	bot = new Bot("123:TEST", {
		botInfo: {
			id: 42,
			is_bot: true,
			first_name: "Café",
			username: "cafe_bot",
		} as unknown as UserFromGetMe,
	});
	// A fake Telegram: records every call, answers like the real API.
	bot.api.config.use(async (_prev, method, payload) => {
		const p = (payload ?? {}) as Record<string, unknown>;
		calls.push({ method, payload: p });
		const refused = refuse.get(String(p.chat_id));
		if (method === "sendMessage" && refused)
			return { ok: false, ...refused } as never;
		const result =
			method === "sendMessage"
				? {
						message_id: nextId++,
						date: 0,
						chat: { id: Number(p.chat_id), type: "private" },
						text: p.text,
					}
				: true;
		return { ok: true, result } as never;
	});
	channel = createTelegramChannel(bot, {
		store,
		decide: async (id, approved, by) => {
			decisions.push([id, approved, by]);
			await store.approvals.decide(id, { approved, by });
		},
		act: async (action, by) => {
			acts.push([action, by]);
			return `did ${action}`;
		},
		log: () => {},
	});
});
afterEach(() => store.close());

let updateId = 1;
const person = (id: number, first_name: string) => ({
	id,
	is_bot: false,
	first_name,
});
function text(
	from: { id: number; first_name: string },
	body: string,
	chat: { id: number; type: string } = { id: from.id, type: "private" },
): Update {
	const command = body.startsWith("/")
		? {
				entities: [
					{
						type: "bot_command",
						offset: 0,
						length: body.split(" ")[0]?.length ?? 0,
					},
				],
			}
		: {};
	return {
		update_id: updateId++,
		message: {
			message_id: updateId,
			date: 1_790_000_000,
			chat,
			from: person(from.id, from.first_name),
			text: body,
			...command,
		},
	} as unknown as Update;
}
function press(from: { id: number; first_name: string }, data: string): Update {
	return {
		update_id: updateId++,
		callback_query: {
			id: `cb${updateId}`,
			from: person(from.id, from.first_name),
			chat_instance: "x",
			data,
			message: {
				message_id: 9,
				date: 0,
				chat: { id: from.id, type: "private" },
				text: "Approve?",
			},
		},
	} as unknown as Update;
}
const sent = () =>
	calls.filter((c) => c.method === "sendMessage").map((c) => c.payload);
const rossi = { id: 100, first_name: "Rossi" };
const lucia = { id: 200, first_name: "Lucia" };

async function pendingApproval(tool = "payment_send") {
	const run = await store.runs.start({
		sessionId: "s",
		agentKey: "host",
		model: null,
		trigger: "test",
		input: null,
	});
	return store.approvals.create({
		runId: run.id,
		sessionId: "s",
		agentKey: "host",
		tool,
		toolCallId: "c1",
		args: { amount: 1200 },
	});
}
async function pairLucia() {
	const code = await channel.createPairingCode();
	await bot.handleUpdate(text(lucia, `/start ${code}`));
	return code;
}

describe("Telegram", () => {
	it("turns a customer's message into the company's memory and a reply job", async () => {
		await bot.handleUpdate(text(rossi, "Are you open on Sunday?"));
		const p = await store.people.findByIdentity("telegram", "100");
		expect(p?.displayName).toBe("Rossi");
		expect((await store.memory.search("sunday")).map((m) => m.content)).toEqual(
			["Rossi: Are you open on Sunday?"],
		);
		expect(await store.jobs.list({ kind: "agent.reply" })).toHaveLength(1);
	});

	it("ignores group chats", async () => {
		await bot.handleUpdate(text(rossi, "hi all", { id: -5, type: "group" }));
		expect(await store.people.list()).toEqual([]);
	});

	it("pairs the owner with a one-time code", async () => {
		const code = await pairLucia();
		expect(await channel.owner()).toMatchObject({
			userId: "200",
			chatId: "200",
			name: "Lucia",
		});
		expect(sent().at(-1)?.text).toMatch(/You're now the owner/);

		// Used once: the same code again is told it didn't work, and it isn't
		// handed to the agents as a message.
		await bot.handleUpdate(text(lucia, `/start ${code}`));
		expect(sent().at(-1)?.text).toMatch(/code didn't work/);
		expect(await store.jobs.list({ kind: "agent.reply" })).toHaveLength(0);
	});

	it("doesn't pair anyone with a wrong code", async () => {
		await channel.createPairingCode();
		await bot.handleUpdate(text(rossi, "/start WRONGCODE"));
		expect(await channel.owner()).toBeNull();
		// It says the code didn't work, and it isn't a message for the agents.
		const said = calls
			.filter((c) => c.method === "sendMessage")
			.map((c) => String(c.payload.text));
		expect(said.join("\n")).toMatch(/code didn't work .* expired/);
		expect(await store.conversations.list()).toEqual([]);
	});

	it("sends queued replies and remembers them", async () => {
		await bot.handleUpdate(text(rossi, "Open Sunday?"));
		const [convo] = await store.conversations.list();
		await store.conversations.enqueue({
			conversationId: convo?.id as string,
			text: "Yes, 9 to 1.",
			agentKey: "host",
		});

		expect(await channel.sendPending()).toBe(1);
		expect(sent()).toEqual([{ chat_id: "100", text: "Yes, 9 to 1." }]);
		expect((await store.memory.search("9 to 1")).map((m) => m.content)).toEqual(
			["host → Rossi: Yes, 9 to 1."],
		);
		expect(await channel.sendPending()).toBe(0);
	});

	it("gives up on a person who blocked the bot, and waits out rate limits", async () => {
		await bot.handleUpdate(text(rossi, "hi"));
		const [convo] = await store.conversations.list();
		const out = await store.conversations.enqueue({
			conversationId: convo?.id as string,
			text: "hello",
		});

		refuse.set("100", {
			error_code: 429,
			description: "Too Many Requests: retry after 5",
		});
		expect(await channel.sendPending()).toBe(0);
		expect((await store.conversations.getMessage(out.id))?.status).toBe(
			"pending",
		);

		refuse.set("100", {
			error_code: 403,
			description: "Forbidden: bot was blocked by the user",
		});
		await channel.sendPending();
		expect(await store.conversations.getMessage(out.id)).toMatchObject({
			status: "failed",
			error: expect.stringContaining("blocked"),
		});
	});

	it("asks the owner to approve, with buttons only they can press", async () => {
		await pairLucia();
		const approval = await pendingApproval();
		await channel.askOwnerToApprove([approval.id]);
		const ask = sent().at(-1);
		expect(ask?.chat_id).toBe("200");
		expect(String(ask?.text)).toContain("host wants to use payment_send");
		expect(JSON.stringify(ask?.reply_markup)).toContain(
			`approve:${approval.id}`,
		);

		await bot.handleUpdate(press(rossi, `approve:${approval.id}`));
		expect(decisions).toEqual([]);

		await bot.handleUpdate(press(lucia, `approve:${approval.id}`));
		expect(decisions).toEqual([[approval.id, true, "Lucia"]]);
		expect(sent().at(-1)?.text).toBe("✅ Approved: payment_send");

		await bot.handleUpdate(press(lucia, `decline:${approval.id}`));
		expect(decisions).toHaveLength(1);
		const answers = calls
			.filter((c) => c.method === "answerCallbackQuery")
			.map((c) => c.payload.text);
		expect(answers).toEqual([
			"Only the company's owner can decide this.",
			"Approved",
			"Already approved.",
		]);
	});

	it("records approvals it couldn't route when no owner is paired", async () => {
		const approval = await pendingApproval();
		await channel.askOwnerToApprove([approval.id]);
		expect(sent()).toEqual([]);
		expect((await store.events.listUndelivered()).map((e) => e.type)).toContain(
			"approval.unrouted",
		);
	});

	it("delivers heartbeat alerts to the owner, with one-tap fixes only they can use", async () => {
		expect(await channel.toOwner({ text: "Nobody owns Head chef" })).toBe(
			false,
		);
		await pairLucia();
		expect(
			await channel.toOwner({
				text: "Nobody owns Head chef",
				actions: [{ label: "I'll take it", action: "assign:r-chef:founder" }],
			}),
		).toBe(true);
		expect(JSON.stringify(sent().at(-1)?.reply_markup)).toContain(
			"assign:r-chef:founder",
		);

		await bot.handleUpdate(press(rossi, "assign:r-chef:founder"));
		await bot.handleUpdate(press(lucia, "assign:r-chef:founder"));
		expect(acts).toEqual([["assign:r-chef:founder", "Lucia"]]);
		expect(sent().at(-1)?.text).toBe("did assign:r-chef:founder");
	});

	it("keeps track of when the owner was last seen", async () => {
		await pairLucia();
		await store.settings.delete(OWNER_LAST_SEEN);
		await bot.handleUpdate(text(rossi, "hi"));
		expect(await store.settings.get(OWNER_LAST_SEEN)).toBeNull();
		await bot.handleUpdate(text(lucia, "how are we doing?"));
		expect(await store.settings.get(OWNER_LAST_SEEN)).not.toBeNull();
	});

	it("lets the successor decide only while the owner is away", async () => {
		await pairLucia();
		const marco = { id: 300, first_name: "Marco" };
		await bot.handleUpdate(
			text(marco, `/start ${await channel.createPairingCode("successor")}`),
		);
		expect(await channel.successor()).toMatchObject({ name: "Marco" });
		expect(sent().at(-1)?.text).toMatch(/named successor/);

		const approval = await pendingApproval();
		await bot.handleUpdate(press(marco, `approve:${approval.id}`));
		expect(decisions).toEqual([]);

		await store.settings.set(SUCCESSION, { since: new Date().toISOString() });
		await channel.askOwnerToApprove([approval.id]);
		expect(
			sent()
				.filter((m) => String(m.text).includes("wants to use"))
				.map((m) => m.chat_id),
		).toEqual(["200", "300"]);
		await bot.handleUpdate(press(marco, `approve:${approval.id}`));
		expect(decisions).toEqual([[approval.id, true, "Marco"]]);
	});
});

describe("connecting to Telegram", () => {
	const failingBot = (
		answer: () => { error_code: number; description: string },
	) => {
		const b = new Bot("123:TEST", {
			botInfo: {
				id: 42,
				is_bot: true,
				first_name: "Café",
				username: "cafe_bot",
			} as unknown as UserFromGetMe,
		});
		b.api.config.use(async () => ({ ok: false, ...answer() }) as never);
		return b;
	};

	it("says plainly when Telegram refuses the token", async () => {
		const c = createTelegramChannel(
			failingBot(() => ({ error_code: 401, description: "Unauthorized" })),
			{ store, decide: async () => {}, log: () => {} },
		);
		await expect(c.start()).rejects.toThrow("refused the bot token");
	});

	it("logs why it can't connect instead of waiting in silence", async () => {
		const logs: string[] = [];
		const c = createTelegramChannel(
			failingBot(() => ({ error_code: 502, description: "Bad Gateway" })),
			{ store, decide: async () => {}, log: (m) => logs.push(m) },
		);
		const starting = c.start();
		await new Promise((r) => setTimeout(r, 50));
		expect(logs[0]).toMatch(
			/can't reach Telegram yet .*Bad Gateway.*trying again in 2s/,
		);
		await c.stop();
		await starting; // stopping ends the retries
	});
});
