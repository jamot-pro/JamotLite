import type { BrainTool, ToolPolicy } from "@jamot/brain";
import { assertSafeUrl, type Secrets } from "@jamot/core";
import type { CompanyStore, StoredNode } from "@jamot/ports";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * MCP tools for agents. A tool in the company map becomes an MCP server with
 *
 *   tools:
 *     - key: t-stock
 *       name: Stock system
 *       mcp:
 *         url: https://stock.example.com/mcp
 *         tokenSecret: stock.token      # a secret ref, never the token itself
 *         allow: [check_stock]          # these run straight away; the rest wait for approval
 *         allowPrivateNetwork: false    # true for a server on the company's own LAN
 *
 * An agent gets the MCP tools of every tool node it uses or has access to,
 * directly or through its team. Unknown external tools might do anything, so
 * anything not listed in `allow` waits for a person's approval.
 */

export interface McpToolConfig {
	url: string;
	tokenSecret?: string;
	allow?: string[];
	allowPrivateNetwork?: boolean;
}

export function mcpConfigOf(node: StoredNode): McpToolConfig | null {
	const mcp = node.config.mcp as Partial<McpToolConfig> | undefined;
	return node.kind === "tool" && mcp && typeof mcp.url === "string"
		? (mcp as McpToolConfig)
		: null;
}

/** Tool nodes with an MCP server that this agent can reach. */
export function agentMcpNodes(
	nodes: StoredNode[],
	edges: { fromNodeId: string; toNodeId: string; relation: string }[],
	agentKey: string,
): StoredNode[] {
	const agent = nodes.find((n) => n.kind === "agent" && n.key === agentKey);
	if (!agent) return [];
	const teams = edges
		.filter((e) => e.fromNodeId === agent.id && e.relation === "member_of")
		.map((e) => e.toNodeId);
	const reach = new Set(
		edges
			.filter(
				(e) =>
					[agent.id, ...teams].includes(e.fromNodeId) &&
					(e.relation === "uses" || e.relation === "has_access_to"),
			)
			.map((e) => e.toNodeId),
	);
	return nodes.filter((n) => reach.has(n.id) && mcpConfigOf(n));
}

const safeName = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

/** Connects to each reachable MCP server and turns its tools into brain tools. */
export interface McpToolOptions {
	log?: (message: string) => void;
	/** The outbound URL check. Only tests replace it (to reach a server on 127.0.0.1). */
	guard?: (
		url: string,
		opts: { allowPrivateNetwork?: boolean },
	) => Promise<void>;
}

export async function mcpToolsForAgent(
	store: CompanyStore,
	secrets: Pick<Secrets, "get">,
	agentKey: string,
	opts: McpToolOptions = {},
): Promise<BrainTool[]> {
	const log = opts.log ?? (() => {});
	const guard = opts.guard ?? assertSafeUrl;
	const nodes = await store.graph.listNodes();
	const edges = await store.graph.listEdges();
	const tools: BrainTool[] = [];
	for (const node of agentMcpNodes(nodes, edges, agentKey)) {
		const config = mcpConfigOf(node) as McpToolConfig;
		try {
			const client = await connect(config, secrets, guard);
			const { tools: remote } = await client.listTools();
			for (const t of remote) {
				const policy: ToolPolicy = config.allow?.includes(t.name)
					? "allow"
					: "approve";
				tools.push({
					name: safeName(`${node.key}_${t.name}`),
					description: `${node.name}: ${t.description ?? t.name}`,
					parameters: t.inputSchema as Record<string, unknown>,
					policy,
					async execute(args, ctx) {
						// A fresh connection per call: a long-lived one would outlive a restart of the server.
						const c = await connect(config, secrets, guard);
						try {
							const result = await c.callTool(
								{ name: t.name, arguments: args },
								undefined,
								{ signal: ctx.signal },
							);
							const content =
								(result.content as
									| { type: string; text?: string }[]
									| undefined) ?? [];
							const out = content
								.map((part) =>
									part.type === "text" ? (part.text ?? "") : `[${part.type}]`,
								)
								.join("\n");
							return {
								text: out || "(no output)",
								isError: result.isError === true,
							};
						} finally {
							await c.close().catch(() => undefined);
						}
					},
				});
			}
			await client.close().catch(() => undefined);
		} catch (err) {
			log(`[mcp] ${node.key}: ${err instanceof Error ? err.message : err}`);
			await store.events.append({
				type: "tool.unreachable",
				source: `tool/${node.key}`,
				subject: node.key,
				data: { error: err instanceof Error ? err.message : String(err) },
				idempotencyKey: `tool-unreachable:${node.key}:${new Date().toISOString().slice(0, 13)}`,
			});
		}
	}
	return tools;
}

async function connect(
	config: McpToolConfig,
	secrets: Pick<Secrets, "get">,
	guard: NonNullable<McpToolOptions["guard"]>,
): Promise<Client> {
	await guard(config.url, {
		allowPrivateNetwork: config.allowPrivateNetwork === true,
	});
	const token = config.tokenSecret
		? await secrets.get(config.tokenSecret)
		: null;
	const transport = new StreamableHTTPClientTransport(new URL(config.url), {
		requestInit: { headers: token ? { authorization: `Bearer ${token}` } : {} },
	});
	const client = new Client({ name: "jamot-lite", version: "0.1.0" });
	await client.connect(transport);
	return client;
}
