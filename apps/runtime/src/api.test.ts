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
import { receiveMessage } from "@jamot/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, PASSWORD_SETTING } from "./auth.js";
import { createRuntime, type Runtime } from "./runtime.js";

const templateText = readFileSync(
	fileURLToPath(new URL("../../../templates/restaurant.yaml", import.meta.url)),
	"utf8",
);
const restaurant = () => {
	const parsed = parseCompanyFile(templateText);
	if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
	return parsed.file;
};

let runtime: Runtime;
let base: string;
let dataDir: string;
beforeEach(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "jamot-api-"));
	const bot = new Bot("123:TEST", {
		botInfo: {
			id: 1,
			is_bot: true,
			first_name: "B",
			username: "b",
		} as unknown as UserFromGetMe,
	});
	bot.api.config.use(async () => ({ ok: true, result: true }) as never);
	runtime = await createRuntime({
		dataDir,
		bot,
		model: async () => fakeModel(() => fauxAssistantMessage([fauxText("ok")])),
		log: () => {},
	});
	await runtime.importCompany(restaurant(), { refId: "owner", name: "Lucia" });
	base = await runtime.listen(0);
});
afterEach(async () => {
	await runtime.stop();
	rmSync(dataDir, { recursive: true, force: true });
});

async function signIn(): Promise<string> {
	await runtime.store.settings.set(
		PASSWORD_SETTING,
		await hashPassword("a long enough password"),
	);
	const res = await fetch(`${base}/api/login`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ password: "a long enough password" }),
	});
	expect(res.status).toBe(200);
	const cookie = res.headers.get("set-cookie") ?? "";
	expect(cookie).toMatch(/HttpOnly; SameSite=Strict/);
	return cookie.split(";")[0] as string;
}
/** Response bodies in these tests are read loosely, like a browser would. */
// biome-ignore lint/suspicious/noExplicitAny: test-only JSON reading
const body = async (res: Response): Promise<any> => res.json();
const get = (path: string, cookie?: string) =>
	fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });
const send = (method: string, path: string, body: unknown, cookie: string) =>
	fetch(`${base}${path}`, {
		method,
		headers: { cookie, "content-type": "application/json" },
		body: JSON.stringify(body),
	});

