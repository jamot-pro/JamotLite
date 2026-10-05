import { createHash, randomBytes } from "node:crypto";
import {
	type ConnectionAccess,
	grantConnection,
	hostOf,
	isRetired,
	loopbackOnly,
	type OAuthClient,
	type OAuthClientRef,
	OAuthError,
	refreshConnection,
	registerClient,
	resolveClient,
} from "@jamot/core";
import type { CompanyStore } from "@jamot/ports";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PASSWORD_SETTING, verifyPassword } from "./auth.js";

/**
 * MCP authorization over HTTP (RUNTIME D44): what lets an OAuth-only MCP
 * client — claude.ai's custom connectors — connect to the company.
 *
 * - `/.well-known/oauth-protected-resource[/mcp]` says `/mcp` is signed into
 *   here; `/.well-known/oauth-authorization-server` says how.
 * - `/oauth/register` lets a client register itself (RFC 7591); a client may
 *   instead use the URL of its own metadata document as its id (CIMD).
 * - `/oauth/authorize` is the consent page: the owner sees which client
 *   (by host, not only the name it gives itself), picks who in the company it
 *   connects as and whether it sees people, and says yes with the console
 *   password — asked every time, since this hands out access.
 * - `/oauth/token` swaps a code (with its PKCE verifier) or a refresh token for
 *   tokens. The access token is a connection token: everything D40 says about
 *   connections — runs, limits, proposals only — holds for it.
 */

export interface OAuthDeps {
	store: CompanyStore;
	/** The company's public address (https://…), when it can't be read from the request. */
	publicUrl?: string;
	/** Tests replace the fetch of client metadata documents. */
	fetch?: typeof fetch;
}

const CODE_MS = 10 * 60_000;
const SCOPES = ["company", "people"];

interface PendingCode {
	client: OAuthClientRef;
	redirectUri: string;
	challenge: string;
	nodeKey: string;
	access: ConnectionAccess;
	expiresAt: number;
}

const esc = (s: string) =>
	s.replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			] as string,
	);

const s256 = (verifier: string) =>
	createHash("sha256").update(verifier).digest("base64url");

/** Counts tries per address within a window; true while under the limit. */
function limiter(max: number, windowMs: number) {
	const tries = new Map<string, { count: number; since: number }>();
	return (key: string, now = Date.now()) => {
		const t = tries.get(key) ?? { count: 0, since: now };
		if (now - t.since > windowMs) Object.assign(t, { count: 0, since: now });
		t.count++;
		tries.set(key, t);
		if (tries.size > 10_000) tries.clear();
		return t.count <= max;
	};
}

