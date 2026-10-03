import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEMO_NOTE, demoReply } from "@jamot/brain";
import { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareDemo } from "./cli/commands.js";
import { createRuntime, type Runtime } from "./runtime.js";

let root: string;
let runtime: Runtime | null = null;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "jamot-demo-test-"));
});
afterEach(async () => {
	await runtime?.stop();
	runtime = null;
	rmSync(root, { recursive: true, force: true });
});

describe("jamot demo", () => {
	it("a throwaway company answers in the browser, with no keys, and says it's a demo", async () => {
		const demo = await prepareDemo("bali-cafe", { root });
		expect(demo.companyName).toBe("A community café in Bali");
		runtime = await createRuntime({
			dataDir: demo.dir,
			telegram: false,
			log: () => {},
		});
		const base = await runtime.listen(0);

		const page = await fetch(`${base}/chat`);
		expect(page.status).toBe(200);
		const cookie = (page.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
		const sent = await fetch(`${base}/chat/messages`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ text: "Who are you?" }),
		});
		expect(sent.status).toBe(202);
		await runtime.tick();
		await runtime.tick();
		const { messages } = (await (
			await fetch(`${base}/chat/history`, { headers: { cookie } })
		).json()) as { messages: { from: string; text: string }[] };
		const reply = messages.find((m) => m.from === "company");
		expect(reply?.text).toContain("A community café in Bali");
		expect(reply?.text).toContain(DEMO_NOTE);
		// It cost nothing.
		expect((await runtime.store.runs.totals()).costMicroUsd).toBe(0);
		// The console says it's a demo, and its password works.
		const me = (await (await fetch(`${base}/api/me`)).json()) as {
			demo: boolean;
		};
		expect(me.demo).toBe(true);
		const login = await fetch(`${base}/api/login`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ password: demo.password }),
		});
		expect(login.status).toBe(200);
	});

	it("never runs where real people are: refused with Telegram on", async () => {
		const demo = await prepareDemo("restaurant", { root });
		const bot = new Bot("123:TEST", {
			botInfo: {
				id: 1,
				is_bot: true,
				first_name: "B",
				username: "b",
			} as unknown as UserFromGetMe,
		});
		bot.api.config.use(async () => ({ ok: true, result: true }) as never);
		runtime = await createRuntime({ dataDir: demo.dir, bot, log: () => {} });
		await expect(runtime.ask("hello")).rejects.toThrow(
			/demo model only runs a demo company/,
		);
	});

	it("refuses a template that doesn't exist", async () => {
		await expect(prepareDemo("bakery", { root })).rejects.toThrow(
			/no template "bakery"/,
		);
	});

	it("answers by what was asked, and always labels itself", () => {
		const company = {
			name: "Trattoria",
			summary: "A neighbourhood restaurant.",
			vision: "Everyone eats well.",
		};
		expect(demoReply(company, "Are you open tonight?")).toMatch(/calendar/);
		expect(demoReply(company, "How much is a table?")).toMatch(/right person/);
		for (const q of ["hello", "Who are you?", ""])
			expect(demoReply(company, q).endsWith(DEMO_NOTE)).toBe(true);
	});
});
