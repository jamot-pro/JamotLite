import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { parseCompanyFile } from "@jamot/company-file";
import {
	addConnection,
	authenticateMcp,
	decideProposal,
	importCompanyFile,
	receiveMessage,
	revokeConnection,
} from "@jamot/core";
import type { CompanyStore } from "@jamot/ports";
import { openCompanyStore } from "@jamot/sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { handleMcpRequest, mcpToolsForAgent } from "./index.js";

function restaurant() {
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
}

async function listen(
	handler: http.RequestListener,
): Promise<{ url: string; close: () => void }> {
	const server = http.createServer(handler);
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	return {
		url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,
		close: () => server.close(),
	};
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
	let body = "";
	for await (const chunk of req) body += chunk;
	return body ? JSON.parse(body) : undefined;
}

async function connectAs(url: string, token: string): Promise<Client> {
	const client = new Client({ name: "test-ai", version: "1" });
	await client.connect(
		new StreamableHTTPClientTransport(new URL(url), {
			requestInit: { headers: { authorization: `Bearer ${token}` } },
		}),
	);
	return client;
}

const textOf = (result: unknown) =>
	(
		((result as { content?: { text?: string }[] }).content ?? []) as {
			text?: string;
		}[]
	)
		.map((c) => c.text ?? "")
		.join("");

let store: CompanyStore;
let asked: string[] = [];
const closers: (() => void)[] = [];
beforeEach(async () => {
	store = openCompanyStore(":memory:");
	asked = [];
	await importCompanyFile(store.graph, restaurant());
});
afterEach(() => {
	for (const close of closers.splice(0)) close();
	store.close();
});

describe("the company as an MCP server", () => {
	async function serve() {
		const server = await listen(async (req, res) => {
			await handleMcpRequest(req, res, await readJson(req), {
				store,
				authenticate: (token) => authenticateMcp(store, token, "owner-token"),
				onProposal: async (ids) => {
					asked.push(...ids);
				},
				version: "0.1.0",
			});
		});
		closers.push(server.close);
		return server;
	}

	it("answers the owner's AI: what's missing in my company?", async () => {
		const { url } = await serve();
		const ai = await connectAs(url, "owner-token");
		const { tools } = await ai.listTools();
		expect(tools.map((t) => t.name).sort()).toEqual([
			"approvals_pending",
			"company_map",
			"company_overview",
			"conversation",
			"memory_note",
			"memory_search",
			"people_search",
			"person_profile",
			"runs_recent",
			"whats_missing",
		]);

		const missing = JSON.parse(
			textOf(await ai.callTool({ name: "whats_missing", arguments: {} })),
		);
		expect(missing.covered).toBe(false);
		expect(missing.gaps).toContainEqual({
			area: "Every responsibility has an owner",
			missing: ["Head chef", "Floor manager"],
		});

		const overview = JSON.parse(
			textOf(await ai.callTool({ name: "company_overview", arguments: {} })),
		);
		expect(overview.company.name).toBe("A neighbourhood restaurant");
		await ai.close();
	});

	it("can note things down and find them again, but never approve anything", async () => {
		const { url } = await serve();
		const ai = await connectAs(url, "owner-token");
		await ai.callTool({
			name: "memory_note",
			arguments: { note: "The flour supplier closes for all of August" },
		});
		const found = JSON.parse(
			textOf(
				await ai.callTool({
					name: "memory_search",
					arguments: { query: "flour" },
				}),
			),
		);
		expect(found).toMatchObject([
			{
				scope: "company",
				content: "The flour supplier closes for all of August",
			},
		]);
		expect(
			(await ai.listTools()).tools.some((t) => /decide|approve_/.test(t.name)),
		).toBe(false);
		await ai.close();
	});

	it("refuses anyone without the token", async () => {
		const { url } = await serve();
		await expect(connectAs(url, "guess")).rejects.toThrow(/401|token/i);
	});
});

