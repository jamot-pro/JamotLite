import { existsSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import { handleMcpRequest } from "@jamot/mcp";
import type { CompanyStore } from "@jamot/ports";
import Fastify, {
	type FastifyInstance,
	type FastifyReply,
	type FastifyRequest,
} from "fastify";
import { type ApiDeps, registerApi } from "./api.js";

/**
 * The runtime's one HTTP port: `/health`; `/mcp`, the company as an MCP
 * server for the owner's AI; `/api`, the console's JSON API; and the web
 * console itself (a static single-page app).
 */
export interface HttpOptions {
	store: CompanyStore;
	mcpToken: string;
	version: string;
	dataDir: string;
	api?: ApiDeps;
	/** The built web console (`apps/web/dist`), when present. */
	webRoot?: string;
	/** One TLS proxy in front: `req.ip` is the client it forwarded for. */
	behindProxy?: boolean;
}

export function createHttpServer(opts: HttpOptions): FastifyInstance {
	const app = Fastify({
		logger: false,
		bodyLimit: 1024 * 1024,
		// Behind a proxy, trust only the hop that connected to us: `req.ip` is
		// the address it appended, never one a client wrote in the header.
		trustProxy: (_address: string, hop: number) =>
			opts.behindProxy === true && hop === 0,
		// Shutting down never waits on idle keep-alive clients.
		forceCloseConnections: true,
	});

	app.addHook("onSend", async (_req, reply) => {
		reply.header("x-content-type-options", "nosniff");
		reply.header("referrer-policy", "no-referrer");
		reply.header("x-frame-options", "DENY");
	});

	app.get("/health", async () => {
		const company = await opts.store.graph.getCompany();
		return { ok: true, company: company?.name ?? null, version: opts.version };
	});

	const mcp = async (request: FastifyRequest, reply: FastifyReply) => {
		// The MCP SDK writes the response itself.
		reply.hijack();
		await handleMcpRequest(request.raw, reply.raw, request.body, {
			store: opts.store,
			token: opts.mcpToken,
			version: opts.version,
			dataDir: opts.dataDir,
		});
	};
	app.post("/mcp", mcp);
	app.get("/mcp", mcp);
	app.delete("/mcp", mcp);

	if (opts.api) registerApi(app, opts.api);

	const webRoot = opts.webRoot;
	if (webRoot && existsSync(join(webRoot, "index.html"))) {
		// wildcard: files are looked up on each request, so a rebuilt console is served without a restart.
		app.register(fastifyStatic, {
			root: webRoot,
			wildcard: true,
			index: "index.html",
		});
		// The console routes in the browser: unknown GETs outside /api get the app.
		app.setNotFoundHandler((req, reply) => {
			// Page routes the console handles in the browser (/map, /people…) get
			// the app. A missing file (/assets/x.js) is a 404, never HTML.
			const path = req.url.split("?")[0] ?? "";
			const isPage =
				!path.startsWith("/api") &&
				!path.startsWith("/mcp") &&
				!/\.[a-z0-9]+$/i.test(path);
			if (req.method === "GET" && isPage) {
				return reply.type("text/html").sendFile("index.html");
			}
			return reply.code(404).send({ error: "not found" });
		});
	}

	return app;
}
