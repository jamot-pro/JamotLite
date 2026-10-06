import { stringifyCompanyFile } from "@jamot/company-file";
import type {
	ActionResult,
	AgentInput,
	AgentsView,
	AgentToolsInput,
	ApprovalsView,
	ContributionInput,
	ContributionsView,
	MapView,
	McpInfo,
	Me,
	MessageRow,
	OverviewView,
	PairingCode,
	PersonProfile,
	PersonRow,
	RewardInput,
	RoleInviteCode,
	RunsView,
	SettingsView,
	StewardInput,
	StewardResponsibilitiesInput,
	StewardsView,
} from "@jamot/contracts";
import {
	AgentError,
	addAgent,
	addConnection,
	addSteward,
	agentsView,
	type Connection,
	computeVitals,
	contributionsView,
	createRoleInvite,
	decideContribution,
	exportCompanyFile,
	giveReward,
	handleOwnerAction,
	isRetired,
	listConnections,
	recordContribution,
	retireAgent,
	retireMember,
	revokeConnection,
	type Secrets,
	setAgentTools,
	setStewardResponsibilities,
	stewardsView,
	updateAgent,
	updateSteward,
} from "@jamot/core";
import type { CompanyStore } from "@jamot/ports";
import type { TelegramChannel } from "@jamot/telegram";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
	createSessions,
	PASSWORD_SETTING,
	readCookie,
	SESSION_COOKIE,
	verifyPassword,
} from "./auth.js";
import {
	updateWebChatSettings,
	WEBCHAT_DEFAULTS,
	WEBCHAT_SETTING,
	type WebChatSettings,
} from "./webchat.js";

/**
 * The console's JSON API, under /api. Every route except sign-in needs the
 * owner's session. The console is a person at a screen, so it can decide
 * approvals — unlike the MCP surface (RUNTIME D23).
 */
export interface ApiDeps {
	store: CompanyStore;
	secrets: Secrets;
	secretKey: Buffer;
	telegram: TelegramChannel;
	dataDir: string;
	decide(
		approvalId: string,
		approved: boolean,
		by: string,
		note?: string,
	): Promise<void>;
	mcpToken(): Promise<string>;
	/** The address the console was reached on, for showing the MCP URL. */
	version: string;
	/** Served over HTTPS (behind a proxy): the session cookie is Secure. */
	secureCookies?: boolean;
}

export const MODEL_PROVIDERS = [
	"anthropic",
	"openai",
	"google",
	"openrouter",
	"ollama",
] as const;

