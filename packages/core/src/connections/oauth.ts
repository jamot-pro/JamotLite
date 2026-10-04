import { randomBytes } from "node:crypto";
import type { CompanyPorts, CompanyStore } from "@jamot/ports";
import { assertSafeUrl } from "../net/ssrf.js";
import {
	addConnection,
	CONNECTIONS_SETTING,
	type Connection,
	type ConnectionAccess,
	hashToken,
	listConnections,
	type OAuthClientRef,
	sameText,
} from "./connections.js";

/**
 * MCP authorization (RUNTIME D44): an MCP client that only signs in with
 * OAuth — claude.ai's custom connectors — connects as someone in the company,
 * like a hand-made connection (D40), after the owner says yes on a consent
 * page. This file is the part that doesn't need HTTP: knowing the client, and
 * the tokens.
 *
 * A client is either an HTTPS URL to its own metadata document (Client ID
 * Metadata Documents, what the MCP spec prefers) or a client that registered
 * itself (dynamic client registration, kept for clients that don't do CIMD
 * yet). Either way the redirect URI must be one the client declared, exactly.
 *
 * The owner's yes becomes a connection: its access token is the connection
 * token (an hour), with a refresh token (30 days) that changes at each use.
 * Revoking the connection ends both.
 */

export const OAUTH_CLIENTS_SETTING = "oauth.clients";
export const ACCESS_TOKEN_SECONDS = 3600;
export const REFRESH_TOKEN_DAYS = 30;
/** Registered clients kept; past this, the oldest is forgotten. */
const MAX_REGISTERED = 50;

export interface OAuthClient {
	clientId: string;
	clientName: string;
	redirectUris: string[];
	/** "document": the client id is the URL of its metadata (CIMD). */
	kind: "document" | "registered";
	registeredAt?: string;
}

/** An OAuth error, with the code the spec names (invalid_client…). */
export class OAuthError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

const isLoopback = (host: string) =>
	host === "localhost" || host === "127.0.0.1" || host === "[::1]";

/** A redirect URI a client may declare: HTTPS, or http on this machine. */
export function acceptableRedirect(uri: string): boolean {
	let u: URL;
	try {
		u = new URL(uri);
	} catch {
		return false;
	}
	if (u.hash || u.username || u.password) return false;
	if (u.protocol === "https:") return true;
	return u.protocol === "http:" && isLoopback(u.hostname);
}

/** Only loopback redirects: anyone on that machine could be this client. */
export function loopbackOnly(client: OAuthClient): boolean {
	return client.redirectUris.every((u) => isLoopback(new URL(u).hostname));
}

/** The host to show the owner: the client id's for CIMD, else the redirect's. */
export function hostOf(client: OAuthClient, redirectUri: string): string {
	return client.kind === "document"
		? new URL(client.clientId).host
		: new URL(redirectUri).host;
}

/** Dynamic client registration (RFC 7591), for public clients only. */
export async function registerClient(
	store: CompanyStore,
	body: unknown,
	now = new Date(),
): Promise<OAuthClient> {
	const b = (body ?? {}) as {
		redirect_uris?: unknown;
		client_name?: unknown;
		token_endpoint_auth_method?: unknown;
	};
	const uris = b.redirect_uris;
	if (
		!Array.isArray(uris) ||
		uris.length === 0 ||
		uris.length > 5 ||
		!uris.every((u) => typeof u === "string" && acceptableRedirect(u))
	)
		throw new OAuthError(
			"invalid_redirect_uri",
			"redirect_uris: one to five HTTPS (or localhost) URLs",
		);
	if (
		b.token_endpoint_auth_method !== undefined &&
		b.token_endpoint_auth_method !== "none"
	)
		throw new OAuthError(
			"invalid_client_metadata",
			'only public clients: token_endpoint_auth_method "none"',
		);
	const client: OAuthClient = {
		clientId: `dcr_${randomBytes(12).toString("hex")}`,
		clientName:
			typeof b.client_name === "string" && b.client_name.trim()
				? b.client_name.trim().slice(0, 80)
				: new URL(uris[0] as string).host,
		redirectUris: uris as string[],
		kind: "registered",
		registeredAt: now.toISOString(),
	};
	await store.transaction(async (tx) => {
		const all =
			(await tx.settings.get<OAuthClient[]>(OAUTH_CLIENTS_SETTING)) ?? [];
		await tx.settings.set(
			OAUTH_CLIENTS_SETTING,
			[...all, client].slice(-MAX_REGISTERED),
		);
	});
	return client;
}

type Fetch = typeof fetch;
const documents = new Map<string, { client: OAuthClient; until: number }>();
const DOCUMENT_CACHE_MS = 10 * 60_000;

/**
 * A client id that is a URL: fetch its metadata document — through the
 * outbound URL check (AGENTS.md rule 5), with no redirects, a 5 s limit and
 * at most 20 KB — and check it names itself.
 */
