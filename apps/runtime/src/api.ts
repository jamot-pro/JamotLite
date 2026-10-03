import { stringifyCompanyFile } from "@jamot/company-file";
import {
	computeVitals,
	exportCompanyFile,
	handleOwnerAction,
	type Secrets,
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

	app.get("/api/me", async (req) => ({
		signedIn: signedIn(req),
		passwordSet: (await store.settings.get(PASSWORD_SETTING)) !== null,
	}));

	app.register(async (owner) => {
		owner.addHook("preHandler", guard);

		owner.get("/api/overview", async () => {
			const company = await store.graph.getCompany();
			const dream = (await store.graph.listNodes()).find(
				(n) => n.kind === "dream",
			);
			const vitals = await computeVitals(store, { dataDir: deps.dataDir });
			const pending = await store.approvals.list({ status: "pending" });
			const issues = await openIssues(store);
			return {
				company,
				dream: dream?.config ?? null,
				vitals,
				pendingApprovals: pending.length,
				issues,
			};
		});

		owner.get("/api/map", async () => {
			const nodes = await store.graph.listNodes();
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
			async (req) => {
				return {
					message: await handleOwnerAction(
						store,
						`assign:${req.params.key}:${String(req.body?.ownerKey ?? "")}`,
						"the owner",
					),
				};
			},
		);

		owner.get<{ Querystring: { search?: string } }>(
			"/api/people",
			async (req) => {
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
			async (req, reply) => {
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
			async (req) =>
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

		owner.get("/api/runs", async () => {
			const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
			return {
				last30Days: await store.runs.totals({ since }),
				runs: await store.runs.list({ limit: 100 }),
			};
		});

		owner.get("/api/approvals", async () => ({
			pending: await store.approvals.list({ status: "pending", limit: 100 }),
		}));

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

		owner.get("/api/settings", async () => ({
			model: await store.settings.get("model"),
			modelKeySet: (await deps.secrets.list()).includes("model.apiKey"),
			owner: await deps.telegram.owner(),
			successor: await deps.telegram.successor(),
			survival: await store.settings.get("survival"),
			version: deps.version,
		}));

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

		owner.post<{ Body: { role?: "owner" | "successor" } }>(
			"/api/pairing",
			async (req) => ({
				code: await deps.telegram.createPairingCode(
					req.body?.role === "successor" ? "successor" : "owner",
				),
			}),
		);

		owner.get("/api/mcp", async (req) => ({
			url: `${req.protocol}://${req.headers.host ?? "127.0.0.1"}/mcp`,
			token: await deps.mcpToken(),
		}));

		owner.get("/api/company.yaml", async (_req, reply) => {
			reply.header("content-type", "text/yaml; charset=utf-8");
			return stringifyCompanyFile(await exportCompanyFile(store.graph));
		});
	});
}

async function openIssues(
	store: CompanyStore,
): Promise<{ key: string; title: unknown; since: string }[]> {
	const resolved = new Map<string, number>();
	for (const e of await store.events.list({
		type: "issue.resolved",
		limit: 1000,
	})) {
		if (e.subject && !resolved.has(e.subject)) resolved.set(e.subject, e.seq);
	}
	const seen = new Set<string>();
	const open: { key: string; title: unknown; since: string }[] = [];
	for (const e of await store.events.list({
		type: "issue.opened",
		limit: 1000,
	})) {
		if (!e.subject || seen.has(e.subject)) continue;
		seen.add(e.subject);
		if (e.seq > (resolved.get(e.subject) ?? 0))
			open.push({ key: e.subject, title: e.data.title, since: e.time });
	}
	return open;
}
