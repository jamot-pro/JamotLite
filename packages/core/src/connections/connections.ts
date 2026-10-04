import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { CompanyPorts, CompanyStore } from "@jamot/ports";

/**
 * Bring your own agent (BLUEPRINT S8, RUNTIME D40). An outside AI — Claude
 * Code, Hermes, OpenClaw — connects to the company over MCP *as someone in
 * it*: each connection has its own token, tied to an agent or a human in the
 * company map, and its own access. Every call it makes is recorded as that
 * node's activity, and it can propose but never act: a proposal is an
 * approval a person decides.
 *
 * Only a hash of each token is kept (in settings); the token is shown once.
 * The original shared token keeps working, with full access, until revoked.
 */

export const CONNECTIONS_SETTING = "mcp.connections";
export const SHARED_REVOKED_SETTING = "mcp.sharedRevoked";

/** What a connection may read. "company": the company itself — its map,
 *  readiness, its own memory and runs. "people": that, plus the people it
 *  knows and their conversations. */
export type ConnectionAccess = "company" | "people";

export interface Connection {
	id: string;
	/** The node in the company map this connection acts as. */
	nodeKey: string;
	nodeName: string;
	access: ConnectionAccess;
	tokenHash: string;
	createdAt: string;
	revokedAt: string | null;
	/** Signed in over OAuth (an MCP client such as claude.ai) rather than
	 *  given a token by hand: which client, and when its access token ends. */
	client?: OAuthClientRef;
	expiresAt?: string | null;
	/** The current refresh token's hash, and when it ends (rotated on use). */
	refreshHash?: string;
	refreshExpiresAt?: string;
}

/** The client a connection signed in with, as the owner saw it on consent. */
export interface OAuthClientRef {
	id: string;
	name: string;
	/** The host its client id or redirect lives on, e.g. claude.ai. */
	host: string;
}

/** Who is on the other end of an MCP request. */
export type McpCaller =
	| { kind: "shared"; access: "people" }
	| {
			kind: "connection";
			connectionId: string;
			nodeKey: string;
			nodeName: string;
			access: ConnectionAccess;
	  };

export const hashToken = (token: string) =>
	createHash("sha256").update(token).digest("base64url");

export const sameText = (a: string, b: string) => {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
};

export async function listConnections(
	store: CompanyPorts,
): Promise<Connection[]> {
	return (await store.settings.get<Connection[]>(CONNECTIONS_SETTING)) ?? [];
}

/** A new connection for an agent or human in the map. The token is returned once. */
export async function addConnection(
	store: CompanyStore,
	input: {
		nodeKey: string;
		access?: ConnectionAccess;
		/** OAuth sign-ins: the client, and how long the access token lasts. */
		client?: OAuthClientRef;
		ttlSeconds?: number;
	},
	now = new Date(),
): Promise<{ connection: Connection; token: string }> {
	// One transaction: the list is read and written whole, so nothing else
	// (a refresh, a revoke) may slip in between.
	return store.transaction(async (tx) => {
		const node = (await tx.graph.listNodes()).find(
			(n) =>
				n.key === input.nodeKey && (n.kind === "agent" || n.kind === "human"),
		);
		if (!node)
			throw new Error(
				`no agent or person "${input.nodeKey}" in the company map — add them to company.yaml first`,
			);
		const id = randomBytes(6).toString("hex");
		const token = `jmt_${id}_${randomBytes(32).toString("base64url")}`;
		const connection: Connection = {
			id,
			nodeKey: node.key,
			nodeName: node.name,
			access: input.access ?? "company",
			tokenHash: hashToken(token),
			createdAt: now.toISOString(),
			revokedAt: null,
			...(input.client
				? {
						client: input.client,
						expiresAt: new Date(
							now.getTime() + (input.ttlSeconds ?? 3600) * 1000,
						).toISOString(),
					}
				: {}),
		};
		await tx.settings.set(CONNECTIONS_SETTING, [
			...(await listConnections(tx)),
			connection,
		]);
		await tx.events.append({
			type: "mcp.connected",
			source: "mcp",
			subject: node.key,
			data: {
				connectionId: id,
				access: connection.access,
				...(input.client ? { client: input.client.host } : {}),
			},
			idempotencyKey: `mcp-connected:${id}`,
		});
		return { connection, token };
	});
}

/** Revokes a connection by id, or the original shared token with "shared". */
export async function revokeConnection(
	store: CompanyStore,
	id: string,
	now = new Date(),
): Promise<void> {
	if (id === "shared") {
		await store.settings.set(SHARED_REVOKED_SETTING, now.toISOString());
		return;
	}
	return store.transaction(async (tx) => {
		const all = await listConnections(tx);
		const found = all.find((c) => c.id === id);
		if (!found) throw new Error(`no connection ${id} — see \`jamot mcp list\``);
		if (found.revokedAt) return;
		await tx.settings.set(
			CONNECTIONS_SETTING,
			all.map((c) =>
				c.id === id ? { ...c, revokedAt: now.toISOString() } : c,
			),
		);
		await tx.events.append({
			type: "mcp.revoked",
			source: "mcp",
			subject: found.nodeKey,
			data: { connectionId: id },
			idempotencyKey: `mcp-revoked:${id}`,
		});
	});
}

/** The caller a bearer token stands for, or null when it stands for nobody. */
export async function authenticateMcp(
	store: CompanyStore,
	token: string,
	sharedToken: string,
	now = new Date(),
): Promise<McpCaller | null> {
	if (!token) return null;
	const m = /^jmt_([0-9a-f]{12})_/.exec(token);
	if (m) {
		const connection = (await listConnections(store)).find(
			(c) => c.id === m[1],
		);
		if (
			!connection ||
			connection.revokedAt ||
			!sameText(hashToken(token), connection.tokenHash) ||
			(connection.expiresAt &&
				Date.parse(connection.expiresAt) <= now.getTime())
		)
			return null;
		// The node may have left the company map since.
		const node = (await store.graph.listNodes()).find(
			(n) => n.key === connection.nodeKey,
		);
		if (!node) return null;
		return {
			kind: "connection",
			connectionId: connection.id,
			nodeKey: node.key,
			nodeName: node.name,
			access: connection.access,
		};
	}
	if (await store.settings.get(SHARED_REVOKED_SETTING)) return null;
	return sameText(token, sharedToken)
		? { kind: "shared", access: "people" }
		: null;
}
