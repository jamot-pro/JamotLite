import { createHash, randomBytes } from "node:crypto";
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
import { listConnections } from "@jamot/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, PASSWORD_SETTING } from "./auth.js";
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

const PASSWORD = "a long enough password";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

let runtime: Runtime;
let base: string;
let dataDir: string;
let agentKey: string;
beforeEach(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "jamot-oauth-"));
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
	await runtime.store.settings.set(
		PASSWORD_SETTING,
		await hashPassword(PASSWORD),
	);
	agentKey = (await runtime.store.graph.listNodes()).find(
		(n) => n.kind === "agent",
	)?.key as string;
	base = await runtime.listen(0);
});
afterEach(async () => {
	await runtime.stop();
	rmSync(dataDir, { recursive: true, force: true });
});

// biome-ignore lint/suspicious/noExplicitAny: test-only JSON reading
const json = async (res: Response): Promise<any> => res.json();
const form = (path: string, fields: Record<string, string>) =>
	fetch(`${base}${path}`, {
		method: "POST",
		redirect: "manual",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(fields).toString(),
	});

async function register(): Promise<string> {
	const res = await fetch(`${base}/oauth/register`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ client_name: "Claude", redirect_uris: [CALLBACK] }),
	});
	expect(res.status).toBe(201);
	return (await json(res)).client_id;
}

function pkce() {
	const verifier = randomBytes(32).toString("base64url");
	return {
		verifier,
		challenge: createHash("sha256").update(verifier).digest("base64url"),
	};
}

const authorizeParams = (clientId: string, challenge: string) => ({
	response_type: "code",
	client_id: clientId,
	redirect_uri: CALLBACK,
	code_challenge: challenge,
	code_challenge_method: "S256",
	state: "s-123",
	resource: `${base}/mcp`,
});

/** The whole consent: the owner allows, as `agentKey`. Returns the code. */
async function allow(clientId: string, challenge: string): Promise<string> {
	const res = await form("/oauth/authorize", {
		...authorizeParams(clientId, challenge),
		node: agentKey,
		password: PASSWORD,
		decision: "allow",
	});
	expect(res.status).toBe(302);
	const to = new URL(res.headers.get("location") ?? "");
	expect(`${to.origin}${to.pathname}`).toBe(CALLBACK);
	expect(to.searchParams.get("state")).toBe("s-123");
	expect(to.searchParams.get("iss")).toBe(base);
	return to.searchParams.get("code") as string;
}

const token = (fields: Record<string, string>) => form("/oauth/token", fields);