describe("MCP tools for agents", () => {
	async function stockServer() {
		const calls: string[] = [];
		const server = await listen(async (req, res) => {
			const mcp = new McpServer({ name: "stock", version: "1" });
			mcp.registerTool(
				"check_stock",
				{ description: "How much is left", inputSchema: { item: z.string() } },
				async ({ item }) => {
					calls.push(`check ${item}`);
					return { content: [{ type: "text", text: `12 kg of ${item}` }] };
				},
			);
			mcp.registerTool(
				"place_order",
				{
					description: "Order from the supplier",
					inputSchema: { item: z.string() },
				},
				async ({ item }) => {
					calls.push(`order ${item}`);
					return { content: [{ type: "text", text: `ordered ${item}` }] };
				},
			);
			const transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: undefined,
				enableJsonResponse: true,
			});
			res.on("close", () => void transport.close());
			await mcp.connect(transport);
			await transport.handleRequest(req, res, await readJson(req));
		});
		closers.push(server.close);
		return { ...server, calls };
	}

	async function attach(url: string) {
		// The Purchasing Agent (buyer) is in Office, which has access to the till;
		// give that tool an MCP server.
		const file = restaurant();
		const till = file.nodes.find((n) => n.key === "t-pos");
		if (till) till.config.mcp = { url, allow: ["check_stock"] };
		const s = openCompanyStore(":memory:");
		await importCompanyFile(s.graph, file);
		closers.push(() => s.close());
		return s;
	}

	it("gives an agent the MCP tools its team can reach; unlisted ones wait for approval", async () => {
		const stock = await stockServer();
		const company = await attach(stock.url);
		const tools = await mcpToolsForAgent(
			company,
			{ get: async () => null },
			"buyer",
			{ guard: async () => {} },
		);

		expect(tools.map((t) => [t.name, t.policy])).toEqual([
			["t-pos_check_stock", "allow"],
			["t-pos_place_order", "approve"],
		]);
		const result = await tools[0]?.execute(
			{ item: "flour" },
			{
				runId: "r",
				sessionId: "s",
				agentKey: "buyer",
				signal: new AbortController().signal,
			},
		);
		expect(result).toEqual({ text: "12 kg of flour", isError: false });
		expect(stock.calls).toEqual(["check flour"]);
	});

	it("doesn't give tools to agents that can't reach them", async () => {
		const stock = await stockServer();
		const company = await attach(stock.url);
		expect(
			await mcpToolsForAgent(company, { get: async () => null }, "host", {
				guard: async () => {},
			}),
		).toEqual([]);
	});

	it("refuses a server on loopback, and records it", async () => {
		const stock = await stockServer();
		const company = await attach(stock.url);
		expect(
			await mcpToolsForAgent(company, { get: async () => null }, "buyer"),
		).toEqual([]);
		expect(
			(await company.events.list({ type: "tool.unreachable" }))[0]?.data.error,
		).toMatch(/loopback/);
		expect(stock.calls).toEqual([]);
	});
});

