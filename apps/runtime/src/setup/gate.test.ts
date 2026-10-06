import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelAccess } from "@jamot/brain";
import {
	fakeModel,
	fauxAssistantMessage,
	fauxText,
} from "@jamot/brain/testing";
import { DreamConfig } from "@jamot/contracts";
import { openCompanyStore } from "@jamot/sqlite";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSetupGate, type Gate, wantsSetupGate } from "./gate.js";

type Call = { method: string; payload: Record<string, unknown> };
let home: string;
let calls: Call[];
let bot: Bot;
let gate: Gate;
let logs: string[];
const env = {
	JAMOT_PASSWORD: "a long enough password",
	JAMOT_TELEGRAM_TOKEN: `123456:${"A".repeat(35)}`,
	JAMOT_MODEL: "anthropic",
	JAMOT_MODEL_KEY: "test-key",
};

function fakeBot(): Bot {
	const b = new Bot(env.JAMOT_TELEGRAM_TOKEN, {
		botInfo: {
			id: 42,
			is_bot: true,
			first_name: "Setup",
			username: "new_company_bot",
		} as unknown as UserFromGetMe,
	});
	b.api.config.use(async (_prev, method, payload) => {
		calls.push({ method, payload: (payload ?? {}) as Record<string, unknown> });
		const result =
			method === "sendMessage"
				? { message_id: 1, date: 0, chat: { id: 1, type: "private" } }
				: true;
		return { ok: true, result } as never;
	});
	return b;
}
async function open(model: ModelAccess | null = null): Promise<Gate> {
	logs = [];
	bot = fakeBot();
	return createSetupGate({ home, env, bot, model, log: (m) => logs.push(m) });
}

beforeEach(async () => {
	home = mkdtempSync(join(tmpdir(), "jamot-gate-"));
	calls = [];
	gate = await open();
});
afterEach(async () => {
	await gate.stop();
	rmSync(home, { recursive: true, force: true });
});

let updateId = 1;
const person = (id: number, first_name: string) => ({
	id,
	is_bot: false,
	first_name,
});
const text = (from: { id: number; first_name: string }, body: string): Update =>
	({
		update_id: updateId++,
		message: {
			message_id: updateId,
			date: 1_790_000_000,
			chat: { id: from.id, type: "private" },
			from: person(from.id, from.first_name),
			text: body,
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
			from: person(from.id, from.first_name),
			chat_instance: "x",
			data,
			message: {
				message_id: 9,
				date: 0,
				chat: { id: from.id, type: "private" },
				text: "?",
			},
		},
	}) as unknown as Update;
const said = () =>
	calls
		.filter((c) => c.method === "sendMessage")
		.map((c) => String(c.payload.text));
const andrea = { id: 100, first_name: "Andrea" };
const stranger = { id: 200, first_name: "Eve" };

async function signIn(): Promise<string> {
	const res = await gate.app.inject({
		method: "POST",
		url: "/api/login",
		payload: { password: env.JAMOT_PASSWORD },
	});
	expect(res.statusCode).toBe(200);
	return String(res.headers["set-cookie"]).split(";")[0] as string;
}
const put = (cookie: string, id: string, value: string) =>
	gate.app.inject({
		method: "PUT",
		url: "/api/setup/answer",
		headers: { cookie },
		payload: { id, value },
	});