export function registerApi(app: FastifyInstance, deps: ApiDeps): void {
	const { store } = deps;
	const sessions = createSessions(deps.secretKey);
	const attempts = new Map<string, { count: number; since: number }>();
	const cookieFlags = `HttpOnly; SameSite=Strict; Path=/${deps.secureCookies ? "; Secure" : ""}`;

	const signedIn = (req: FastifyRequest) =>
		sessions.valid(readCookie(req.headers.cookie, SESSION_COOKIE));
	const guard = async (req: FastifyRequest, reply: FastifyReply) => {
		if (!signedIn(req)) return reply.code(401).send({ error: "sign in first" });
	};

	app.post<{ Body: { password?: string } }>(
		"/api/login",
		async (req, reply) => {
			// Five tries a minute per address.
			const now = Date.now();
			const a = attempts.get(req.ip) ?? { count: 0, since: now };
			if (now - a.since > 60_000) Object.assign(a, { count: 0, since: now });
			if (++a.count > 5)
				return reply
					.code(429)
					.send({ error: "too many tries — wait a minute" });
			attempts.set(req.ip, a);

			const stored = await store.settings.get<string>(PASSWORD_SETTING);
			if (!stored)
				return reply
					.code(409)
					.send({ error: "no password is set yet — run `jamot setup`" });
			if (!(await verifyPassword(String(req.body?.password ?? ""), stored)))
				return reply.code(401).send({ error: "wrong password" });
			attempts.delete(req.ip);
			const { token, maxAgeSeconds } = sessions.issue();
			reply.header(
				"set-cookie",
				`${SESSION_COOKIE}=${token}; ${cookieFlags}; Max-Age=${maxAgeSeconds}`,
			);
			return { ok: true };
		},
	);

	app.post("/api/logout", async (_req, reply) => {
		reply.header("set-cookie", `${SESSION_COOKIE}=; ${cookieFlags}; Max-Age=0`);
		return { ok: true };
	});

	app.get(
		"/api/me",
		async (req): Promise<Me> => ({
			signedIn: signedIn(req),
			passwordSet: (await store.settings.get(PASSWORD_SETTING)) !== null,
			// A demo company (jamot demo) runs on scripted replies: the console says so.
			demo:
				(await store.settings.get<{ provider?: string }>("model"))?.provider ===
				"demo",
		}),
	);

	app.register(async (owner) => {
		owner.addHook("preHandler", guard);

		owner.get("/api/overview", async (): Promise<OverviewView> => {
			const company = await store.graph.getCompany();
			const dream = (await store.graph.listNodes()).find(
				(n) => n.kind === "dream",
			);
			const vitals = await computeVitals(store, { dataDir: deps.dataDir });
			const pending = await store.approvals.list({ status: "pending" });
			const issues = await openIssues(store);
			const config = (dream?.config ?? {}) as {
				vision?: string;
				objective?: string;
				constraints?: string[];
				outcomes?: string[];
			};
			return {
				company,
				// The charter in its own words; `dream` is the code name, kept
				// for clients that read it.
				charter: dream
					? {
							vision: config.vision ?? null,
							mission: config.objective ?? null,
							values: config.constraints ?? [],
							goals: config.outcomes ?? [],
						}
					: null,
				dream: dream?.config ?? null,
				vitals,
				pendingApprovals: pending.length,
				issues,
			};
		});

		owner.get("/api/map", async (): Promise<MapView> => {
			// Retired agents are history, not part of the map.
			const nodes = (await store.graph.listNodes()).filter(
				(n) => !isRetired(n),
			);
			const edges = await store.graph.listEdges();
			return {
				nodes: nodes.map((n) => ({
					id: n.id,
					key: n.key,
					kind: n.kind,
					name: n.name,
					config: n.config,
					refId: n.refId,
				})),
				edges: edges.map((e) => ({
					id: e.id,
					from: e.fromNodeId,
					to: e.toNodeId,
					relation: e.relation,
				})),
			};
		});

		owner.post<{ Params: { key: string }; Body: { ownerKey?: string } }>(
			"/api/responsibilities/:key/owner",
			async (req): Promise<ActionResult> => {
				return {
					message: await handleOwnerAction(
						store,
						`assign:${req.params.key}:${String(req.body?.ownerKey ?? "")}`,
						"the owner",
					),
				};
			},
		);

		// Agents (RUNTIME D47): what each does, changed only from here — by the
		// owner, never over MCP. A refusal is a sentence the page shows.
		const by = "the owner (console)";
		const refused = (reply: FastifyReply, err: unknown) => {
			if (err instanceof AgentError)
				return reply.code(400).send({ error: err.message });
			throw err;
		};
		owner.get("/api/agents", async (): Promise<AgentsView> => {
			const web = await store.settings.get<WebChatSettings>(WEBCHAT_SETTING);
			return agentsView(store, {
				channels: [
					{ id: "telegram", label: "Telegram" },
					...(web?.enabled ? [{ id: "web", label: "Web chat" }] : []),
				],
			});
		});
		owner.post<{ Body: AgentInput }>(
			"/api/agents",
			async (req, reply): Promise<ActionResult | FastifyReply> => {
				try {
					const { message } = await addAgent(store, req.body ?? {}, by);
					return { message };
				} catch (err) {
					return refused(reply, err);
				}
			},
		);
		owner.put<{ Params: { key: string }; Body: AgentInput }>(
			"/api/agents/:key",
			async (req, reply): Promise<ActionResult | FastifyReply> => {
				try {
					return {
						message: await updateAgent(
							store,
							req.params.key,
							req.body ?? {},
							by,
						),
					};
				} catch (err) {
					return refused(reply, err);
				}
			},
		);
		owner.put<{ Params: { key: string }; Body: AgentToolsInput }>(
			"/api/agents/:key/tools",
			async (req, reply): Promise<ActionResult | FastifyReply> => {
				const tools = req.body?.tools;
				if (!Array.isArray(tools) || !tools.every((t) => typeof t === "string"))
					return reply.code(400).send({ error: "Say which tools, as a list." });
				try {
					return {
						message: await setAgentTools(store, req.params.key, tools, by),
					};
				} catch (err) {
					return refused(reply, err);
				}
			},
		);
		owner.post<{ Params: { key: string } }>(
			"/api/agents/:key/retire",
			async (req, reply): Promise<ActionResult | FastifyReply> => {
				try {
					return { message: await retireAgent(store, req.params.key, by) };
				} catch (err) {
					return refused(reply, err);
				}
			},
		);

		// Stewards (RUNTIME D48): the people who run the company, changed only
		// from here, like agents.
		owner.get(
			"/api/stewards",
			async (): Promise<StewardsView> =>
				stewardsView(store, {
					paired: new Set(Object.keys(await deps.telegram.members())),
				}),
		);
		owner.post<{ Body: StewardInput }>(
			"/api/stewards",
			async (req, reply): Promise<ActionResult | FastifyReply> => {
				try {
					const { message } = await addSteward(store, req.body ?? {}, by);
					return { message };
				} catch (err) {
					return refused(reply, err);
				}
			},
		);
		owner.put<{ Params: { key: string }; Body: StewardInput }>(
			"/api/stewards/:key",
			async (req, reply): Promise<ActionResult | FastifyReply> => {
				try {
					return {
						message: await updateSteward(
							store,
							req.params.key,
							req.body ?? {},
							by,
						),
					};
				} catch (err) {
					return refused(reply, err);
				}
			},
		);
		owner.put<{
			Params: { key: string };
			Body: StewardResponsibilitiesInput;
		}>(
			"/api/stewards/:key/responsibilities",
			async (req, reply): Promise<ActionResult | FastifyReply> => {
				const keys = req.body?.responsibilities;
				if (!Array.isArray(keys) || !keys.every((k) => typeof k === "string"))
					return reply
						.code(400)
						.send({ error: "Say which responsibilities, as a list." });
				try {
					return {
						message: await setStewardResponsibilities(
							store,
							req.params.key,
							keys,
							by,
						),
					};
				} catch (err) {
					return refused(reply, err);
				}
			},
		);
		owner.post<{ Params: { key: string } }>(
			"/api/stewards/:key/retire",
			async (req, reply): Promise<ActionResult | FastifyReply> => {
				try {
					return {
						message: await retireMember(store, "human", req.params.key, by),
					};
				} catch (err) {
					return refused(reply, err);
				}
			},
		);
		// The contribution record (D54): owner only; people add to it with
		// /did on Telegram, and only the owner confirms and rewards.
		owner.get(
			"/api/contributions",
			async (): Promise<ContributionsView> => contributionsView(store),
		);
		owner.post<{ Body: ContributionInput }>(
			"/api/contributions",
			async (req, reply): Promise<ActionResult | FastifyReply> => {
				try {
					const { message } = await recordContribution(
						store,
						{ nodeKey: req.body?.nodeKey, what: req.body?.what },
						by,
						true,
					);
					return { message };
				} catch (err) {
					return refused(reply, err);
				}
			},
		);
		owner.post<{ Params: { id: string; answer: string } }>(
			"/api/contributions/:id/:answer",
			async (req, reply): Promise<ActionResult | FastifyReply> => {
				const { answer } = req.params;
				if (answer !== "confirm" && answer !== "decline")
					return reply.code(404).send({ error: "Not found." });
				try {
					const { message } = await decideContribution(
						store,
						req.params.id,
						answer === "confirm",
						by,
					);
					return { message };
				} catch (err) {
					return refused(reply, err);
				}
			},
		);
		owner.post<{ Body: RewardInput }>(
			"/api/rewards",
			async (req, reply): Promise<ActionResult | FastifyReply> => {
				try {
					return {
						message: await giveReward(
							store,
							{
								nodeKey: req.body?.nodeKey,
								note: req.body?.note,
								contributionId: req.body?.contributionId,
							},
							by,
						),
					};
				} catch (err) {
					return refused(reply, err);
				}
			},
		);

		// Open roles (D52): an invitation code for a role nobody owns, and the
		// owner's yes or no to whoever used it. Joining itself is on Telegram.
		owner.post<{ Params: { key: string } }>(
			"/api/roles/:key/invite",
			async (req, reply): Promise<RoleInviteCode | FastifyReply> => {
				try {
					const { code, expiresAt } = await createRoleInvite(
						store,
						req.params.key,
						by,
					);
					return { code, expiresAt, bot: deps.telegram.botName() };
				} catch (err) {
					return refused(reply, err);
				}
			},
		);
		owner.post<{ Params: { id: string; answer: string } }>(
			"/api/invites/:id/:answer",
			async (req, reply): Promise<ActionResult | FastifyReply> => {
				const { answer } = req.params;
				if (answer !== "approve" && answer !== "decline")
					return reply.code(404).send({ error: "Not found." });
				try {
					return {
						message: await deps.telegram.decideInvite(
							req.params.id,
							answer === "approve",
							by,
						),
					};
				} catch (err) {
					return refused(reply, err);
				}
			},
		);
		owner.post<{ Params: { key: string } }>(
			"/api/stewards/:key/pairing",
			async (req, reply): Promise<PairingCode | FastifyReply> => {
				try {
					return {
						code: await deps.telegram.createMemberPairingCode(req.params.key),
					};
				} catch (err) {
					return reply.code(400).send({ error: (err as Error).message });
				}
			},
		);

		owner.get<{ Querystring: { search?: string } }>(
			"/api/people",
			async (req): Promise<PersonRow[]> => {
				const people = await store.people.list({
					search: req.query.search ?? "",
					limit: 100,
				});
				return people.map((p) => ({
					id: p.id,
					name: p.displayName,
					email: p.email,
					phone: p.phone,
					lastInteractionAt: p.lastInteractionAt,
				}));
			},
		);

		owner.get<{ Params: { id: string } }>(
			"/api/people/:id",
			async (req, reply): Promise<PersonProfile | FastifyReply> => {
				const person = await store.people.get(req.params.id);
				if (!person) return reply.code(404).send({ error: "no such person" });
				return {
					person,
					identities: await store.people.listIdentities(person.id),
					memories: await store.memory.list({
						scope: "person",
						ownerId: person.id,
						limit: 100,
					}),
					conversations: await store.conversations.list({
						personId: person.id,
						limit: 20,
					}),
				};
			},
		);

		owner.get<{ Params: { id: string } }>(
			"/api/conversations/:id/messages",
			async (req): Promise<MessageRow[]> =>
				store.conversations.listMessages(req.params.id, { limit: 200 }),
		);

		owner.post<{ Body: { note?: string; personId?: string } }>(
			"/api/memory",
			async (req, reply) => {
				const note = String(req.body?.note ?? "").trim();
				if (note.length < 3)
					return reply
						.code(400)
						.send({ error: "write a note of at least 3 characters" });
				const personId = req.body?.personId;
				return store.memory.store({
					scope: personId ? "person" : "company",
					ownerId: personId ?? null,
					kind: "fact",
					content: note,
					source: "human",
				});
			},
		);

		owner.get<{ Querystring: { q?: string } }>("/api/memory", async (req) =>
			req.query.q
				? store.memory.search(req.query.q, { limit: 50 })
				: store.memory.list({ scope: "company", limit: 50 }),
		);

		owner.get("/api/runs", async (): Promise<RunsView> => {
			const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
			return {
				last30Days: await store.runs.totals({ since }),
				runs: await store.runs.list({ limit: 100 }),
			};
		});

		owner.get(
			"/api/approvals",
			async (): Promise<ApprovalsView> => ({
				pending: await store.approvals.list({ status: "pending", limit: 100 }),
			}),
		);

		owner.post<{
			Params: { id: string };
			Body: { approved?: boolean; note?: string };
		}>("/api/approvals/:id", async (req, reply) => {
			const approval = await store.approvals.get(req.params.id);
			if (!approval) return reply.code(404).send({ error: "no such approval" });
			if (approval.status !== "pending")
				return reply.code(409).send({ error: `already ${approval.status}` });
			await deps.decide(
				approval.id,
				req.body?.approved === true,
				"the owner (console)",
				req.body?.note,
			);
			return { ok: true };
		});

		owner.get(
			"/api/settings",
			async (): Promise<SettingsView> => ({
				model: await store.settings.get("model"),
				modelKeySet: (await deps.secrets.list()).includes("model.apiKey"),
				fallback: await store.settings.get("model.fallback"),
				fallbackKeySet: (await deps.secrets.list()).includes(
					"model.fallback.apiKey",
				),
				owner: await deps.telegram.owner(),
				successor: await deps.telegram.successor(),
				group: await deps.telegram
					.group()
					.then((g) =>
						g ? { title: g.title, connectedAt: g.connectedAt } : null,
					),
				survival: await store.settings.get("survival"),
				version: deps.version,
			}),
		);

		owner.put<{
			Body: {
				provider?: string;
				modelId?: string;
				apiKey?: string;
				baseUrl?: string;
			};
		}>("/api/settings/model", async (req, reply) => {
			const { provider, modelId, apiKey, baseUrl } = req.body ?? {};
			if (
				!provider ||
				!(MODEL_PROVIDERS as readonly string[]).includes(provider) ||
				!modelId
			) {
				return reply.code(400).send({
					error: `choose a provider (${MODEL_PROVIDERS.join(", ")}) and a model`,
				});
			}
			await store.settings.set("model", {
				provider,
				modelId,
				...(baseUrl ? { baseUrl } : {}),
			});
			if (apiKey) await deps.secrets.set("model.apiKey", apiKey);
			return { ok: true };
		});

		// The backup model (D57): answers when the first is down or rate-limited.
		owner.put<{
			Body: {
				provider?: string;
				modelId?: string;
				apiKey?: string;
				baseUrl?: string;
			};
		}>("/api/settings/model/fallback", async (req, reply) => {
			const { provider, modelId, apiKey, baseUrl } = req.body ?? {};
			if (
				!provider ||
				!(MODEL_PROVIDERS as readonly string[]).includes(provider) ||
				typeof modelId !== "string" ||
				!modelId.trim()
			)
				return reply.code(400).send({
					error: `choose a provider (${MODEL_PROVIDERS.join(", ")}) and a model`,
				});
			await store.settings.set("model.fallback", {
				provider,
				modelId: modelId.trim(),
				...(typeof baseUrl === "string" && baseUrl ? { baseUrl } : {}),
			});
			if (typeof apiKey === "string" && apiKey)
				await deps.secrets.set("model.fallback.apiKey", apiKey);
			return { ok: true };
		});
		owner.delete("/api/settings/model/fallback", async () => {
			await store.settings.delete("model.fallback");
			await deps.secrets.delete("model.fallback.apiKey");
			return { ok: true };
		});

		const webChat = async () => ({
			...WEBCHAT_DEFAULTS,
			...((await store.settings.get<Partial<WebChatSettings>>(
				WEBCHAT_SETTING,
			)) ?? {}),
		});
		owner.get("/api/webchat", webChat);
		owner.put<{ Body: { enabled?: unknown; dailyCapUsd?: unknown } }>(
			"/api/webchat",
			async (req, reply) => {
				try {
					const next = updateWebChatSettings(await webChat(), req.body ?? {});
					await store.settings.set(WEBCHAT_SETTING, next);
					return next;
				} catch (err) {
					return reply.code(400).send({ error: (err as Error).message });
				}
			},
		);

		// Outside agents connected as someone in the map (BLUEPRINT S8). The
		// token is shown once, here; only its hash is kept.
		const publicConnection = ({
			tokenHash: _h,
			refreshHash: _r,
			...c
		}: Connection) => c;
		owner.get("/api/mcp/connections", async () => ({
			connections: (await listConnections(store)).map(publicConnection),
		}));
		owner.post<{ Body: { nodeKey?: unknown; people?: unknown } }>(
			"/api/mcp/connections",
			async (req, reply) => {
				try {
					const { connection, token } = await addConnection(store, {
						nodeKey: String(req.body?.nodeKey ?? ""),
						access: req.body?.people === true ? "people" : "company",
					});
					return { connection: publicConnection(connection), token };
				} catch (err) {
					return reply.code(400).send({ error: (err as Error).message });
				}
			},
		);
		owner.delete<{ Params: { id: string } }>(
			"/api/mcp/connections/:id",
			async (req, reply) => {
				try {
					await revokeConnection(store, req.params.id);
					return { ok: true };
				} catch (err) {
					return reply.code(404).send({ error: (err as Error).message });
				}
			},
		);

		owner.post<{ Body: { role?: "owner" | "successor" } }>(
			"/api/pairing",
			async (req) => ({
				code: await deps.telegram.createPairingCode(
					req.body?.role === "successor" ? "successor" : "owner",
				),
			}),
		);

		owner.get(
			"/api/mcp",
			async (req): Promise<McpInfo> => ({
				url: `${req.protocol}://${req.headers.host ?? "127.0.0.1"}/mcp`,
				token: await deps.mcpToken(),
			}),
		);

		owner.get("/api/company.yaml", async (_req, reply) => {
			reply.header("content-type", "text/yaml; charset=utf-8");
			return stringifyCompanyFile(await exportCompanyFile(store.graph));
		});
	});
}

async function openIssues(
	store: CompanyStore,
): Promise<{ key: string; title: string; since: string }[]> {
	const resolved = new Map<string, number>();
	for (const e of await store.events.list({
		type: "issue.resolved",
		limit: 1000,
	})) {
		if (e.subject && !resolved.has(e.subject)) resolved.set(e.subject, e.seq);
	}
	const seen = new Set<string>();
	const open: { key: string; title: string; since: string }[] = [];
	for (const e of await store.events.list({
		type: "issue.opened",
		limit: 1000,
	})) {
		if (!e.subject || seen.has(e.subject)) continue;
		seen.add(e.subject);
		if (e.seq > (resolved.get(e.subject) ?? 0))
			open.push({ key: e.subject, title: String(e.data.title), since: e.time });
	}
	return open;
}