describe("MCP sign-in with OAuth (D44)", () => {
	it("tells a client without a token where to sign in", async () => {
		const res = await fetch(`${base}/mcp`, { method: "POST" });
		expect(res.status).toBe(401);
		expect(res.headers.get("www-authenticate")).toBe(
			`Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", scope="company"`,
		);

		const resource = await json(
			await fetch(`${base}/.well-known/oauth-protected-resource/mcp`),
		);
		expect(resource).toMatchObject({
			resource: `${base}/mcp`,
			authorization_servers: [base],
		});
		const server = await json(
			await fetch(`${base}/.well-known/oauth-authorization-server`),
		);
		expect(server).toMatchObject({
			issuer: base,
			authorization_endpoint: `${base}/oauth/authorize`,
			token_endpoint: `${base}/oauth/token`,
			code_challenge_methods_supported: ["S256"],
			client_id_metadata_document_supported: true,
		});
	});

	it("shows the owner who is asking, and never redirects to an undeclared address", async () => {
		const clientId = await register();
		const { challenge } = pkce();
		const q = new URLSearchParams(authorizeParams(clientId, challenge));
		const page = await fetch(`${base}/oauth/authorize?${q}`);
		expect(page.status).toBe(200);
		expect(page.headers.get("content-security-policy")).toContain(
			"frame-ancestors 'none'",
		);
		const html = await page.text();
		expect(html).toContain(
			"<strong>Claude</strong> from <strong>claude.ai</strong>",
		);
		expect(html).toContain('type="password"');

		q.set("redirect_uri", "https://evil.example/steal");
		const bad = await fetch(`${base}/oauth/authorize?${q}`, {
			redirect: "manual",
		});
		expect(bad.status).toBe(400);
		expect(bad.headers.get("location")).toBeNull();

		// PKCE is required: without it the client is told so, at its own address.
		q.set("redirect_uri", CALLBACK);
		q.delete("code_challenge");
		const noPkce = await fetch(`${base}/oauth/authorize?${q}`, {
			redirect: "manual",
		});
		expect(noPkce.status).toBe(302);
		expect(noPkce.headers.get("location")).toContain("error=invalid_request");
	});

	it("needs the console password, and a no goes back as access_denied", async () => {
		const clientId = await register();
		const { challenge } = pkce();
		const wrong = await form("/oauth/authorize", {
			...authorizeParams(clientId, challenge),
			node: agentKey,
			password: "not the password",
			decision: "allow",
		});
		expect(wrong.status).toBe(401);
		expect(await wrong.text()).toContain("That password is wrong.");

		const no = await form("/oauth/authorize", {
			...authorizeParams(clientId, challenge),
			decision: "deny",
		});
		expect(no.status).toBe(302);
		const to = new URL(no.headers.get("location") ?? "");
		expect(to.searchParams.get("error")).toBe("access_denied");
		expect(to.searchParams.get("state")).toBe("s-123");
		expect(await listConnections(runtime.store)).toEqual([]);
	});

	it("a code needs its PKCE verifier and works once", async () => {
		const clientId = await register();
		const { verifier, challenge } = pkce();
		const code = await allow(clientId, challenge);
		const exchange = (v: string) =>
			token({
				grant_type: "authorization_code",
				code,
				client_id: clientId,
				redirect_uri: CALLBACK,
				code_verifier: v,
				resource: `${base}/mcp`,
			});
		const wrong = await exchange("not-the-verifier");
		expect(wrong.status).toBe(400);
		expect((await json(wrong)).error).toBe("invalid_grant");
		// Used (even wrongly), the code is gone.
		expect((await exchange(verifier)).status).toBe(400);
	});

	it("connects the client as someone in the company, with the dashboard", async () => {
		const clientId = await register();
		const { verifier, challenge } = pkce();
		const code = await allow(clientId, challenge);
		const res = await token({
			grant_type: "authorization_code",
			code,
			client_id: clientId,
			redirect_uri: CALLBACK,
			code_verifier: verifier,
			resource: `${base}/mcp`,
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		const tokens = await json(res);
		expect(tokens).toMatchObject({
			token_type: "Bearer",
			expires_in: 3600,
			scope: "company",
		});
		const [connection] = await listConnections(runtime.store);
		expect(connection).toMatchObject({
			nodeKey: agentKey,
			access: "company",
			client: { id: clientId, name: "Claude", host: "claude.ai" },
		});

		const ai = new Client({ name: "claude", version: "1" });
		await ai.connect(
			new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
				requestInit: {
					headers: { authorization: `Bearer ${tokens.access_token}` },
				},
			}),
		);
		const { tools } = await ai.listTools();
		const dashboard = tools.find((t) => t.name === "company_dashboard");
		expect(dashboard?._meta).toMatchObject({
			ui: { resourceUri: "ui://jamot/company-dashboard" },
		});
		// A company-access connection sees no people tools.
		expect(tools.map((t) => t.name)).not.toContain("people_search");

		const view = await ai.readResource({ uri: "ui://jamot/company-dashboard" });
		expect(view.contents[0]?.mimeType).toBe("text/html;profile=mcp-app");
		expect(String((view.contents[0] as { text?: string }).text)).toContain(
			"ui/initialize",
		);

		const shown = await ai.callTool({
			name: "company_dashboard",
			arguments: { view: "map" },
		});
		expect(shown.structuredContent).toMatchObject({
			view: "map",
			caller: { as: connection?.nodeName, people: false },
			overview: { company: { name: "A neighbourhood restaurant" } },
			proposals: { pending: [], decided: [] },
		});
		await ai.close();

		// The refresh token gives a new pair; the old access token stops working.
		const again = await token({
			grant_type: "refresh_token",
			refresh_token: tokens.refresh_token,
			client_id: clientId,
		});
		expect(again.status).toBe(200);
		const old = await fetch(`${base}/mcp`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${tokens.access_token}`,
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
		});
		expect(old.status).toBe(401);
	});
});
