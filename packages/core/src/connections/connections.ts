import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { CompanyStore } from "@jamot/ports";

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

const hash = (token: string) =>
	createHash("sha256").update(token).digest("base64url");

const same = (a: string, b: string) => {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
};

export async function listConnections(
	store: CompanyStore,
): Promise<Connection[]> {
	return (await store.settings.get<Connection[]>(CONNECTIONS_SETTING)) ?? [];
}

/** A new connection for an agent or human in the map. The token is returned once. */
export async function addConnection(
	store: CompanyStore,
	input: { nodeKey: string; access?: ConnectionAccess },
	now = new Date(),
): Promise<{ connection: Connection; token: string }> {
	const node = (await store.graph.listNodes()).find(
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
		tokenHash: hash(token),
		createdAt: now.toISOString(),
		revokedAt: null,
	};
	await store.settings.set(CONNECTIONS_SETTING, [
		...(await listConnections(store)),
		connection,
	]);
	await store.events.append({
		type: "mcp.connected",
		source: "mcp",
		subject: node.key,
		data: { connectionId: id, access: connection.access },
		idempotencyKey: `mcp-connected:${id}`,
	});
	return { connection, token };
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
	const all = await listConnections(store);
	const found = all.find((c) => c.id === id);
	if (!found) throw new Error(`no connection ${id} — see \`jamot mcp list\``);
	if (found.revokedAt) return;
	await store.settings.set(
		CONNECTIONS_SETTING,
		all.map((c) => (c.id === id ? { ...c, revokedAt: now.toISOString() } : c)),
	);
	await store.events.append({
		type: "mcp.revoked",
		source: "mcp",
		subject: found.nodeKey,
		data: { connectionId: id },
		idempotencyKey: `mcp-revoked:${id}`,
	});
}

/** The caller a bearer token stands for, or null when it stands for nobody. */
export async function authenticateMcp(
	store: CompanyStore,
	token: string,
	sharedToken: string,
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
			!same(hash(token), connection.tokenHash)
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
	return same(token, sharedToken) ? { kind: "shared", access: "people" } : null;
}
