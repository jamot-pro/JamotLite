import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
	type BrainTool,
	connectModel,
	createPiBrain,
	DEMO_PROVIDER,
	demoModel,
	type ModelAccess,
	type ModelChoice,
	type RunOutcome,
} from "@jamot/brain";
import type { CompanyFile } from "@jamot/contracts";
import {
	agentSpecFromNode,
	budgetForTier,
	createSecretBox,
	createSecrets,
	createWorker,
	decideApproval,
	HEARTBEAT_JOB,
	handleOwnerAction,
	importCompanyFile,
	loadOrCreateSecretKey,
	planHeartbeats,
	REPLY_JOB,
	type ReplyDeps,
	replyToMessage,
	runHeartbeat,
	type Secrets,
	type Tier,
	type Worker,
} from "@jamot/core";
import { mcpToolsForAgent } from "@jamot/mcp";
import type { CompanyStore } from "@jamot/ports";
import { openCompanyStore } from "@jamot/sqlite";
import { createTelegramChannel, type TelegramChannel } from "@jamot/telegram";
import type { FastifyInstance } from "fastify";
import { Bot } from "grammy";
import { applyPendingRestore, backupIfDue } from "./backups.js";
import { createHttpServer } from "./http.js";
import { registerWebChat, type WebChat } from "./webchat.js";

/**
 * One company, one process (RUNTIME §3). Everything lives in `dataDir`:
 * `company.db` and `secrets.key`. This wires the parts together — store,
 * secrets, brain, job worker, Telegram — and runs them.
 */

export interface RuntimeOptions {
	dataDir: string;
	/** Tests pass a bot with a fake API; otherwise it's built from the stored token. */
	bot?: Bot;
	/** `false` runs without Telegram (`jamot start --no-telegram`): no bot
	 * token is needed, and anything that would reach Telegram fails loudly. */
	telegram?: boolean;
	/** Tests pass a fake model; otherwise it comes from settings and the secret store. */
	model?: () => Promise<ModelAccess>;
	/** More tools for agents (tests); MCP tools from the company map are added anyway. */
	extraTools?: (agentKey: string) => BrainTool[];
	/** HTTP port for `start()`, default 3000. */
	port?: number;
	/** Default 127.0.0.1; the Docker image sets 0.0.0.0. */
	host?: string;
	/** The built web console, served at `/`. */
	webRoot?: string;
	/** Served behind one TLS proxy (Render, Fly, Caddy): trust its client
	 * address for the login limit and mark the session cookie Secure. */
	behindProxy?: boolean;
	log?: (message: string) => void;
}

export interface Runtime {
	store: CompanyStore;
	secrets: Secrets;
	worker: Worker;
	telegram: TelegramChannel;
	/** Starts the company for a new install. Refuses a database that already has one. */
	importCompany(
		file: CompanyFile,
		founder?: { refId: string; name: string },
	): Promise<void>;
	/** Asks an agent something directly, outside any conversation (`jamot ask`). */
	ask(question: string, agentKey?: string): Promise<RunOutcome>;
	/** The token the owner's AI uses for `/mcp`. */
	mcpToken(): Promise<string>;
	/** Opens the HTTP port (`/mcp`, `/health`). Returns the address. `start()` does this too. */
	listen(port?: number, host?: string): Promise<string>;
	/** One pass of everything: due jobs, then queued messages. Tests drive the runtime with this. */
	tick(now?: Date): Promise<void>;
	/** Runs everything. `telegram: false` runs without the bot (console, MCP and heartbeats only). */
	start(opts?: { telegram?: boolean }): Promise<void>;
	stop(): Promise<void>;
}

/** Setting and secret names the runtime reads. */
export const MODEL_SETTING = "model";
export const MODEL_KEY_SECRET = "model.apiKey";
export const BOT_TOKEN_SECRET = "telegram.botToken";
export const MCP_TOKEN_SECRET = "mcp.token";
export const VERSION = "0.1.0";

