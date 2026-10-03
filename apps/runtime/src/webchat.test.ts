import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	fakeModel,
	fauxAssistantMessage,
	fauxText,
} from "@jamot/brain/testing";
import { parseCompanyFile } from "@jamot/company-file";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, PASSWORD_SETTING } from "./auth.js";
import { webchat } from "./cli/commands.js";
import { createRuntime, type Runtime } from "./runtime.js";
import { WEBCHAT_SETTING } from "./webchat.js";

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

let runtime: Runtime;
let base: string;
let dataDir: string;
beforeEach(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "jamot-webchat-"));
	runtime = await createRuntime({
		dataDir,
		telegram: false,
		model: async () =>
			fakeModel(() =>
				fauxAssistantMessage([fauxText("Yes, we have gluten-free pasta.")]),
			),
		log: () => {},
	});
	await runtime.importCompany(restaurant(), { refId: "owner", name: "Lucia" });
	base = await runtime.listen(0);
});
afterEach(async () => {
	await runtime.stop();
	rmSync(dataDir, { recursive: true, force: true });
});

const turnOn = (dailyCapUsd = 2) =>
	runtime.store.settings.set(WEBCHAT_SETTING, { enabled: true, dailyCapUsd });

/** A browser: keeps the visitor cookie it was given. */
function browser() {
	let cookie = "";
	const call = async (path: string, init: RequestInit = {}) => {
		const res = await fetch(`${base}${path}`, {
			...init,
			headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) },
		});
		const set = res.headers.get("set-cookie");
		if (set) cookie = set.split(";")[0] ?? "";
		return res;
	};
	return {
		call,
		cookie: () => cookie,
		say: async (text: string, name = "Mrs. Rossi") => {
			if (!cookie) await call("/chat"); // a browser opens the page first
			return call("/chat/messages", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text, name }),
			});
		},
		history: async () =>
			(
				(await (await call("/chat/history")).json()) as {
					messages: { from: string; text: string }[];
				}
			).messages,
	};
}