describe("the setup gate (D55)", () => {
	it("opens only when there's no template and a password", () => {
		expect(wantsSetupGate(env)).toBe(true);
		expect(wantsSetupGate({ ...env, JAMOT_TEMPLATE: "restaurant" })).toBe(
			false,
		);
		expect(wantsSetupGate({})).toBe(false);
	});

	it("shows only the setup: everything of the company is closed", async () => {
		expect((await gate.app.inject("/health")).json()).toMatchObject({
			setup: true,
		});
		expect((await gate.app.inject("/api/me")).json()).toMatchObject({
			signedIn: false,
			setup: true,
		});
		for (const url of ["/api/overview", "/api/stewards", "/mcp", "/chat"])
			expect((await gate.app.inject(url)).statusCode).toBe(503);
		expect((await gate.app.inject("/api/setup")).statusCode).toBe(401);
		expect(
			(
				await gate.app.inject({
					method: "POST",
					url: "/api/login",
					payload: { password: "wrong one, sorry" },
				})
			).statusCode,
		).toBe(401);
	});

	it("keeps the answers through a restart", async () => {
		const cookie = await signIn();
		expect((await put(cookie, "name", "  ")).json()).toEqual({
			error: "This one is needed to set the company up.",
		});
		expect((await put(cookie, "nope", "x")).statusCode).toBe(400);
		expect((await put(cookie, "name", "Sunrise Bakery")).statusCode).toBe(200);
		const state = (await put(cookie, "why", "")).json();
		expect(state).toMatchObject({
			answers: { name: "Sunrise Bakery" },
			skipped: ["why"],
			ready: false,
		});
		// Restarted (a redeploy): same answers, and the session still works.
		await gate.stop();
		gate = await open();
		const again = await gate.app.inject({
			url: "/api/setup",
			headers: { cookie },
		});
		expect(again.json()).toMatchObject({ answers: { name: "Sunrise Bakery" } });
		expect(again.json().telegram).toMatchObject({
			bot: "new_company_bot",
			owner: null,
		});
	});

	it("runs the interview on Telegram for the founder only, and starts the company", async () => {
		const cookie = await signIn();
		const code = (
			await gate.app.inject({ url: "/api/setup", headers: { cookie } })
		).json().telegram.code as string;
		expect(logs.join("\n")).toContain(`/start ${code}`);

		await bot.handleUpdate(text(stranger, "hello?"));
		expect(said().at(-1)).toBe("This company isn't open yet. Check back soon!");
		await bot.handleUpdate(text(stranger, "/start WRONGCODE"));
		expect(said().at(-1)).toMatch(/^That code didn't work/);

		await bot.handleUpdate(text(andrea, `/start ${code}`));
		expect(said().slice(-2)).toEqual([
			expect.stringMatching(
				/^Hi Andrea! Let's set up your company: 9 short questions/,
			),
			expect.stringMatching(/^1\/9 · What's it called\?/),
		]);
		// The founder's name came from Telegram: question 2 is skipped.
		await bot.handleUpdate(text(andrea, "Sunrise Bakery"));
		expect(said().at(-1)).toMatch(/^3\/9 · What are you building/);
		await bot.handleUpdate(text(andrea, "Fresh bread for the neighbourhood"));
		await bot.handleUpdate(text(andrea, "/skip"));
		await bot.handleUpdate(text(andrea, "/back"));
		expect(said().at(-1)).toMatch(/^4\/9 · Why does it matter/);
		await bot.handleUpdate(text(andrea, "Nobody eats factory bread"));
		await bot.handleUpdate(text(andrea, "100 regulars\nOpen by 8 pm"));
		await bot.handleUpdate(text(andrea, "- Never sell old bread as fresh"));
		// Answers made on the web show up in the same interview.
		await put(cookie, "people", "Rio bakes with me");
		for (const _ of ["delegate", "successor"])
			await bot.handleUpdate(text(andrea, "/skip"));
		expect(said().at(-1)).toMatch(/^Here's what you told me:/);
		const keyboard = JSON.stringify(calls.at(-1)?.payload.reply_markup);
		expect(keyboard).toContain("tpl:restaurant");

		// Someone else can't start it.
		await bot.handleUpdate(press(stranger, "tpl:restaurant"));
		expect(
			calls.find((c) => c.method === "answerCallbackQuery")?.payload,
		).toMatchObject({ text: "Only the founder can do this." });

		await bot.handleUpdate(press(andrea, "tpl:restaurant"));
		expect(said().at(-1)).toBe("Sunrise Bakery is set up. Starting it now…");
		const dir = await gate.done;
		expect(dir).toBe(join(home, "sunrise-bakery"));
		expect(existsSync(join(home, ".setup"))).toBe(false);

		const store = openCompanyStore(join(dir, "company.db"));
		try {
			expect((await store.graph.getCompany())?.name).toBe("Sunrise Bakery");
			const dream = (await store.graph.listNodes()).find(
				(n) => n.kind === "dream",
			);
			expect(DreamConfig.parse(dream?.config)).toMatchObject({
				objective: "Fresh bread for the neighbourhood",
				vision: "Nobody eats factory bread",
				outcomes: ["100 regulars", "Open by 8 pm"],
				constraints: ["Never sell old bread as fresh"],
			});
			// Andrea is the owner on Telegram already: no second pairing.
			expect(await store.settings.get("telegram.owner")).toMatchObject({
				userId: "100",
				name: "Andrea",
			});
			expect(await store.settings.get("setup.answers")).toMatchObject({
				answers: { people: "Rio bakes with me", founder: "Andrea" },
				skipped: ["delegate", "successor"],
			});
		} finally {
			store.close();
		}
	}, 30_000);

	it("finishes from the web too, and only when ready", async () => {
		const cookie = await signIn();
		const finish = (template: string) =>
			gate.app.inject({
				method: "POST",
				url: "/api/setup/finish",
				headers: { cookie },
				payload: { template },
			});
		expect((await finish("restaurant")).json()).toEqual({
			error: "Answer the questions marked as needed first.",
		});
		await put(cookie, "name", "Corner Shop");
		await put(cookie, "founder", "Andrea");
		await put(cookie, "what", "Groceries for the street");
		expect((await finish("not-a-template")).statusCode).toBe(400);
		expect((await finish("ecommerce-shop")).json()).toEqual({
			message: "Corner Shop is set up. Starting it now…",
		});
		expect(await gate.done).toBe(join(home, "corner-shop"));
		expect(
			readFileSync(join(home, "corner-shop", "secrets.key")).length,
		).toBeGreaterThan(0);
	}, 30_000);

	describe("drafting the company from the answers (D56)", () => {
		const plan = {
			template: "restaurant",
			summary: "Bread for the street",
			vision: "Nobody eats factory bread",
			mission: "Fresh bread for the street",
			values: ["Never sell old bread as fresh"],
			goals: ["100 regulars"],
			teams: [{ key: "bakery", name: "Bakery", purpose: "The bread" }],
			agents: [
				{
					key: "orders",
					name: "Order taker",
					role: "Takes orders",
					instructions: "Collect orders.",
					team: "bakery",
				},
			],
			people: [
				{ key: "rio", name: "Rio", role: "Night baker", team: "bakery" },
			],
			responsibilities: [
				{ key: "r-bread", name: "Bread", team: "bakery", owner: "rio" },
				{ key: "r-orders", name: "Orders", team: "bakery", owner: "orders" },
				{
					key: "r-delivery",
					name: "Deliveries",
					team: "bakery",
					owner: "open",
				},
			],
			successor: "Rio",
		};
		const model = (reply: string) =>
			fakeModel(() => fauxAssistantMessage([fauxText(reply)]));
		async function answered(cookie: string) {
			await put(cookie, "name", "Sunrise Bakery");
			await put(cookie, "founder", "Andrea");
			await put(cookie, "what", "Fresh bread for the street");
			await put(
				cookie,
				"people",
				"Rio bakes with me; I need a delivery person",
			);
		}
		const post = (cookie: string, url: string, payload: object = {}) =>
			gate.app.inject({ method: "POST", url, headers: { cookie }, payload });

		it("drafts on the web, drops the draft when an answer changes, and starts from it", async () => {
			await gate.stop();
			const m = model(`Here you go:\n${JSON.stringify(plan)}`);
			gate = await open(m);
			const cookie = await signIn();
			expect((await post(cookie, "/api/setup/draft")).json()).toEqual({
				error: "Answer the questions marked as needed first.",
			});
			await answered(cookie);
			const state = (await post(cookie, "/api/setup/draft")).json();
			expect(state.canDraft).toBe(true);
			expect(state.draft).toMatchObject({
				teams: [{ name: "Bakery" }],
				people: [{ name: "Rio" }],
				successor: "Rio",
			});
			// Drafted once: asking again without "again" reuses it.
			await post(cookie, "/api/setup/draft");
			expect(m.calls()).toBe(1);
			// A changed answer drops it.
			const changed = (await put(cookie, "why", "Bread matters")).json();
			expect(changed.draft).toBeNull();
			await post(cookie, "/api/setup/draft");
			expect((await post(cookie, "/api/setup/finish")).json()).toEqual({
				message: "Sunrise Bakery is set up. Starting it now…",
			});
			const dir = await gate.done;
			const store = openCompanyStore(join(dir, "company.db"));
			try {
				const nodes = await store.graph.listNodes();
				expect(
					nodes.filter((n) => n.kind === "agent").map((n) => n.name),
				).toEqual(["Order taker"]);
				expect(
					nodes
						.filter((n) => n.kind === "human")
						.map((n) => n.name)
						.sort(),
				).toEqual(["Andrea", "Rio"]);
				expect((await store.graph.getCompany())?.founderKey).toBe("founder");
				expect(await store.settings.get("setup.answers")).toMatchObject({
					draft: { successor: "Rio" },
				});
			} finally {
				store.close();
			}
		}, 30_000);

		it("falls back to a starting point when the model can't draft", async () => {
			await gate.stop();
			gate = await open(model("Sorry, I can't help with that."));
			const cookie = await signIn();
			await answered(cookie);
			expect((await post(cookie, "/api/setup/draft")).json().error).toMatch(
				/pick the closest starting point/,
			);
			expect((await post(cookie, "/api/setup/finish")).json()).toEqual({
				error: "Draft the company first, or pick the closest starting point.",
			});
			expect(
				(await post(cookie, "/api/setup/finish", { template: "restaurant" }))
					.statusCode,
			).toBe(200);
			await gate.done;
		}, 30_000);

		it("drafts on Telegram, and tells the founder what to do first", async () => {
			await gate.stop();
			gate = await open(model(JSON.stringify(plan)));
			const cookie = await signIn();
			const code = (
				await gate.app.inject({ url: "/api/setup", headers: { cookie } })
			).json().telegram.code;
			await bot.handleUpdate(text(andrea, `/start ${code}`));
			await bot.handleUpdate(text(andrea, "Sunrise Bakery"));
			await bot.handleUpdate(text(andrea, "Fresh bread for the street"));
			await bot.handleUpdate(text(andrea, "/skip"));
			await bot.handleUpdate(text(andrea, "/skip"));
			await bot.handleUpdate(text(andrea, "/skip"));
			await bot.handleUpdate(text(andrea, "Rio bakes with me"));
			await bot.handleUpdate(text(andrea, "/skip"));
			await bot.handleUpdate(text(andrea, "Rio"));
			expect(said().slice(-2)).toEqual([
				"That's everything. Drafting your company…",
				expect.stringMatching(
					/^Here's your company:[\s\S]*• Deliveries — open — invite someone[\s\S]*Takes over if you go quiet: Rio/,
				),
			]);
			expect(JSON.stringify(calls.at(-1)?.payload.reply_markup)).toContain(
				"setup:start",
			);
			await bot.handleUpdate(press(andrea, "setup:start"));
			await gate.done;
			expect(said().at(-1)).toMatch(
				/^Your company is running\. This week:\n1\. Invite someone for Deliveries/,
			);
		}, 30_000);
	});
});