export async function createRuntime(opts: RuntimeOptions): Promise<Runtime> {
	mkdirSync(opts.dataDir, { recursive: true, mode: 0o700 });
	const log = opts.log ?? ((m) => console.log(m));
	const setAside = applyPendingRestore(opts.dataDir);
	if (setAside)
		log(`[runtime] restored a backup; the company as it was is in ${setAside}`);
	const store = openCompanyStore(join(opts.dataDir, "company.db"));
	const secretKey = loadOrCreateSecretKey(join(opts.dataDir, "secrets.key"));
	const secrets = createSecrets(store.secrets, createSecretBox(secretKey));

	const brain = createPiBrain(store);
	const closed = await brain.recoverInterrupted();
	if (closed > 0)
		log(`[runtime] closed ${closed} run(s) left open by the last stop`);

	const model =
		opts.model ??
		(async () => {
			const choice =
				await store.settings.get<Omit<ModelChoice, "apiKey">>(MODEL_SETTING);
			if (!choice)
				throw new Error("no model is configured yet — run `jamot setup`");
			// The demo model runs demo companies only: never with real people on Telegram.
			if ((choice.provider as string) === DEMO_PROVIDER) {
				if (opts.telegram !== false)
					throw new Error(
						"the demo model only runs a demo company (no Telegram) — add a real model in Settings",
					);
				const company = await store.graph.getCompany();
				const dream = (await store.graph.listNodes()).find(
					(n) => n.kind === "dream",
				);
				return demoModel({
					name: company?.name ?? "this company",
					summary: company?.summary ?? "",
					vision:
						typeof dream?.config.vision === "string"
							? dream.config.vision
							: null,
				});
			}
			const apiKey = await secrets.get(MODEL_KEY_SECRET);
			return connectModel({ ...choice, ...(apiKey ? { apiKey } : {}) });
		});

	let bot = opts.bot;
	if (!bot) {
		const token = await secrets.get(BOT_TOKEN_SECRET);
		if (token) {
			bot = new Bot(token);
		} else if (opts.telegram === false) {
			// Console, MCP and heartbeats only (local development). The bot is
			// never started; a call that would reach Telegram says why it can't.
			bot = new Bot("0:telegram-off");
			bot.api.config.use(() => {
				throw new Error("Telegram is off for this run (--no-telegram)");
			});
		} else {
			store.close();
			throw new Error(
				"no Telegram bot token is stored yet — run `jamot setup`, or start with --no-telegram",
			);
		}
	}

	// `telegram` and `replyDeps` need each other: approvals go to the owner on
	// Telegram, and the owner's decisions come back through the brain.
	let telegram: TelegramChannel;
	const replyDeps: ReplyDeps = {
		store,
		brain,
		model,
		extraTools: async (agentKey) => [
			...(opts.extraTools?.(agentKey) ?? []),
			...(await mcpToolsForAgent(store, secrets, agentKey, { log })),
		],
		onApprovalNeeded: (ids) => telegram.askOwnerToApprove(ids),
		budget: async () =>
			budgetForTier(
				(await store.settings.get<Tier>("survival.tier")) ?? "normal",
			),
	};
	telegram = createTelegramChannel(bot, {
		store,
		log,
		decide: async (approvalId, approved, by) => {
			await decideApproval(replyDeps, { approvalId, approved, by });
		},
		act: (action, by) => handleOwnerAction(store, action, by),
	});

	const worker = createWorker(
		store,
		{
			[REPLY_JOB]: async (job) => {
				await replyToMessage(
					replyDeps,
					job.payload as { conversationId: string; messageId: string },
				);
			},
			[HEARTBEAT_JOB]: async (job) => {
				await runHeartbeat(
					{ store, notifier: telegram, dataDir: opts.dataDir },
					String(job.payload.heartbeat),
				);
			},
		},
		{ log },
	);

	let mcpToken = await secrets.get(MCP_TOKEN_SECRET);
	if (!mcpToken) {
		mcpToken = randomBytes(32).toString("base64url");
		await secrets.set(MCP_TOKEN_SECRET, mcpToken);
	}
	let http: FastifyInstance | null = null;
	let webchat: WebChat | null = null;
	const listen = async (
		port = opts.port ?? 3000,
		host = opts.host ?? "127.0.0.1",
	) => {
		if (!http)
			http = createHttpServer({
				store,
				mcpToken: mcpToken as string,
				version: VERSION,
				dataDir: opts.dataDir,
				...(opts.webRoot ? { webRoot: opts.webRoot } : {}),
				behindProxy: opts.behindProxy === true,
				onProposal: (ids) => telegram.askOwnerToApprove(ids),
				api: {
					store,
					secrets,
					secretKey,
					telegram,
					dataDir: opts.dataDir,
					version: VERSION,
					secureCookies: opts.behindProxy === true,
					mcpToken: async () => mcpToken as string,
					decide: async (approvalId, approved, by, note) => {
						await decideApproval(replyDeps, {
							approvalId,
							approved,
							by,
							...(note ? { note } : {}),
						});
					},
				},
			});
		if (!webchat)
			webchat = registerWebChat(http, {
				store,
				secretKey,
				notifier: telegram,
				secureCookies: opts.behindProxy === true,
				log,
			});
		return http.listen({ port, host });
	};

	let sender: NodeJS.Timeout | null = null;
	let planner: NodeJS.Timeout | null = null;
	let backups: NodeJS.Timeout | null = null;
	let webSender: NodeJS.Timeout | null = null;
	let delivering = false;
	let sending = false;

	return {
		store,
		secrets,
		worker,
		telegram,
		mcpToken: async () => mcpToken as string,
		async ask(question, agentKey) {
			const company = await store.graph.getCompany();
			const nodes = await store.graph.listNodes();
			const node = nodes.find(
				(n) => n.kind === "agent" && (!agentKey || n.key === agentKey),
			);
			if (!company || !node)
				throw new Error(
					agentKey ? `no agent "${agentKey}"` : "this company has no agent",
				);
			const dream = nodes.find((n) => n.kind === "dream")?.config as
				| { objective?: string; constraints?: string[] }
				| undefined;
			const spec = agentSpecFromNode({
				node,
				company,
				dream: dream?.objective
					? {
							objective: dream.objective,
							constraints: dream.constraints ?? [],
							outcomes: [],
							kpis: [],
							timeline: [],
							requiredCapabilities: [],
							requiredResponsibilities: [],
						}
					: null,
				model: await model(),
				tools: [],
			});
			return brain.run({
				agent: spec,
				sessionId: `cli:${node.key}`,
				input: question,
				trigger: "cli",
			});
		},
		listen,
		importCompany: (file, founder) =>
			importCompanyFile(store.graph, file, founder ? { founder } : {}),
		async tick(now) {
			await planHeartbeats(store, now);
			await worker.tick(now);
			await telegram.sendPending();
			await webchat?.deliver();
		},
		async start(startOpts = {}) {
			// The demo model never meets real people: with it, Telegram doesn't
			// come up at all — refused before anything starts, not per message.
			const choice = await store.settings.get<{ provider?: string }>(
				MODEL_SETTING,
			);
			if (choice?.provider === DEMO_PROVIDER && startOpts.telegram !== false)
				throw new Error(
					"this company runs on the demo model, which never talks to real people — start it with --no-telegram, or add a real model first (jamot setup / Settings)",
				);
			const address = await listen();
			log(`[runtime] listening on ${address} (MCP at ${address}/mcp)`);
			await planHeartbeats(store);
			planner = setInterval(() => {
				planHeartbeats(store).catch((err) =>
					log(
						`[runtime] planning heartbeats failed: ${err instanceof Error ? err.message : err}`,
					),
				);
			}, 30_000);
			worker.start(500);
			const backupNow = () =>
				backupIfDue(store, opts.dataDir)
					.then((file) => file && log(`[runtime] backed up to ${file}`))
					.catch((err) =>
						log(
							`[runtime] backup failed: ${err instanceof Error ? err.message : err}`,
						),
					);
			await backupNow();
			backups = setInterval(backupNow, 3_600_000);
			webSender = setInterval(() => {
				if (delivering) return;
				delivering = true;
				(webchat?.deliver() ?? Promise.resolve(0))
					.catch((err) =>
						log(
							`[runtime] web chat delivery failed: ${err instanceof Error ? err.message : err}`,
						),
					)
					.finally(() => {
						delivering = false;
					});
			}, 1000);
			if (startOpts.telegram === false) {
				log("[runtime] Telegram is off: no messages in or out");
			} else {
				sender = setInterval(() => {
					if (sending) return;
					sending = true;
					telegram
						.sendPending()
						.catch((err) =>
							log(
								`[runtime] sending failed: ${err instanceof Error ? err.message : err}`,
							),
						)
						.finally(() => {
							sending = false;
						});
				}, 1000);
				await telegram.start();
			}
			const company = await store.graph.getCompany();
			log(`[runtime] ${company?.name ?? "the company"} is running`);
		},
		async stop() {
			if (sender) clearInterval(sender);
			if (planner) clearInterval(planner);
			if (backups) clearInterval(backups);
			if (webSender) clearInterval(webSender);
			await telegram.stop().catch(() => undefined);
			await http?.close();
			await worker.stop();
			store.close();
		},
	};
}