describe("the console API", () => {
	it("keeps everything behind the owner's password", async () => {
		expect((await get("/api/overview")).status).toBe(401);
		const noPassword = await fetch(`${base}/api/login`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ password: "x" }),
		});
		expect(noPassword.status).toBe(409);

		const cookie = await signIn();
		expect((await get("/api/overview", cookie)).status).toBe(200);
		expect(
			(await get("/api/overview", "jamot_session=9999999999999.forged")).status,
		).toBe(401);
		expect(await body(await get("/api/me", cookie))).toEqual({
			signedIn: true,
			passwordSet: true,
			demo: false,
		});
	});

	it("slows down password guessing", async () => {
		await runtime.store.settings.set(
			PASSWORD_SETTING,
			await hashPassword("a long enough password"),
		);
		const statuses: number[] = [];
		for (let i = 0; i < 6; i++) {
			const res = await fetch(`${base}/api/login`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ password: "wrong" }),
			});
			statuses.push(res.status);
		}
		expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
	});

	it("shows how the company is doing, and lets the owner fill a gap", async () => {
		const cookie = await signIn();
		const overview = await body(await get("/api/overview", cookie));
		expect(overview.company.name).toBe("A neighbourhood restaurant");
		expect(
			overview.vitals.people.unowned.map((u: { name: string }) => u.name),
		).toEqual(["Head chef", "Floor manager"]);

		const assigned = await body(
			await send(
				"POST",
				"/api/responsibilities/r-chef/owner",
				{ ownerKey: "founder" },
				cookie,
			),
		);
		expect(assigned.message).toBe("Done — Lucia now owns “Head chef”.");
		const map = await body(await get("/api/map", cookie));
		expect(map.nodes.length).toBeGreaterThan(20);
	});

	it("stores the model key encrypted and never shows it again", async () => {
		const cookie = await signIn();
		const res = await send(
			"PUT",
			"/api/settings/model",
			{
				provider: "anthropic",
				modelId: "claude-sonnet-5",
				apiKey: "sk-ant-secret",
			},
			cookie,
		);
		expect(res.status).toBe(200);
		const settings = await (await get("/api/settings", cookie)).text();
		expect(settings).toContain("claude-sonnet-5");
		expect(settings).not.toContain("sk-ant-secret");
		expect(await runtime.secrets.get("model.apiKey")).toBe("sk-ant-secret");
		expect(
			(
				await send(
					"PUT",
					"/api/settings/model",
					{ provider: "skynet", modelId: "x" },
					cookie,
				)
			).status,
		).toBe(400);
	});

	it("gives the owner a pairing code, the MCP address, and the company file", async () => {
		const cookie = await signIn();
		const { code } = await body(
			await send("POST", "/api/pairing", { role: "owner" }, cookie),
		);
		expect(code).toMatch(/^[A-Z2-9]{8}$/);
		const mcp = await body(await get("/api/mcp", cookie));
		expect(mcp).toEqual({
			url: `${base}/mcp`,
			token: await runtime.mcpToken(),
		});

		const exported = await (await get("/api/company.yaml", cookie)).text();
		const parsed = parseCompanyFile(exported);
		expect(parsed.ok && parsed.file.company.id).toBe("restaurant");
	});

	it("notes memories and shows people with what the company knows", async () => {
		const cookie = await signIn();
		const person = await runtime.store.people.create({
			displayName: "Mrs. Rossi",
		});
		await send(
			"POST",
			"/api/memory",
			{ note: "Gluten-free", personId: person.id },
			cookie,
		);
		const profile = await body(await get(`/api/people/${person.id}`, cookie));
		expect(profile.memories.map((m: { content: string }) => m.content)).toEqual(
			["Gluten-free"],
		);
		expect((await get("/api/people/nobody", cookie)).status).toBe(404);
	});

	it("serves the console for page routes, and a 404 — not HTML — for missing files", async () => {
		const { mkdirSync, writeFileSync } = await import("node:fs");
		const web = join(dataDir, "web");
		mkdirSync(join(web, "assets"), { recursive: true });
		writeFileSync(
			join(web, "index.html"),
			"<!doctype html><title>Jamot</title>",
		);
		writeFileSync(join(web, "assets", "app.js"), "console.log(1)");
		const bot = new Bot("123:TEST", {
			botInfo: {
				id: 1,
				is_bot: true,
				first_name: "B",
				username: "b",
			} as unknown as UserFromGetMe,
		});
		const other = await createRuntime({
			dataDir: join(dataDir, "second"),
			bot,
			webRoot: web,
			log: () => {},
		});
		try {
			const address = await other.listen(0);
			expect(await (await fetch(`${address}/map`)).text()).toContain(
				"<title>Jamot</title>",
			);
			expect(
				(await fetch(`${address}/assets/app.js`)).headers.get("content-type"),
			).toMatch(/javascript/);
			const missing = await fetch(`${address}/assets/gone.js`);
			expect(missing.status).toBe(404);
			expect(missing.headers.get("content-type")).toMatch(/json/);
			// Built after start: served without a restart.
			writeFileSync(join(web, "assets", "later.js"), "console.log(2)");
			expect((await fetch(`${address}/assets/later.js`)).status).toBe(200);
		} finally {
			await other.stop();
		}
	});
});