export function registerOAuth(app: FastifyInstance, deps: OAuthDeps): void {
	const { store } = deps;
	const codes = new Map<string, PendingCode>();
	const passwordTries = limiter(5, 60_000);
	const registrations = limiter(10, 3_600_000);

	const base = (req: FastifyRequest) =>
		(deps.publicUrl ?? `${req.protocol}://${req.host}`).replace(/\/+$/, "");
	const resourceOf = (req: FastifyRequest) => `${base(req)}/mcp`;
	/** The resource a client named is this company's /mcp (or its origin). */
	const ours = (req: FastifyRequest, resource: string | undefined) => {
		if (!resource) return true;
		let given: string;
		try {
			const u = new URL(resource);
			given = `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, "");
		} catch {
			return false;
		}
		return given === resourceOf(req) || given === base(req);
	};

	// Discovery documents and the endpoints clients call from anywhere: no
	// cookies are read there, so any origin may.
	const open = (reply: FastifyReply) =>
		reply
			.header("access-control-allow-origin", "*")
			.header("access-control-allow-headers", "content-type, authorization")
			.header("access-control-allow-methods", "GET, POST, OPTIONS");

	const protectedResource = async (req: FastifyRequest, reply: FastifyReply) =>
		open(reply).send({
			resource: resourceOf(req),
			authorization_servers: [base(req)],
			scopes_supported: SCOPES,
			bearer_methods_supported: ["header"],
			resource_name: (await store.graph.getCompany())?.name ?? "Jamot company",
		});
	app.get("/.well-known/oauth-protected-resource", protectedResource);
	app.get("/.well-known/oauth-protected-resource/mcp", protectedResource);

	app.get("/.well-known/oauth-authorization-server", async (req, reply) =>
		open(reply).send({
			issuer: base(req),
			authorization_endpoint: `${base(req)}/oauth/authorize`,
			token_endpoint: `${base(req)}/oauth/token`,
			registration_endpoint: `${base(req)}/oauth/register`,
			response_types_supported: ["code"],
			grant_types_supported: ["authorization_code", "refresh_token"],
			code_challenge_methods_supported: ["S256"],
			token_endpoint_auth_methods_supported: ["none"],
			scopes_supported: SCOPES,
			client_id_metadata_document_supported: true,
			authorization_response_iss_parameter_supported: true,
		}),
	);

	app.register(async (oauth) => {
		// Forms, here only: the consent page and token requests are form posts.
		oauth.addContentTypeParser(
			"application/x-www-form-urlencoded",
			{ parseAs: "string", bodyLimit: 16_384 },
			(_req, body, done) =>
				done(null, Object.fromEntries(new URLSearchParams(String(body)))),
		);
		for (const path of ["/oauth/register", "/oauth/token"])
			oauth.options(path, async (_req, reply) => open(reply).code(204).send());

		oauth.post("/oauth/register", async (req, reply) => {
			open(reply);
			if (!registrations(req.ip))
				return reply.code(429).send({
					error: "invalid_client_metadata",
					error_description: "too many registrations — try again later",
				});
			try {
				const client = await registerClient(store, req.body);
				return reply.code(201).send({
					client_id: client.clientId,
					client_id_issued_at: Math.floor(
						Date.parse(client.registeredAt ?? "") / 1000,
					),
					client_name: client.clientName,
					redirect_uris: client.redirectUris,
					token_endpoint_auth_method: "none",
					grant_types: ["authorization_code", "refresh_token"],
					response_types: ["code"],
				});
			} catch (err) {
				return oauthError(reply, err);
			}
		});

		const back = (
			reply: FastifyReply,
			redirectUri: string,
			req: FastifyRequest,
			params: Record<string, string | undefined>,
		) => {
			const to = new URL(redirectUri);
			for (const [k, v] of Object.entries({ ...params, iss: base(req) }))
				if (v !== undefined) to.searchParams.set(k, v);
			return reply.code(302).header("location", to.toString()).send();
		};

		/**
		 * Checks an authorization request. Until the client and its redirect are
		 * known, a problem is shown here; after, it goes back to the client.
		 */
		const checkRequest = async (
			req: FastifyRequest,
			reply: FastifyReply,
			q: Record<string, string | undefined>,
		): Promise<{ client: OAuthClient; redirectUri: string } | null> => {
			let client: OAuthClient;
			try {
				client = await resolveClient(store, q.client_id ?? "", deps.fetch);
			} catch (err) {
				await page(
					reply,
					400,
					"This app can't connect",
					`<p>${esc((err as Error).message)}</p>`,
				);
				return null;
			}
			const redirectUri = q.redirect_uri ?? "";
			if (!client.redirectUris.includes(redirectUri)) {
				await page(
					reply,
					400,
					"This app can't connect",
					"<p>It asked to be sent back to an address it never declared.</p>",
				);
				return null;
			}
			const fail = (error: string, description: string) => {
				back(reply, redirectUri, req, {
					error,
					error_description: description,
					...(q.state ? { state: q.state } : {}),
				});
				return null;
			};
			if (q.response_type !== "code")
				return fail("unsupported_response_type", "only response_type=code");
			if (!q.code_challenge || q.code_challenge_method !== "S256")
				return fail("invalid_request", "PKCE with S256 is required");
			if (!ours(req, q.resource))
				return fail(
					"invalid_target",
					"this server only grants access to its own /mcp",
				);
			return { client, redirectUri };
		};

		oauth.get<{ Querystring: Record<string, string | undefined> }>(
			"/oauth/authorize",
			async (req, reply) => {
				const ok = await checkRequest(req, reply, req.query);
				if (!ok) return reply;
				return consent(reply, req.query, ok.client, ok.redirectUri, null, 200);
			},
		);

		oauth.post<{ Body: Record<string, string | undefined> }>(
			"/oauth/authorize",
			async (req, reply) => {
				const q = req.body ?? {};
				const ok = await checkRequest(req, reply, q);
				if (!ok) return reply;
				const { client, redirectUri } = ok;
				const state = q.state ? { state: q.state } : {};
				if (q.decision !== "allow")
					return back(reply, redirectUri, req, {
						error: "access_denied",
						error_description: "the owner said no",
						...state,
					});
				const again = (why: string, status: number) =>
					consent(reply, q, client, redirectUri, why, status);
				if (!passwordTries(req.ip))
					return again("Too many tries — wait a minute.", 429);
				const stored = await store.settings.get<string>(PASSWORD_SETTING);
				if (!stored)
					return again(
						"No console password is set yet — run `jamot setup`.",
						409,
					);
				if (!(await verifyPassword(String(q.password ?? ""), stored)))
					return again("That password is wrong.", 401);
				const node = (await store.graph.listNodes()).find(
					(n) =>
						n.key === q.node &&
						(n.kind === "agent" || n.kind === "human") &&
						!isRetired(n),
				);
				if (!node) return again("Choose who this app connects as.", 400);

				const now = Date.now();
				for (const [k, v] of codes) if (v.expiresAt < now) codes.delete(k);
				if (codes.size > 100)
					return again(
						"Too many sign-ins waiting — try again in a few minutes.",
						429,
					);
				const code = randomBytes(32).toString("base64url");
				codes.set(code, {
					client: {
						id: client.clientId,
						name: client.clientName,
						host: hostOf(client, redirectUri),
					},
					redirectUri,
					challenge: String(q.code_challenge),
					nodeKey: node.key,
					access: q.people === "on" ? "people" : "company",
					expiresAt: now + CODE_MS,
				});
				return back(reply, redirectUri, req, { code, ...state });
			},
		);

		oauth.post<{ Body: Record<string, string | undefined> }>(
			"/oauth/token",
			async (req, reply) => {
				open(reply).header("cache-control", "no-store");
				const b = req.body ?? {};
				try {
					if (b.grant_type === "refresh_token") {
						if (!ours(req, b.resource))
							throw new OAuthError("invalid_target", "not this server's /mcp");
						return await refreshConnection(
							store,
							String(b.refresh_token ?? ""),
							String(b.client_id ?? ""),
						);
					}
					if (b.grant_type !== "authorization_code")
						throw new OAuthError(
							"unsupported_grant_type",
							"authorization_code or refresh_token",
						);
					const pending = codes.get(String(b.code ?? ""));
					// A code works once, whatever happens next.
					codes.delete(String(b.code ?? ""));
					if (
						!pending ||
						pending.expiresAt < Date.now() ||
						pending.client.id !== b.client_id ||
						pending.redirectUri !== b.redirect_uri ||
						s256(String(b.code_verifier ?? "")) !== pending.challenge
					)
						throw new OAuthError("invalid_grant", "that code doesn't work");
					if (!ours(req, b.resource))
						throw new OAuthError("invalid_target", "not this server's /mcp");
					return await grantConnection(store, {
						nodeKey: pending.nodeKey,
						access: pending.access,
						client: pending.client,
					});
				} catch (err) {
					return oauthError(reply, err);
				}
			},
		);

		/** The consent page: who's asking, as whom, and the owner's yes. */
		async function consent(
			reply: FastifyReply,
			q: Record<string, string | undefined>,
			client: OAuthClient,
			redirectUri: string,
			problem: string | null,
			status: number,
		) {
			const company = (await store.graph.getCompany())?.name ?? "this company";
			const nodes = (await store.graph.listNodes()).filter(
				(n) => (n.kind === "agent" || n.kind === "human") && !isRetired(n),
			);
			const host = hostOf(client, redirectUri);
			const keep = [
				"response_type",
				"client_id",
				"redirect_uri",
				"code_challenge",
				"code_challenge_method",
				"state",
				"scope",
				"resource",
			]
				.filter((k) => q[k] !== undefined)
				.map(
					(k) =>
						`<input type="hidden" name="${k}" value="${esc(String(q[k]))}">`,
				)
				.join("");
			const options = nodes
				.map(
					(n) =>
						`<option value="${esc(n.key)}"${q.node === n.key ? " selected" : ""}>${esc(n.name)} (${n.kind === "agent" ? "agent" : "person"})</option>`,
				)
				.join("");
			const wantsPeople = (q.scope ?? "").split(" ").includes("people");
			const body = `
<p><strong>${esc(client.clientName)}</strong> from <strong>${esc(host)}</strong> wants to connect to <strong>${esc(company)}</strong> over MCP.</p>
${loopbackOnly(client) ? `<p class="warn">This app sends you back to an address on this computer (${esc(new URL(redirectUri).host)}). Any program on it could claim to be ${esc(client.clientName)}. Only go on if you just started this yourself.</p>` : ""}
<p>It will be able to read the company — its map, readiness and its own runs — and to <em>propose</em> actions, which wait for your approval on Telegram. It can never approve anything itself.</p>
${problem ? `<p class="error">${esc(problem)}</p>` : ""}
<form method="post" action="/oauth/authorize">
${keep}
<label>It connects as<select name="node" required>${options}</select></label>
<label class="check"><input type="checkbox" name="people"${q.people === "on" || (q.people === undefined && wantsPeople) ? " checked" : ""}> It may also see people and their conversations</label>
<label>Console password<input type="password" name="password" autocomplete="current-password" required></label>
<div class="buttons"><button name="decision" value="allow">Allow</button><button name="decision" value="deny" formnovalidate class="secondary">Deny</button></div>
</form>
<p class="small">You'll see it in <code>jamot mcp list</code>, and can end it any time with <code>jamot mcp revoke</code>.</p>`;
			return page(reply, status, "Connect an app?", body);
		}
	});
}