describe("web chat", () => {
	it("isn't there until the owner turns it on", async () => {
		const visitor = browser();
		expect((await visitor.call("/chat")).status).toBe(404);
		expect((await visitor.say("hello")).status).toBe(404);
		expect((await visitor.call("/chat/events")).status).toBe(404);
	});

	it("a visitor writes, an agent answers, and both are in the person's memory", async () => {
		await turnOn();
		const visitor = browser();
		const page = await visitor.call("/chat");
		expect(page.status).toBe(200);
		expect(page.headers.get("content-security-policy")).toContain(
			"default-src 'none'",
		);
		expect(await page.text()).toContain("A neighbourhood restaurant");

		expect((await visitor.say("Do you have gluten-free pasta?")).status).toBe(
			202,
		);
		await runtime.tick();
		await runtime.tick();

		expect(await visitor.history()).toEqual([
			{
				from: "you",
				text: "Do you have gluten-free pasta?",
				at: expect.any(String),
			},
			{
				from: "company",
				text: "Yes, we have gluten-free pasta.",
				at: expect.any(String),
			},
		]);
		const person = await runtime.store.people.list({ search: "Rossi" });
		expect(person).toHaveLength(1);
		const memories = await runtime.store.memory.list({
			ownerId: person[0]?.id ?? null,
		});
		expect(memories.map((m) => m.data?.direction).sort()).toEqual([
			"in",
			"out",
		]);
		expect(memories.every((m) => m.data?.channel === "web")).toBe(true);
	});

	it("streams the reply to the open page", async () => {
		await turnOn();
		const visitor = browser();
		await visitor.call("/chat");
		const controller = new AbortController();
		const events = await visitor.call("/chat/events", {
			signal: controller.signal,
		});
		expect(events.headers.get("content-type")).toContain("text/event-stream");
		const reader = (events.body as ReadableStream<Uint8Array>).getReader();
		await visitor.say("Are you open on Sunday?");
		await runtime.tick();
		await runtime.tick();
		let received = "";
		while (!received.includes("event: message")) {
			const { value, done } = await reader.read();
			if (done) break;
			received += new TextDecoder().decode(value);
		}
		controller.abort();
		expect(received).toContain("Yes, we have gluten-free pasta.");
	});

	it("keeps to its limits: size, JSON only, and six messages a minute", async () => {
		await turnOn();
		const visitor = browser();
		expect((await visitor.say("x".repeat(2_001))).status).toBe(413);
		expect((await visitor.say("   ")).status).toBe(400);
		const form = await visitor.call("/chat/messages", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: "text=hi",
		});
		expect(form.status).toBe(415);
		const statuses: number[] = [];
		for (let i = 0; i < 7; i++)
			statuses.push((await visitor.say(`hi ${i}`)).status);
		expect(statuses).toEqual([202, 202, 202, 202, 202, 202, 429]);
		// Another visitor isn't slowed down by the first.
		expect((await browser().say("hello")).status).toBe(202);
	});

	it("pauses for the day when web replies have cost the cap, and says so once", async () => {
		await turnOn(0.5);
		const visitor = browser();
		expect((await visitor.say("first")).status).toBe(202);
		// Web replies have cost 50 cents today; Telegram's spending doesn't count.
		const spend = async (sessionId: string, costMicroUsd: number) => {
			const run = await runtime.store.runs.start({
				sessionId,
				agentKey: "host",
				model: null,
				trigger: "test",
				input: null,
			});
			await runtime.store.runs.addUsage(run.id, {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				costMicroUsd,
			});
		};
		await spend("telegram:100:host", 5_000_000);
		expect((await visitor.say("second")).status).toBe(202);
		await spend("web:someone:host", 500_000);
		const paused = await visitor.say("third");
		expect(paused.status).toBe(503);
		expect(((await paused.json()) as { error: string }).error).toContain(
			"tomorrow",
		);
		expect(await runtime.store.settings.get("webchat.pausedOn")).toBe(
			new Date().toISOString().slice(0, 10),
		);
	});

	it("never opens the console or MCP to a visitor", async () => {
		await turnOn();
		const visitor = browser();
		await visitor.call("/chat");
		expect(visitor.cookie()).toMatch(/^jamot_visitor=/);
		for (const path of ["/api/overview", "/api/people", "/api/map"])
			expect((await visitor.call(path)).status).toBe(401);
		const mcp = await visitor.call("/mcp", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		expect(mcp.status).toBe(401);
		// A forged visitor cookie is a new visitor, not the old one.
		const forged = await fetch(`${base}/chat`, {
			headers: { cookie: `${visitor.cookie().split(".")[0]}.forged` },
		});
		expect(forged.headers.get("set-cookie")).toMatch(/^jamot_visitor=/);
	});

	it("forgets a visitor who asks: messages, memories, transcripts and the person", async () => {
		await turnOn();
		const visitor = browser();
		await visitor.say("I'm allergic to walnuts");
		await runtime.tick();
		await runtime.tick();
		const [person] = await runtime.store.people.list({ search: "Rossi" });
		expect(person).toBeDefined();
		const [conversation] = await runtime.store.conversations.list({
			personId: person?.id as string,
		});
		const [run] = await runtime.store.runs.list();
		const session = run?.sessionId as string;
		expect(session).toMatch(/^web:/);
		expect(await runtime.store.transcripts.load(session)).not.toEqual([]);

		expect(run?.input).toContain("walnuts");
		const forgot = await visitor.call("/chat/forget", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		expect(forgot.status).toBe(200);
		expect(await runtime.store.people.get(person?.id as string)).toBeNull();
		expect(await runtime.store.memory.search("walnuts")).toHaveLength(0);
		expect(
			await runtime.store.conversations.get(conversation?.id as string),
		).toBeNull();
		expect(await runtime.store.transcripts.load(session)).toEqual([]);
		// The run's cost stays; its words don't.
		const after = await runtime.store.runs.get(run?.id as string);
		expect(after).toMatchObject({ input: null, output: null });
		expect(after?.costMicroUsd).toBe(run?.costMicroUsd);
		// The cookie is gone too: the next visit is someone new.
		expect(forgot.headers.get("set-cookie")).toContain("Max-Age=0");
	});

	it("only the owner turns it on: from the console, or with jamot webchat", async () => {
		const put = (body: unknown, cookie = "") =>
			fetch(`${base}/api/webchat`, {
				method: "PUT",
				headers: {
					"content-type": "application/json",
					...(cookie ? { cookie } : {}),
				},
				body: JSON.stringify(body),
			});
		expect((await put({ enabled: true })).status).toBe(401);

		await runtime.store.settings.set(
			PASSWORD_SETTING,
			await hashPassword("a long enough password"),
		);
		const login = await fetch(`${base}/api/login`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ password: "a long enough password" }),
		});
		const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
		expect((await put({ dailyCapUsd: -1 }, cookie)).status).toBe(400);
		const on = await put({ enabled: true, dailyCapUsd: 5 }, cookie);
		expect(await on.json()).toEqual({ enabled: true, dailyCapUsd: 5 });
		expect((await browser().call("/chat")).status).toBe(200);

		// The CLI changes the same setting, and the next request sees it.
		expect(await webchat(dataDir, "off")).toMatchObject({ enabled: false });
		expect((await browser().call("/chat")).status).toBe(404);
		await expect(webchat(dataDir, "on", "abc")).rejects.toThrow("daily cap");
	});

	it("won't take a message from a visitor the page never met, nor endless new ones", async () => {
		await turnOn();
		const noCookie = await fetch(`${base}/chat/messages`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "hello" }),
		});
		expect(noCookie.status).toBe(403);
		expect((await fetch(`${base}/chat/events`)).status).toBe(403);
		// Dropping the cookie to start over works ten times a minute, not more.
		const statuses: number[] = [];
		for (let i = 0; i < 11; i++)
			statuses.push((await fetch(`${base}/chat`)).status);
		expect(statuses.filter((s) => s === 200)).toHaveLength(10);
		expect(statuses.at(-1)).toBe(429);
	});
});
