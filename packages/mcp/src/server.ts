import type { IncomingMessage, ServerResponse } from "node:http";
import {
	computeReadiness,
	computeVitals,
	isRetired,
	type McpCaller,
	PROPOSAL_SESSION_PREFIX,
	propose,
} from "@jamot/core";
import type { CompanyStore } from "@jamot/ports";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
	DASHBOARD_HTML,
	DASHBOARD_URI,
	DASHBOARD_VIEWS,
	type DashboardView,
	MCP_APP_MIME,
} from "./dashboard.js";

/**
 * The company's MCP surface: the company as an MCP server, so the owner's own AI —
 * Claude, Cursor, Hermes — can ask it things ("what's missing in my company?").
 *
 * It reads, and it can note things down. It never decides approvals: those
 * stay with a person pressing a button (AGENTS.md rule 3), not with whichever
 * AI holds the token.
 *
 * A caller is either the original shared token (everything, as nobody in
 * particular) or a connection (BLUEPRINT S8): an agent or a human of the
 * company map, seeing what its access allows — "company", or "people" too —
 * and only its own runs and proposals. Each of a connection's calls is
 * recorded as that node's activity: a run on the Runs page and an event.
 * A connection can `propose`; a proposal waits for a person.
 */

const SHARED: McpCaller = { kind: "shared", access: "people" };