export async function fetchClientDocument(
	clientId: string,
	fetchFn: Fetch = fetch,
	now = Date.now(),
): Promise<OAuthClient> {
	const cached = documents.get(clientId);
	if (cached && cached.until > now) return cached.client;
	let url: URL;
	try {
		url = new URL(clientId);
	} catch {
		throw new OAuthError("invalid_client", "the client id isn't a URL");
	}
	if (url.protocol !== "https:" || url.pathname === "/" || url.hash)
		throw new OAuthError(
			"invalid_client",
			"a client id URL must be HTTPS, with a path",
		);
	try {
		await assertSafeUrl(clientId);
	} catch (err) {
		throw new OAuthError("invalid_client", (err as Error).message);
	}
	let doc: unknown;
	try {
		const res = await fetchFn(clientId, {
			redirect: "error",
			signal: AbortSignal.timeout(5_000),
			headers: { accept: "application/json" },
		});
		if (!res.ok) throw new Error(`it answered ${res.status}`);
		const body = await res.text();
		if (body.length > 20_000) throw new Error("the document is too large");
		doc = JSON.parse(body);
	} catch (err) {
		throw new OAuthError(
			"invalid_client",
			`couldn't read the client's metadata: ${(err as Error).message}`,
		);
	}
	const d = (doc ?? {}) as {
		client_id?: unknown;
		client_name?: unknown;
		redirect_uris?: unknown;
	};
	if (d.client_id !== clientId)
		throw new OAuthError(
			"invalid_client",
			"the metadata document names another client",
		);
	if (
		!Array.isArray(d.redirect_uris) ||
		d.redirect_uris.length === 0 ||
		!d.redirect_uris.every(
			(u) => typeof u === "string" && acceptableRedirect(u),
		)
	)
		throw new OAuthError(
			"invalid_client",
			"the metadata document has no usable redirect_uris",
		);
	const client: OAuthClient = {
		clientId,
		clientName:
			typeof d.client_name === "string" && d.client_name.trim()
				? d.client_name.trim().slice(0, 80)
				: url.host,
		redirectUris: d.redirect_uris as string[],
		kind: "document",
	};
	if (documents.size > 100) documents.clear();
	documents.set(clientId, { client, until: now + DOCUMENT_CACHE_MS });
	return client;
}

/** The client behind a client id, or an OAuthError. */
export async function resolveClient(
	store: CompanyStore,
	clientId: string,
	fetchFn?: Fetch,
): Promise<OAuthClient> {
	if (clientId.startsWith("https://"))
		return fetchClientDocument(clientId, fetchFn);
	const found = (
		(await store.settings.get<OAuthClient[]>(OAUTH_CLIENTS_SETTING)) ?? []
	).find((c) => c.clientId === clientId);
	if (!found) throw new OAuthError("invalid_client", "unknown client");
	return found;
}

export interface OAuthTokens {
	access_token: string;
	token_type: "Bearer";
	expires_in: number;
	refresh_token: string;
	scope: string;
}

const scopeOf = (access: ConnectionAccess) =>
	access === "people" ? "company people" : "company";

/** Writes a new refresh token (and `update`) onto a connection. Call it in a
 *  transaction, after checking the connection there. */
async function issueRefresh(
	tx: CompanyPorts,
	connectionId: string,
	now: Date,
	update: Partial<Connection> = {},
): Promise<string> {
	const refresh = `jmr_${connectionId}_${randomBytes(32).toString("base64url")}`;
	const all = await listConnections(tx);
	await tx.settings.set(
		CONNECTIONS_SETTING,
		all.map((c) =>
			c.id === connectionId
				? {
						...c,
						...update,
						refreshHash: hashToken(refresh),
						refreshExpiresAt: new Date(
							now.getTime() + REFRESH_TOKEN_DAYS * 86_400_000,
						).toISOString(),
					}
				: c,
		),
	);
	return refresh;
}

/** The owner said yes: a connection for the client, and its first tokens. */
export async function grantConnection(
	store: CompanyStore,
	input: { nodeKey: string; access: ConnectionAccess; client: OAuthClientRef },
	now = new Date(),
): Promise<OAuthTokens> {
	const { connection, token } = await addConnection(
		store,
		{ ...input, ttlSeconds: ACCESS_TOKEN_SECONDS },
		now,
	);
	return {
		access_token: token,
		token_type: "Bearer",
		expires_in: ACCESS_TOKEN_SECONDS,
		refresh_token: await store.transaction(async (tx) => {
			// Revoked in the moment since it was added: no refresh token.
			const current = (await listConnections(tx)).find(
				(c) => c.id === connection.id,
			);
			if (!current || current.revokedAt)
				throw new OAuthError("invalid_grant", "the connection was revoked");
			return issueRefresh(tx, connection.id, now);
		}),
		scope: scopeOf(connection.access),
	};
}

/**
 * A refresh token for fresh tokens. Each refresh token works once: a used
 * one, an expired one, or one of a revoked connection is refused.
 */
export async function refreshConnection(
	store: CompanyStore,
	refreshToken: string,
	clientId: string,
	now = new Date(),
): Promise<OAuthTokens> {
	const m = /^jmr_([0-9a-f]{12})_/.exec(refreshToken);
	// Checked and rotated in one transaction: two refreshes with one token,
	// or a refresh racing a revoke, can't both win.
	return store.transaction(async (tx) => {
		const connection = m
			? (await listConnections(tx)).find((c) => c.id === m[1])
			: undefined;
		if (
			!connection?.refreshHash ||
			connection.revokedAt ||
			connection.client?.id !== clientId ||
			!sameText(hashToken(refreshToken), connection.refreshHash) ||
			Date.parse(connection.refreshExpiresAt ?? "") <= now.getTime()
		)
			throw new OAuthError("invalid_grant", "that refresh token doesn't work");
		const access = `jmt_${connection.id}_${randomBytes(32).toString("base64url")}`;
		const refresh = await issueRefresh(tx, connection.id, now, {
			tokenHash: hashToken(access),
			expiresAt: new Date(
				now.getTime() + ACCESS_TOKEN_SECONDS * 1000,
			).toISOString(),
		});
		return {
			access_token: access,
			token_type: "Bearer",
			expires_in: ACCESS_TOKEN_SECONDS,
			refresh_token: refresh,
			scope: scopeOf(connection.access),
		};
	});
}
