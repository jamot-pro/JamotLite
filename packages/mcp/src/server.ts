import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { computeReadiness, computeVitals } from "@jamot/core";
import type { CompanyStore } from "@jamot/ports";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

/**
 * The Dream MCP surface: the company as an MCP server, so the owner's own AI —
 * Claude, Cursor, Hermes — can ask it things ("what's missing in my company?").
 *
 * It reads, and it can note things down. It never decides approvals: those
 * stay with a person pressing a button (AGENTS.md rule 3), not with whichever
 * AI holds the token.
 */

const text = (value: unknown) => ({
	content: [
		{
			type: "text" as const,
			text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
		},
	],
});

export function createCompanyMcpServer(
	store: CompanyStore,
	opts: { version: string; dataDir?: string },
): McpServer {
	const server = new McpServer({
		name: "jamot-company",
		version: opts.version,
	});

	server.registerTool(
		"company_overview",
		{
			title: "Company overview",
			description:
				"The company, its Dream, how ready it is, and its vital signs: money, people, work, and the runtime.",
		},
		async () => {
			const company = await store.graph.getCompany();
			const dream = (await store.graph.listNodes()).find(
				(n) => n.kind === "dream",
			);
			const vitals = await computeVitals(
				store,
				opts.dataDir ? { dataDir: opts.dataDir } : {},
			);
			return text({
				company,
				dream: dream?.config ?? null,
				covered: vitals.people.readiness.covered,
				readiness: Math.round(vitals.people.readiness.overall * 100),
				tier: vitals.tier,
				money: vitals.money,
				unowned: vitals.people.unowned,
				quiet: vitals.people.quiet,
				work: vitals.work,
				runtime: vitals.runtime,
			});
		},
	);

	server.registerTool(
		"whats_missing",
		{
			title: "What's missing",
			description:
				"Everything that keeps the company from being fully covered, and the issues its heartbeats raised.",
		},
		async () => {
			const readiness = computeReadiness({
				nodes: await store.graph.listNodes(),
				edges: await store.graph.listEdges(),
			});
			// Issues the heartbeats raised and haven't seen fixed since (an issue can reopen).
			const lastResolved = new Map<string, number>();
			for (const e of await store.events.list({
				type: "issue.resolved",
				limit: 1000,
			})) {
				if (e.subject && !lastResolved.has(e.subject))
					lastResolved.set(e.subject, e.seq);
			}
			const seen = new Set<string>();
			const open: unknown[] = [];
			for (const e of await store.events.list({
				type: "issue.opened",
				limit: 1000,
			})) {
				if (!e.subject || seen.has(e.subject)) continue;
				seen.add(e.subject);
				if (e.seq > (lastResolved.get(e.subject) ?? 0)) open.push(e.data.title);
			}
			return text({
				covered: readiness.covered,
				gaps: readiness.dimensions
					.filter((d) => d.missing.length > 0)
					.map((d) => ({
						area: d.label,
						missing: d.missing.map((m) => m.name),
					})),
				openIssues: open,
			});
		},
	);

	server.registerTool(
		"company_map",
		{
			title: "Company map",
			description:
				"Teams, people, agents, responsibilities (and who owns each), tools and heartbeats.",
		},
		async () => {
			const nodes = await store.graph.listNodes();
			const edges = await store.graph.listEdges();
			const byId = new Map(nodes.map((n) => [n.id, n]));
			const kinds = [
				"team",
				"human",
				"agent",
				"responsibility",
				"tool",
				"heartbeat",
			] as const;
			const map: Record<string, unknown[]> = {};
			for (const kind of kinds) {
				map[kind] = nodes
					.filter((n) => n.kind === kind)
					.map((n) => ({
						key: n.key,
						name: n.name,
						...(kind === "responsibility"
							? {
									owners: edges
										.filter(
											(e) =>
												e.toNodeId === n.id &&
												(e.relation === "owns" ||
													e.relation === "responsible_for"),
										)
										.map((e) => byId.get(e.fromNodeId)?.name),
								}
							: {}),
						...(kind === "heartbeat" ? { schedule: n.config.schedule } : {}),
					}));
			}
			return text(map);
		},
	);

	server.registerTool(
		"people_search",
		{
			title: "Find people",
			description:
				"Customers, staff and suppliers the company knows, by name, email or phone. Empty query lists the most recent.",
			inputSchema: {
				query: z.string().default(""),
				limit: z.number().int().min(1).max(50).default(10),
			},
		},
		async ({ query, limit }) => {
			const people = await store.people.list({ search: query, limit });
			return text(
				people.map((p) => ({
					id: p.id,
					name: p.displayName,
					lastInteractionAt: p.lastInteractionAt,
					summary: p.contextSummary,
				})),
			);
		},
	);

	server.registerTool(
		"person_profile",
		{
			title: "A person's profile",
			description:
				"Everything the company remembers about one person, and their recent conversations.",
			inputSchema: { personId: z.string() },
		},
		async ({ personId }) => {
			const person = await store.people.get(personId);
			if (!person) return { ...text(`No person ${personId}.`), isError: true };
			const memories = await store.memory.list({
				scope: "person",
				ownerId: personId,
				limit: 30,
			});
			const conversations = await store.conversations.list({
				personId,
				limit: 5,
			});
			return text({
				person,
				identities: (await store.people.listIdentities(personId)).map((i) => ({
					provider: i.provider,
					value: i.value,
				})),
				remembered: memories.map((m) => ({
					kind: m.kind,
					content: m.content,
					at: m.createdAt,
				})),
				conversations: conversations.map((c) => ({
					id: c.id,
					channel: c.channel,
					lastMessageAt: c.lastMessageAt,
				})),
			});
		},
	);

	server.registerTool(
		"conversation",
		{
			title: "A conversation",
			description: "The latest messages of one conversation, oldest first.",
			inputSchema: {
				conversationId: z.string(),
				limit: z.number().int().min(1).max(200).default(30),
			},
		},
		async ({ conversationId, limit }) => {
			const messages = await store.conversations.listMessages(conversationId, {
				limit,
			});
			return text(
				messages.map((m) => ({
					direction: m.direction,
					from: m.agentKey ?? (m.direction === "in" ? "person" : "company"),
					text: m.text,
					at: m.createdAt,
					status: m.status,
				})),
			);
		},
	);

	server.registerTool(
		"memory_search",
		{
			title: "Search memory",
			description:
				"Search what the company remembers, about people or about itself.",
			inputSchema: {
				query: z.string().min(2),
				scope: z.enum(["person", "company"]).optional(),
			},
		},
		async ({ query, scope }) => {
			const found = await store.memory.search(query, {
				...(scope ? { scope } : {}),
				limit: 20,
			});
			return text(
				found.map((m) => ({
					scope: m.scope,
					about: m.ownerId,
					kind: m.kind,
					content: m.content,
					at: m.createdAt,
				})),
			);
		},
	);

	server.registerTool(
		"memory_note",
		{
			title: "Note something down",
			description:
				"Add something the company should remember — about a person, or about the company itself.",
			inputSchema: { note: z.string().min(3), personId: z.string().optional() },
		},
		async ({ note, personId }) => {
			if (personId && !(await store.people.get(personId)))
				return { ...text(`No person ${personId}.`), isError: true };
			await store.memory.store({
				scope: personId ? "person" : "company",
				ownerId: personId ?? null,
				kind: "fact",
				content: note,
				data: { via: "mcp" },
				source: "human",
			});
			return text("Noted.");
		},
	);

	server.registerTool(
		"runs_recent",
		{
			title: "Recent agent runs",
			description:
				"What the agents did lately, with tokens and cost, and totals for the last 30 days.",
			inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
		},
		async ({ limit }) => {
			const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
			return text({
				last30Days: await store.runs.totals({ since }),
				runs: (await store.runs.list({ limit })).map((r) => ({
					agent: r.agentKey,
					status: r.status,
					trigger: r.trigger,
					model: r.model,
					costMicroUsd: r.costMicroUsd,
					tokens: r.inputTokens + r.outputTokens,
					output: r.output,
					error: r.error,
					at: r.startedAt,
				})),
			});
		},
	);

	server.registerTool(
		"approvals_pending",
		{
			title: "Waiting for approval",
			description:
				"Agent actions waiting for the owner. Decide them on Telegram — this surface can't approve anything.",
		},
		async () => {
			const pending = await store.approvals.list({ status: "pending" });
			return text(
				pending.map((a) => ({
					id: a.id,
					agent: a.agentKey,
					tool: a.tool,
					args: a.args,
					since: a.createdAt,
				})),
			);
		},
	);

	return server;
}

/** Serves one MCP request (stateless: a fresh server per request). Checks the bearer token first. */
export async function handleMcpRequest(
	req: IncomingMessage,
	res: ServerResponse,
	body: unknown,
	opts: {
		store: CompanyStore;
		token: string;
		version: string;
		dataDir?: string;
	},
): Promise<void> {
	const given =
		/^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
	const a = Buffer.from(given);
	const b = Buffer.from(opts.token);
	if (a.length !== b.length || !timingSafeEqual(a, b)) {
		res.writeHead(401, {
			"content-type": "application/json",
			"www-authenticate": "Bearer",
		});
		res.end(JSON.stringify({ error: "a valid bearer token is required" }));
		return;
	}
	const server = createCompanyMcpServer(opts.store, {
		version: opts.version,
		...(opts.dataDir ? { dataDir: opts.dataDir } : {}),
	});
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	res.on("close", () => {
		void transport.close();
		void server.close();
	});
	await server.connect(transport);
	await transport.handleRequest(req, res, body);
}
