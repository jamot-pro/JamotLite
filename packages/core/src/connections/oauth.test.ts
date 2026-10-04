import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCompanyFile } from "@jamot/company-file";
import type { CompanyStore } from "@jamot/ports";
import { openCompanyStore } from "@jamot/sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importCompanyFile } from "../company/import.js";
import {
	authenticateMcp,
	listConnections,
	revokeConnection,
} from "./connections.js";
import {
	fetchClientDocument,
	grantConnection,
	OAuthError,
	refreshConnection,
	registerClient,
	resolveClient,
} from "./oauth.js";

let store: CompanyStore;
let agentKey: string;
beforeEach(async () => {
	store = openCompanyStore(":memory:");
	const parsed = parseCompanyFile(
		readFileSync(
			fileURLToPath(
				new URL("../../../../templates/restaurant.yaml", import.meta.url),
			),
			"utf8",
		),
	);
	if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
	await importCompanyFile(store.graph, parsed.file);
	agentKey = (await store.graph.listNodes()).find((n) => n.kind === "agent")
		?.key as string;
});
afterEach(() => store.close());

/** A metadata document server that answers with `doc`. */
const serving =
	(doc: unknown, status = 200): typeof fetch =>
	async () =>
		new Response(JSON.stringify(doc), { status });
// A public address, so the outbound URL check passes without DNS.
const CLIENT_ID = "https://93.184.216.34/oauth/client.json";
const claude = { id: CLIENT_ID, name: "Claude", host: "93.184.216.34" };

const code = async (p: Promise<unknown>) =>
	p.then(
		() => "no error",
		(err: unknown) => (err instanceof OAuthError ? err.code : String(err)),
	);

describe("knowing the client (CIMD and registration)", () => {
	it("reads a client's metadata document, which must name itself", async () => {
		const client = await fetchClientDocument(
			CLIENT_ID,
			serving({
				client_id: CLIENT_ID,
				client_name: "Claude",
				redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
			}),
		);
		expect(client).toMatchObject({ kind: "document", clientName: "Claude" });

		const other = "https://93.184.216.34/other.json";
		expect(
			await code(
				fetchClientDocument(
					other,
					serving({ client_id: CLIENT_ID, redirect_uris: ["https://x.io/cb"] }),
				),
			),
		).toBe("invalid_client");
	});

	it("refuses client ids it must not fetch, and bad documents", async () => {
		const doc = (id: string) =>
			serving({ client_id: id, redirect_uris: ["https://x.io/cb"] });
		for (const id of [
			"http://93.184.216.34/client.json", // not HTTPS
			"https://93.184.216.34", // no path
			"https://127.0.0.1/client.json", // loopback
			"https://169.254.169.254/latest/meta-data", // cloud metadata
			"https://10.0.0.5/client.json", // private network
		])
			expect(await code(fetchClientDocument(id, doc(id)))).toBe(
				"invalid_client",
			);
		const id = "https://93.184.216.34/bad.json";
		expect(
			await code(
				fetchClientDocument(
					id,
					serving({ client_id: id, redirect_uris: ["javascript:alert(1)"] }),
				),
			),
		).toBe("invalid_client");
		expect(await code(fetchClientDocument(`${id}?404`, serving({}, 404)))).toBe(
			"invalid_client",
		);
	});

	it("registers public clients with HTTPS or localhost redirects only", async () => {
		const client = await registerClient(store, {
			client_name: "Claude",
			redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
		});
		expect(client.clientId).toMatch(/^dcr_/);
		expect(await resolveClient(store, client.clientId)).toEqual(client);
		expect(
			await code(
				registerClient(store, { redirect_uris: ["http://evil.io/cb"] }),
			),
		).toBe("invalid_redirect_uri");
		expect(
			await code(
				registerClient(store, {
					redirect_uris: ["https://x.io/cb"],
					token_endpoint_auth_method: "client_secret_basic",
				}),
			),
		).toBe("invalid_client_metadata");
		expect(await code(resolveClient(store, "dcr_nobody"))).toBe(
			"invalid_client",
		);
	});
});