describe("bring your own agent: a connection is someone in the company", () => {
	async function serve() {
		const server = await listen(async (req, res) => {
			await handleMcpRequest(req, res, await readJson(req), {
				store,
				authenticate: (token) => authenticateMcp(store, token, "owner-token"),
				onProposal: async (ids) => {
					asked.push(...ids);
				},
				version: "0.1.0",
			});
		});
		closers.push(server.close);
		return server.url;
	}
	const rossi = async () =>
		receiveMessage(store, {
			channel: "telegram",
			threadId: "100",
			messageId: "1",
			from: { userId: "100", displayName: "Mrs. Rossi" },
			text: "Is the terrace open tonight? I'm allergic to walnuts.",
		});

	it("sees only what its access allows, and only its own runs", async () => {
		await rossi();
		const url = await serve();
		const { token } = await addConnection(store, { nodeKey: "buyer" });
		const buyer = await connectAs(url, token);
		const names = (await buyer.listTools()).tools.map((t) => t.name);
		expect(names).not.toContain("people_search");
		expect(names).not.toContain("person_profile");
		expect(names).not.toContain("conversation");
		expect(names).toContain("propose");
		// Memory: only what the company knows about itself.
		expect(
			textOf(
				await buyer.callTool({
					name: "memory_search",
					arguments: { query: "walnuts" },
				}),
			),
		).not.toContain("walnuts");

		const people = await addConnection(store, {
			nodeKey: "host",
			access: "people",
		});
		const host = await connectAs(url, people.token);
		expect((await host.listTools()).tools.map((t) => t.name)).toContain(
			"people_search",
		);
		expect(
			textOf(
				await host.callTool({
					name: "memory_search",
					arguments: { query: "walnuts" },
				}),
			),
		).toContain("walnuts");
	});

	it("records every call as its node's activity", async () => {
		const url = await serve();
		const { token, connection } = await addConnection(store, {
			nodeKey: "buyer",
		});
		const buyer = await connectAs(url, token);
		await buyer.callTool({ name: "company_map", arguments: {} });
		const runs = await store.runs.list({ agentKey: "buyer" });
		expect(runs.map((r) => r.trigger)).toContain("mcp:company_map");
		expect(runs[0]?.sessionId).toBe(`mcp:${connection.id}`);
		const calls = await store.events.list({ type: "mcp.call" });
		expect(calls[0]?.subject).toBe("buyer");
		// runs_recent shows the buyer its own runs, not the others'.
		await store.runs.start({
			sessionId: "telegram:100:host",
			agentKey: "host",
			model: null,
			trigger: "message",
			input: null,
		});
		const recent = textOf(
			await buyer.callTool({ name: "runs_recent", arguments: {} }),
		);
		expect(recent).toContain('"agent": "buyer"');
		expect(recent).not.toContain('"agent": "host"');
	});

	it("refuses a revoked token, and the shared one once it's revoked", async () => {
		const url = await serve();
		const { token, connection } = await addConnection(store, {
			nodeKey: "buyer",
		});
		await revokeConnection(store, connection.id);
		await expect(connectAs(url, token)).rejects.toThrow();
		// A made-up token with a real id is refused too.
		const { connection: other } = await addConnection(store, {
			nodeKey: "host",
		});
		await expect(
			connectAs(url, `jmt_${other.id}_not-the-real-secret`),
		).rejects.toThrow();
		// The shared token works until the owner revokes it.
		await connectAs(url, "owner-token");
		await revokeConnection(store, "shared");
		await expect(connectAs(url, "owner-token")).rejects.toThrow();
		await expect(addConnection(store, { nodeKey: "nobody" })).rejects.toThrow(
			/no agent or person "nobody"/,
		);
	});

	it("proposes: an approval for a person, and nothing else until it's approved", async () => {
		const intake = await rossi();
		const url = await serve();
		const { token } = await addConnection(store, {
			nodeKey: "host",
			access: "people",
		});
		const host = await connectAs(url, token);
		const answer = textOf(
			await host.callTool({
				name: "propose",
				arguments: {
					action: "message_person",
					personId: intake.personId,
					text: "Yes, the terrace is open from 7.",
				},
			}),
		);
		expect(answer).toContain("waiting for a person to approve");
		const [approval] = await store.approvals.list({ status: "pending" });
		expect(approval).toMatchObject({
			agentKey: "host",
			tool: "propose.message_person",
		});
		expect(asked).toEqual([approval?.id]);
		// Nothing was sent or queued.
		expect(await store.conversations.listPending()).toEqual([]);

		// A company-access connection can't propose messaging a person.
		const buyer = await connectAs(
			url,
			(await addConnection(store, { nodeKey: "buyer" })).token,
		);
		const refused = await buyer.callTool({
			name: "propose",
			arguments: {
				action: "message_person",
				personId: intake.personId,
				text: "hi",
			},
		});
		expect(refused.isError).toBe(true);

		// The owner approves: now the message waits in the outbox, once.
		await decideProposal(store, approval as never, {
			approved: true,
			by: "Lucia",
		});
		const pending = await store.conversations.listPending();
		expect(pending.map((m) => [m.text, m.agentKey])).toEqual([
			["Yes, the terrace is open from 7.", "host"],
		]);
		await expect(
			decideProposal(store, approval as never, { approved: true, by: "Lucia" }),
		).rejects.toThrow();
		expect(await store.conversations.listPending()).toHaveLength(1);
	});
});
