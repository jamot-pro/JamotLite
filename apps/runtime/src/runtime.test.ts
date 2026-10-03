import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrainTool } from "@jamot/brain";
import {
	fakeModel,
	fauxAssistantMessage,
	fauxText,
	fauxToolCall,
} from "@jamot/brain/testing";
import { parseCompanyFile } from "@jamot/company-file";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntime, type Runtime } from "./runtime.js";

const restaurant = () => {
	const parsed = parseCompanyFile(
		readFileSync(
			fileURLToPath(
				new URL("../../../templates/restaurant.yaml", import.meta.url),
			),
			"utf8",
		),
	);
	if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
	return parsed.file;
};

type Call = { method: string; payload: Record<string, unknown> };
function fakeTelegram() {
	const calls: Call[] = [];
	let nextId = 900;
	const bot = new Bot("123:TEST", {
		botInfo: {
			id: 42,
			is_bot: true,
			first_name: "Trattoria",
			username: "trattoria_bot",
		} as unknown as UserFromGetMe,
	});
	bot.api.config.use(async (_prev, method, payload) => {
		const p = (payload ?? {}) as Record<string, unknown>;
		calls.push({ method, payload: p });
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
	return {
		bot,
		calls,
		sentTo: (chat: string) =>
			calls
				.filter(
					(c) =>
						c.method === "sendMessage" && String(c.payload.chat_id) === chat,
				)
				.map((c) => String(c.payload.text)),
	};
}

let updateId = 1;
const say = (from: { id: number; first_name: string }, text: string): Update =>
	({
		update_id: updateId++,
		message: {
			message_id: updateId,
			date: 1_790_000_000,
			chat: { id: from.id, type: "private" },
			from: { id: from.id, is_bot: false, first_name: from.first_name },
			text,
			...(text.startsWith("/")
				? {
						entities: [
							{
								type: "bot_command",
								offset: 0,
								length: text.split(" ")[0]?.length ?? 0,
							},
						],
					}
				: {}),
		},
	}) as unknown as Update;
const press = (
	from: { id: number; first_name: string },
	data: string,
): Update =>
	({
		update_id: updateId++,
		callback_query: {
			id: `cb${updateId}`,
			from: { id: from.id, is_bot: false, first_name: from.first_name },
			chat_instance: "x",
			data,
			message: {
				message_id: 1,
				date: 0,
				chat: { id: from.id, type: "private" },
				text: "?",
			},
		},
	}) as unknown as Update;

type Msg = { role: string; content?: unknown };
const textOf = (m: Msg | undefined) =>
	typeof m?.content === "string"
		? m.content
		: ((m?.content as { text?: string }[]) ?? [])
				.map((c) => c.text ?? "")
				.join("");

// A model that behaves like a sensible host.
const host = fakeModel((ctx) => {
	const last = ctx.messages.at(-1) as Msg;
	const said = textOf(last);
	if (last.role === "toolResult") {
		return fauxAssistantMessage([
			fauxText(
				said.includes("Waiting")
					? "I've asked the manager to approve your refund."
					: `Refund sent: ${said}`,
			),
		]);
	}
	if (/approved refund/.test(said))
		return fauxAssistantMessage([
			fauxText("Good news — your €20 refund is on its way."),
		]);
	if (/refund/i.test(said))
		return fauxAssistantMessage([fauxToolCall("refund", { amount: 20 })], {
			stopReason: "toolUse",
		});
	return fauxAssistantMessage([
		fauxText("Of course — a table for 2 at 8pm is booked."),
	]);
});

const dirs: string[] = [];
const runtimes: Runtime[] = [];
afterEach(async () => {
	for (const r of runtimes.splice(0)) await r.stop().catch(() => undefined);
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("a company running on Jamot Lite", () => {
	it("answers customers, asks the owner before money moves, and remembers everything across a restart", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "jamot-runtime-"));
		dirs.push(dataDir);
		const refunds: unknown[] = [];
		const refund: BrainTool = {
			name: "refund",
			description: "Refund a customer",
			parameters: {
				type: "object",
				properties: { amount: { type: "number" } },
				required: ["amount"],
			},
			policy: "approve",
			execute: async (args) => {
				refunds.push(args);
				return { text: `€${args.amount} refunded` };
			},
		};
		const telegram = fakeTelegram();
		const runtime = await createRuntime({
			dataDir,
			bot: telegram.bot,
			model: async () => host,
			extraTools: () => [refund],
			log: () => {},
		});
		runtimes.push(runtime);
		await runtime.importCompany(restaurant());

		// The owner pairs their Telegram account.
		const lucia = { id: 200, first_name: "Lucia" };
		await telegram.bot.handleUpdate(
			say(lucia, `/start ${await runtime.telegram.createPairingCode()}`),
		);

		// A customer books a table.
		const rossi = { id: 100, first_name: "Rossi" };
		await telegram.bot.handleUpdate(say(rossi, "Table for 2 at 8pm?"));
		await runtime.tick();
		expect(telegram.sentTo("100")).toEqual([
			"Of course — a table for 2 at 8pm is booked.",
		]);

		// A refund needs the owner: the customer is told, the owner is asked.
		await telegram.bot.handleUpdate(
			say(rossi, "The soup was cold, I'd like a refund"),
		);
		await runtime.tick();
		expect(telegram.sentTo("100").at(-1)).toBe(
			"I've asked the manager to approve your refund.",
		);
		expect(refunds).toEqual([]);
		const ask = telegram.calls.find(
			(c) =>
				c.method === "sendMessage" &&
				c.payload.chat_id === "200" &&
				String(c.payload.text).includes("wants to use refund"),
		);
		const approvalId = /approve:([\w-]+)/.exec(
			JSON.stringify(ask?.payload.reply_markup),
		)?.[1] as string;
		expect(approvalId).toBeTruthy();

		// The owner approves from Telegram; the agent follows up with the customer.
		await telegram.bot.handleUpdate(press(lucia, `approve:${approvalId}`));
		await runtime.tick();
		expect(refunds).toEqual([{ amount: 20 }]);
		expect(telegram.sentTo("100").at(-1)).toBe(
			"Good news — your €20 refund is on its way.",
		);

		// Every run was recorded with its model and usage.
		const runs = await runtime.store.runs.list();
		expect(runs.map((r) => r.status).sort()).toEqual([
			"awaiting_approval",
			"done",
			"done",
		]);

		// Restart: same folder, everything is still there.
		await runtime.stop();
		runtimes.pop();
		const again = await createRuntime({
			dataDir,
			bot: fakeTelegram().bot,
			model: async () => host,
			log: () => {},
		});
		runtimes.push(again);
		const customer = await again.store.people.findByIdentity("telegram", "100");
		const memories = await again.store.memory.list({
			scope: "person",
			ownerId: customer?.id as string,
			limit: 20,
		});
		expect(memories.map((m) => m.content)).toContain(
			"host → Rossi: Good news — your €20 refund is on its way.",
		);
		expect(await again.telegram.owner()).toMatchObject({ name: "Lucia" });
	});

	it("says what's missing when it can't start", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "jamot-runtime-"));
		dirs.push(dataDir);
		await expect(createRuntime({ dataDir, log: () => {} })).rejects.toThrow(
			/no Telegram bot token is stored yet/,
		);
	});

	it("runs without Telegram when asked, with no bot token at all", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "jamot-runtime-"));
		dirs.push(dataDir);
		const runtime = await createRuntime({
			dataDir,
			telegram: false,
			port: 0,
			log: () => {},
		});
		try {
			await runtime.start({ telegram: false });
			expect(await runtime.mcpToken()).toBeTruthy();
		} finally {
			await runtime.stop();
		}
	});

	it("notices a responsibility nobody owns, and the owner fixes it in one tap", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "jamot-runtime-"));
		dirs.push(dataDir);
		const telegram = fakeTelegram();
		const runtime = await createRuntime({
			dataDir,
			bot: telegram.bot,
			model: async () => host,
			log: () => {},
		});
		runtimes.push(runtime);
		await runtime.importCompany(restaurant(), {
			refId: "owner",
			name: "Lucia",
		});
		const lucia = { id: 200, first_name: "Lucia" };
		await telegram.bot.handleUpdate(
			say(lucia, `/start ${await runtime.telegram.createPairingCode()}`),
		);

		// The restaurant's pre-service briefing runs at 11:00 in the company's time zone (UTC).
		await runtime.tick(new Date("2030-01-01T11:00:30Z"));
		const alert = telegram.calls.find(
			(c) =>
				c.method === "sendMessage" && String(c.payload.text).startsWith("💓"),
		);
		expect(String(alert?.payload.text)).toContain("Nobody owns “Head chef”");
		expect(JSON.stringify(alert?.payload.reply_markup)).toContain(
			"assign:r-chef:founder",
		);

		await telegram.bot.handleUpdate(press(lucia, "assign:r-chef:founder"));
		expect(telegram.sentTo("200").at(-1)).toBe(
			"Done — Lucia now owns “Head chef”.",
		);

		await runtime.tick(new Date("2030-01-01T17:00:30Z"));
		expect(telegram.sentTo("200").at(-1)).toContain(
			"✅ Nobody owns “Head chef”",
		);
	});

	it("lets the owner's own AI connect over MCP with the company's token", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "jamot-runtime-"));
		dirs.push(dataDir);
		const runtime = await createRuntime({
			dataDir,
			bot: fakeTelegram().bot,
			model: async () => host,
			log: () => {},
		});
		runtimes.push(runtime);
		await runtime.importCompany(restaurant());
		const address = await runtime.listen(0);

		expect(await (await fetch(`${address}/health`)).json()).toMatchObject({
			ok: true,
			company: "A neighbourhood restaurant",
		});

		const token = await runtime.mcpToken();
		expect(token).toHaveLength(43);
		const ai = new Client({ name: "claude", version: "1" });
		await ai.connect(
			new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
				requestInit: { headers: { authorization: `Bearer ${token}` } },
			}),
		);
		const result = await ai.callTool({ name: "whats_missing", arguments: {} });
		expect(JSON.stringify(result.content)).toContain("Head chef");
		await ai.close();

		const refused = await fetch(`${address}/mcp`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		expect(refused.status).toBe(401);
	});
});