describe("tokens", () => {
	it("a yes becomes a connection whose access token works for an hour", async () => {
		const now = new Date("2026-10-05T10:00:00Z");
		const tokens = await grantConnection(
			store,
			{ nodeKey: agentKey, access: "company", client: claude },
			now,
		);
		expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
		const [connection] = await listConnections(store);
		expect(connection).toMatchObject({ nodeKey: agentKey, client: claude });

		const at = (minutes: number) =>
			authenticateMcp(
				store,
				tokens.access_token,
				"shared",
				new Date(now.getTime() + minutes * 60_000),
			);
		expect(await at(59)).toMatchObject({
			kind: "connection",
			access: "company",
		});
		expect(await at(61)).toBeNull();
	});

	it("a refresh token works once, for its own client, until revoked", async () => {
		const now = new Date("2026-10-05T10:00:00Z");
		const first = await grantConnection(
			store,
			{ nodeKey: agentKey, access: "people", client: claude },
			now,
		);
		const later = new Date(now.getTime() + 2 * 3600_000);
		expect(
			await code(
				refreshConnection(store, first.refresh_token, "someone-else", later),
			),
		).toBe("invalid_grant");

		const second = await refreshConnection(
			store,
			first.refresh_token,
			CLIENT_ID,
			later,
		);
		expect(second.scope).toBe("company people");
		// The new access token works; the old one is gone; the old refresh too.
		expect(
			await authenticateMcp(store, second.access_token, "shared", later),
		).toMatchObject({ kind: "connection" });
		expect(
			await authenticateMcp(store, first.access_token, "shared", now),
		).toBeNull();
		expect(
			await code(
				refreshConnection(store, first.refresh_token, CLIENT_ID, later),
			),
		).toBe("invalid_grant");

		const [connection] = await listConnections(store);
		await revokeConnection(store, connection?.id as string);
		expect(
			await authenticateMcp(store, second.access_token, "shared", later),
		).toBeNull();
		expect(
			await code(
				refreshConnection(store, second.refresh_token, CLIENT_ID, later),
			),
		).toBe("invalid_grant");
	});

	it("two refreshes with one token, or a refresh racing a revoke: one wins", async () => {
		const now = new Date("2026-10-05T10:00:00Z");
		const later = new Date(now.getTime() + 2 * 3600_000);
		const tokens = await grantConnection(
			store,
			{ nodeKey: agentKey, access: "company", client: claude },
			now,
		);
		const both = await Promise.all([
			code(refreshConnection(store, tokens.refresh_token, CLIENT_ID, later)),
			code(refreshConnection(store, tokens.refresh_token, CLIENT_ID, later)),
		]);
		expect(both.sort()).toEqual(["invalid_grant", "no error"]);

		const [connection] = await listConnections(store);
		const next = await refreshConnection(
			store,
			// The winner's refresh token is the one now stored: get a fresh pair.
			(
				await grantConnection(
					store,
					{ nodeKey: agentKey, access: "company", client: claude },
					now,
				)
			).refresh_token,
			CLIENT_ID,
			later,
		);
		const id = /^jmt_([0-9a-f]{12})_/.exec(next.access_token)?.[1] as string;
		await Promise.all([
			revokeConnection(store, id),
			refreshConnection(store, next.refresh_token, CLIENT_ID, later).catch(
				() => null,
			),
		]);
		const after = (await listConnections(store)).find((c) => c.id === id);
		expect(after?.revokedAt).not.toBeNull();
		expect(connection?.revokedAt).toBeNull();
	});

	it("a refresh token ends after 30 days", async () => {
		const now = new Date("2026-10-05T10:00:00Z");
		const tokens = await grantConnection(
			store,
			{ nodeKey: agentKey, access: "company", client: claude },
			now,
		);
		expect(
			await code(
				refreshConnection(
					store,
					tokens.refresh_token,
					CLIENT_ID,
					new Date(now.getTime() + 31 * 86_400_000),
				),
			),
		).toBe("invalid_grant");
	});
});