/** What one connection may do, so a leaked token can't flood the company. */
export const CONNECTION_LIMITS = { callsPerMinute: 30, openProposals: 5 };
// Across requests: a fresh server is made for each one.
const recentCalls = new Map<string, number[]>();
function withinRate(connectionId: string, now = Date.now()): boolean {
	const recent = (recentCalls.get(connectionId) ?? []).filter(
		(t) => now - t < 60_000,
	);
	if (recent.length >= CONNECTION_LIMITS.callsPerMinute) {
		recentCalls.set(connectionId, recent);
		return false;
	}
	recent.push(now);
	recentCalls.set(connectionId, recent);
	return true;
}

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
	opts: {
		version: string;
		dataDir?: string;
		caller?: McpCaller;
		/** Called with new proposals, to ask the owner (Telegram). */
		onProposal?: (approvalIds: string[]) => Promise<void>;
	},
): McpServer {
	const caller = opts.caller ?? SHARED;
	const connection = caller.kind === "connection" ? caller : null;
	const seesPeople = caller.access === "people";
	const server = new McpServer({
		name: "jamot-company",
		version: opts.version,
	});

	/** Registers a tool; a connection's calls become its node's runs and events. */
	type Result = ReturnType<typeof text> & {
		isError?: boolean;
		structuredContent?: Record<string, unknown>;
	};
	const tool = <A>(
		name: string,
		config: {
			title: string;
			description: string;
			inputSchema?: Record<string, z.ZodTypeAny>;
			_meta?: Record<string, unknown>;
		},
		handler: (args: A, run: { id: string } | null) => Promise<Result>,
	) => {
		server.registerTool(
			name,
			config as never,
			(async (args: A) => {
				if (!connection) return handler(args, null);
				if (!withinRate(connection.connectionId))
					return {
						...text(
							`Slow down: at most ${CONNECTION_LIMITS.callsPerMinute} calls a minute.`,
						),
						isError: true,
					};
				const run = await store.runs.start({
					sessionId: `${PROPOSAL_SESSION_PREFIX}${connection.connectionId}`,
					agentKey: connection.nodeKey,
					model: "external (MCP)",
					trigger: `mcp:${name}`,
					input: args ? JSON.stringify(args).slice(0, 500) : null,
				});
				await store.events.append({
					type: "mcp.call",
					source: `mcp/${connection.nodeKey}`,
					subject: connection.nodeKey,
					data: {
						tool: name,
						connectionId: connection.connectionId,
						runId: run.id,
					},
					idempotencyKey: `mcp-call:${run.id}`,
				});
				try {
					const result = await handler(args, run);
					await store.runs.finish(run.id, {
						status: result.isError ? "error" : "done",
						output: seesPeople
							? (result.content[0]?.text.slice(0, 500) ?? null)
							: null,
					});
					return result;
				} catch (err) {
					await store.runs.finish(run.id, {
						status: "error",
						error: err instanceof Error ? err.message : String(err),
					});
					throw err;
				}
			}) as never,
		);
	};

	/** The company, its charter, readiness and vital signs. */
	const overviewData = async () => {
		const company = await store.graph.getCompany();
		const dream = (await store.graph.listNodes()).find(
			(n) => n.kind === "dream",
		);
		const vitals = await computeVitals(
			store,
			opts.dataDir ? { dataDir: opts.dataDir } : {},
		);
		return {
			company,
			// The charter in its own words (`dream` is only the code name).
			charter: dream
				? {
						vision: dream.config.vision ?? null,
						mission: dream.config.objective ?? null,
						values: dream.config.constraints ?? [],
						goals: dream.config.outcomes ?? [],
					}
				: null,
			covered: vitals.people.readiness.covered,
			readiness: Math.round(vitals.people.readiness.overall * 100),
			tier: vitals.tier,
			money: vitals.money,
			unowned: vitals.people.unowned,
			quiet: vitals.people.quiet,
			work: vitals.work,
			runtime: vitals.runtime,
		};
	};

	/** What keeps the company from being covered, and open heartbeat issues. */
	const missingData = async () => {
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
		return {
			covered: readiness.covered,
			gaps: readiness.dimensions
				.filter((d) => d.missing.length > 0)
				.map((d) => ({
					area: d.label,
					missing: d.missing.map((m) => m.name),
				})),
			openIssues: open,
		};
	};

	/** Teams, people, agents, responsibilities (with owners), tools, heartbeats. */
	const mapData = async () => {
		// Retired agents are history, not part of the map.
		const nodes = (await store.graph.listNodes()).filter((n) => !isRetired(n));
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
		return map;
	};

	/** Recent runs — a connection's own only — and 30-day totals. */
	const runsData = async (limit: number) => {
		const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
		return {
			last30Days: await store.runs.totals({
				since,
				...(connection ? { agentKey: connection.nodeKey } : {}),
			}),
			// A connection sees its own node's runs; the shared token, all.
			runs: (
				await store.runs.list({
					limit,
					...(connection ? { agentKey: connection.nodeKey } : {}),
				})
			).map((r) => ({
				agent: r.agentKey,
				status: r.status,
				trigger: r.trigger,
				model: r.model,
				costMicroUsd: r.costMicroUsd,
				tokens: r.inputTokens + r.outputTokens,
				// Run words can quote customers: only with people access.
				output: seesPeople ? r.output : null,
				error: r.error,
				at: r.startedAt,
			})),
		};
	};

	/** Actions waiting for the owner — a connection's own only. */
	const pendingData = async () => {
		const pending = await store.approvals.list({
			status: "pending",
			// A connection sees its own proposals.
			...(connection
				? {
						sessionId: `${PROPOSAL_SESSION_PREFIX}${connection.connectionId}`,
					}
				: {}),
		});
		return pending.map((a) => ({
			id: a.id,
			agent: a.agentKey,
			tool: a.tool,
			args: a.args,
			since: a.createdAt,
		}));
	};

	tool(
		"company_overview",
		{
			title: "Company overview",
			description:
				"The company, its charter (vision, mission, values, goals), how ready it is, and its vital signs: money, people, work, and the runtime.",
		},
		async () => text(await overviewData()),
	);

	tool(
		"whats_missing",
		{
			title: "What's missing",
			description:
				"Everything that keeps the company from being fully covered, and the issues its heartbeats raised.",
		},
		async () => text(await missingData()),
	);

	tool(
		"company_map",
		{
			title: "Company map",
			description:
				"Teams, people, agents, responsibilities (and who owns each), tools and heartbeats.",
		},
		async () => text(await mapData()),
	);

	// People and their conversations: only with people access.
	if (seesPeople) {
		tool(
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
			async ({ query, limit }: { query: string; limit: number }) => {
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

		tool(
			"person_profile",
			{
				title: "A person's profile",
				description:
					"Everything the company remembers about one person, and their recent conversations.",
				inputSchema: { personId: z.string() },
			},
			async ({ personId }: { personId: string }) => {
				const person = await store.people.get(personId);
				if (!person)
					return { ...text(`No person ${personId}.`), isError: true };
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
					identities: (await store.people.listIdentities(personId)).map(
						(i) => ({
							provider: i.provider,
							value: i.value,
						}),
					),
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

		tool(
			"conversation",
			{
				title: "A conversation",
				description: "The latest messages of one conversation, oldest first.",
				inputSchema: {
					conversationId: z.string(),
					limit: z.number().int().min(1).max(200).default(30),
				},
			},
			async ({
				conversationId,
				limit,
			}: {
				conversationId: string;
				limit: number;
			}) => {
				const messages = await store.conversations.listMessages(
					conversationId,
					{
						limit,
					},
				);
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
	}

	tool(
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
		async ({
			query,
			scope,
		}: {
			query: string;
			scope?: "person" | "company";
		}) => {
			// Without people access, only what the company knows about itself.
			const only = seesPeople ? scope : "company";
			const found = await store.memory.search(query, {
				...(only ? { scope: only } : {}),
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

	tool(
		"memory_note",
		{
			title: "Note something down",
			description:
				"Add something the company should remember — about a person, or about the company itself.",
			inputSchema: { note: z.string().min(3), personId: z.string().optional() },
		},
		async ({ note, personId }: { note: string; personId?: string }) => {
			if (personId && !seesPeople)
				return {
					...text(
						"This connection can't see people, so it can't note about one.",
					),
					isError: true,
				};
			if (personId && !(await store.people.get(personId)))
				return { ...text(`No person ${personId}.`), isError: true };
			await store.memory.store({
				scope: personId ? "person" : "company",
				ownerId: personId ?? null,
				kind: "fact",
				content: note,
				data: { via: "mcp", ...(connection ? { by: connection.nodeKey } : {}) },
				source: "human",
			});
			return text("Noted.");
		},
	);

	tool(
		"runs_recent",
		{
			title: "Recent agent runs",
			description:
				"What the agents did lately, with tokens and cost, and totals for the last 30 days.",
			inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
		},
		async ({ limit }: { limit: number }) => text(await runsData(limit)),
	);

	tool(
		"approvals_pending",
		{
			title: "Waiting for approval",
			description:
				"Agent actions waiting for the owner. Decide them on Telegram — this surface can't approve anything.",
		},
		async () => text(await pendingData()),
	);

	// The dashboard, shown inside the conversation by hosts that support MCP
	// Apps (D45); others get its summary as text.
	server.registerResource(
		"company-dashboard",
		DASHBOARD_URI,
		{
			title: "Company dashboard",
			description:
				"The company at a glance: readiness, map, activity, proposals.",
			mimeType: MCP_APP_MIME,
			_meta: { ui: { prefersBorder: true } },
		},
		async () => ({
			contents: [
				{
					uri: DASHBOARD_URI,
					mimeType: MCP_APP_MIME,
					text: DASHBOARD_HTML,
					_meta: { ui: { prefersBorder: true } },
				},
			],
		}),
	);

	/** Proposals decided lately — a connection's own only. */
	const decidedData = async () =>
		(
			await store.approvals.list(
				connection
					? {
							sessionId: `${PROPOSAL_SESSION_PREFIX}${connection.connectionId}`,
						}
					: {},
			)
		)
			.filter((a) => a.status !== "pending")
			.slice(-10)
			.reverse()
			.map((a) => ({
				agent: a.agentKey,
				tool: a.tool,
				status: a.status,
				by: a.decidedBy,
				at: a.decidedAt,
			}));

	tool(
		"company_dashboard",
		{
			title: "Show the company",
			description:
				"Shows the company as a dashboard: readiness and what's missing, the company map, recent activity, and proposals waiting for a person. Use it when the owner wants to see the company.",
			inputSchema: { view: z.enum(DASHBOARD_VIEWS).optional() },
			_meta: {
				ui: { resourceUri: DASHBOARD_URI },
				// The key hosts read before MCP Apps settled on `ui.resourceUri`.
				"ui/resourceUri": DASHBOARD_URI,
			},
		},
		async ({ view }: { view?: DashboardView }) => {
			const [overview, missing, map, activity, pending, decided] =
				await Promise.all([
					overviewData(),
					missingData(),
					mapData(),
					runsData(15),
					pendingData(),
					decidedData(),
				]);
			const name = overview.company?.name ?? "The company";
			const summary = [
				`${name}: ${overview.readiness}% ready${overview.covered ? ", fully covered" : ""}.`,
				`${missing.gaps.length} gap(s), ${missing.openIssues.length} open issue(s), ${pending.length} proposal(s) waiting for a person.`,
				"Shown as a dashboard; company_overview, company_map, runs_recent and approvals_pending give the details as text.",
			].join(" ");
			return {
				...text(summary),
				structuredContent: {
					view: view ?? "overview",
					caller: {
						as: connection?.nodeName ?? null,
						people: seesPeople,
					},
					overview,
					missing,
					map,
					activity,
					proposals: { pending, decided },
				},
			};
		},
	);

	if (connection) {
		tool(
			"propose",
			{
				title: "Propose an action",
				description: `Ask the owner to approve something you, as ${connection.nodeName}, want done: message a person (needs people access) or give a responsibility an owner. Nothing happens until a person approves it.`,
				inputSchema: {
					action: z.enum(["message_person", "assign_owner"]),
					personId: z.string().optional(),
					text: z.string().min(1).max(2_000).optional(),
					responsibilityKey: z.string().optional(),
					ownerKey: z.string().optional(),
				},
			},
			async (
				args: {
					action: "message_person" | "assign_owner";
					personId?: string;
					text?: string;
					responsibilityKey?: string;
					ownerKey?: string;
				},
				run,
			) => {
				const from = {
					connectionId: connection.connectionId,
					nodeKey: connection.nodeKey,
					runId: (run as { id: string }).id,
				};
				const fail = (why: string) => ({ ...text(why), isError: true });
				const open = await store.approvals.list({
					status: "pending",
					sessionId: `${PROPOSAL_SESSION_PREFIX}${connection.connectionId}`,
				});
				if (open.length >= CONNECTION_LIMITS.openProposals)
					return fail(
						`${open.length} proposals are already waiting for the owner; wait until they're decided.`,
					);
				try {
					let approval: Awaited<ReturnType<typeof propose>>;
					if (args.action === "message_person") {
						if (!seesPeople)
							return fail(
								"This connection can't see people, so it can't message one.",
							);
						if (!args.personId || !args.text)
							return fail("Say who (personId) and what (text).");
						approval = await propose(store, from, {
							kind: "message_person",
							personId: args.personId,
							text: args.text,
						});
					} else {
						if (!args.responsibilityKey || !args.ownerKey)
							return fail("Say which responsibility and who should own it.");
						approval = await propose(store, from, {
							kind: "assign_owner",
							responsibilityKey: args.responsibilityKey,
							ownerKey: args.ownerKey,
						});
					}
					await opts.onProposal?.([approval.id]).catch((err: unknown) =>
						store.events.append({
							type: "proposal.unrouted",
							source: `mcp/${connection.nodeKey}`,
							subject: approval.id,
							data: { error: err instanceof Error ? err.message : String(err) },
							idempotencyKey: `proposal-unrouted:${approval.id}`,
						}),
					);
					return text({
						proposal: approval.id,
						status: "waiting for a person to approve",
					});
				} catch (err) {
					return fail(err instanceof Error ? err.message : String(err));
				}
			},
		);
	}

	return server;
}

/** Serves one MCP request (stateless: a fresh server per request). Finds the caller first. */
export async function handleMcpRequest(
	req: IncomingMessage,
	res: ServerResponse,
	body: unknown,
	opts: {
		store: CompanyStore;
		/** The caller a bearer token stands for, or null (see authenticateMcp). */
		authenticate: (token: string) => Promise<McpCaller | null>;
		onProposal?: (approvalIds: string[]) => Promise<void>;
		version: string;
		dataDir?: string;
		/** Where an OAuth client finds how to sign in (RFC 9728). */
		resourceMetadata?: string;
	},
): Promise<void> {
	const given =
		/^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
	const caller = await opts.authenticate(given);
	if (!caller) {
		res.writeHead(401, {
			"content-type": "application/json",
			"www-authenticate": opts.resourceMetadata
				? `Bearer resource_metadata="${opts.resourceMetadata}", scope="company"`
				: "Bearer",
		});
		res.end(JSON.stringify({ error: "a valid bearer token is required" }));
		return;
	}
	const server = createCompanyMcpServer(opts.store, {
		version: opts.version,
		caller,
		...(opts.onProposal ? { onProposal: opts.onProposal } : {}),
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