function oauthError(reply: FastifyReply, err: unknown) {
	if (err instanceof OAuthError)
		return reply
			.code(err.code === "invalid_client" ? 401 : 400)
			.send({ error: err.code, error_description: err.message });
	throw err;
}

/** A small page of our own; nothing loads from anywhere else. */
async function page(
	reply: FastifyReply,
	status: number,
	title: string,
	body: string,
) {
	return reply
		.code(status)
		.type("text/html; charset=utf-8")
		.header(
			"content-security-policy",
			"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
		)
		.header("cache-control", "no-store")
		.send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Jamot</title>
<style>
:root{color-scheme:light dark;--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--card:#fff;--line:#e7e5e4;--accent:#1d4ed8;--warn:#92400e;--warnbg:#fef3c7;--err:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--card:#292524;--line:#44403c;--accent:#93c5fd;--warn:#fde68a;--warnbg:#422006;--err:#fca5a5}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:30rem;margin:3rem auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:1.5rem}
h1{font-size:1.3rem;margin:0 0 1rem}
label{display:block;margin:1rem 0 .25rem;font-weight:600}
label.check{font-weight:400;display:flex;gap:.5rem;align-items:center}
select,input[type=password]{display:block;width:100%;box-sizing:border-box;margin-top:.35rem;padding:.55rem;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit}
.buttons{display:flex;gap:.5rem;margin-top:1.25rem}
button{flex:1;padding:.65rem;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:var(--card);font:inherit;font-weight:600;cursor:pointer}
button.secondary{background:transparent;color:var(--fg);border-color:var(--line)}
.warn{background:var(--warnbg);color:var(--warn);padding:.75rem;border-radius:8px}
.error{color:var(--err);font-weight:600}
.small{color:var(--muted);font-size:.875rem}
</style></head><body><main><div class="card"><h1>${esc(title)}</h1>${body}</div></main></body></html>`);
}