describe("behind a TLS proxy", () => {
	let proxied: Runtime;
	let proxiedBase: string;
	beforeEach(async () => {
		proxied = await createRuntime({
			dataDir: mkdtempSync(join(tmpdir(), "jamot-proxy-")),
			telegram: false,
			behindProxy: true,
			model: async () =>
				fakeModel(() => fauxAssistantMessage([fauxText("ok")])),
			log: () => {},
		});
		await proxied.importCompany(restaurant(), {
			refId: "owner",
			name: "Lucia",
		});
		await proxied.store.settings.set(
			PASSWORD_SETTING,
			await hashPassword("a long enough password"),
		);
		proxiedBase = await proxied.listen(0);
	});
	afterEach(() => proxied.stop());

	const login = (password: string, client: string) =>
		fetch(`${proxiedBase}/api/login`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-forwarded-for": client,
			},
			body: JSON.stringify({ password }),
		});

	it("limits guessing per client, not for everyone behind the proxy", async () => {
		for (let i = 0; i < 6; i++) await login("wrong", "203.0.113.7");
		expect((await login("wrong", "203.0.113.7")).status).toBe(429);
		const owner = await login("a long enough password", "198.51.100.2");
		expect(owner.status).toBe(200);
		expect(owner.headers.get("set-cookie")).toContain("; Secure");
		expect(owner.headers.get("strict-transport-security")).toBe(
			"max-age=31536000",
		);
	});
});

describe("an outside agent in the company", () => {
	it("connects from the console, proposes, and acts only once the owner approves", async () => {
		const cookie = await signIn();
		const { personId } = await receiveMessage(runtime.store, {
			channel: "telegram",
			threadId: "100",
			messageId: "1",
			from: { userId: "100", displayName: "Mrs. Rossi" },
			text: "Do you have a table for four on Friday?",
		});

		const added = await body(
			await send(
				"POST",
				"/api/mcp/connections",
				{ nodeKey: "host", people: true },
				cookie,
			),
		);
		expect(added.connection).toMatchObject({
			nodeKey: "host",
			access: "people",
		});
		expect(added.connection.tokenHash).toBeUndefined();
		expect(added.token).toMatch(/^jmt_/);
		// Only the owner can connect someone.
		expect(
			(await send("POST", "/api/mcp/connections", { nodeKey: "host" }, ""))
				.status,
		).toBe(401);

		const ai = new Client({ name: "claude-code", version: "1" });
		await ai.connect(
			new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
				requestInit: { headers: { authorization: `Bearer ${added.token}` } },
			}),
		);
		await ai.callTool({
			name: "propose",
			arguments: {
				action: "message_person",
				personId,
				text: "Yes — a table for four on Friday at 8 is yours.",
			},
		});
		await runtime.tick();
		// The proposed message went nowhere: not sent, not even queued. (The
		// company's own agent has answered her message in the meantime.)
		const before = await runtime.store.conversations.list({ personId });
		expect(
			(
				await runtime.store.conversations.listMessages(before[0]?.id as string)
			).filter((m) => m.text.includes("Friday at 8")),
		).toEqual([]);

		const { pending } = await body(await get("/api/approvals", cookie));
		expect(pending).toHaveLength(1);
		expect(pending[0]).toMatchObject({
			agentKey: "host",
			tool: "propose.message_person",
		});
		expect(
			(
				await send(
					"POST",
					`/api/approvals/${pending[0].id}`,
					{ approved: true },
					cookie,
				)
			).status,
		).toBe(200);
		await runtime.tick();
		const [conversation] = await runtime.store.conversations.list({ personId });
		const messages = await runtime.store.conversations.listMessages(
			conversation?.id as string,
		);
		expect(messages.at(-1)).toMatchObject({
			direction: "out",
			status: "sent",
			agentKey: "host",
			text: "Yes — a table for four on Friday at 8 is yours.",
		});
		// The person's memory has it, like every message (rule 2).
		const memories = await runtime.store.memory.search("Friday");
		expect(memories.some((m) => m.data?.direction === "out")).toBe(true);

		// Revoked from the console: the agent is out.
		await send(
			"DELETE",
			`/api/mcp/connections/${added.connection.id}`,
			{},
			cookie,
		);
		await expect(
			ai.callTool({ name: "company_map", arguments: {} }),
		).rejects.toThrow();
	});
});
