import { createHash, randomBytes } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { connectModel, type ModelAccess } from "@jamot/brain";
import { stringifyCompanyFile } from "@jamot/company-file";
import type {
	ActionResult,
	Me,
	SetupAnswer,
	SetupDraft,
	SetupFinish,
	SetupState,
} from "@jamot/contracts";
import { loadOrCreateSecretKey } from "@jamot/core";
import { openCompanyStore } from "@jamot/sqlite";
import Fastify, { type FastifyInstance } from "fastify";
import { type Bot, InlineKeyboard } from "grammy";
import {
	createSessions,
	hashPassword,
	readCookie,
	SESSION_COOKIE,
	verifyPassword,
} from "../auth.js";
import {
	DEFAULT_MODELS,
	listTemplates,
	type SetupInput,
	setup,
	TELEGRAM_TOKEN,
} from "../cli/commands.js";
import { serveConsole } from "../http.js";
import { type Draft, draftCompany } from "./draft.js";
import { ANSWER_LIMIT, lines, QUESTIONS } from "./questions.js";

/**
 * The setup gate (RUNTIME D55). A runtime that starts with no company and no
 * template doesn't start the company: it runs this instead, on the same
 * port. The console shows only the setup interview (after the password); the
 * bot talks only to the founder, only about setup, and tells everyone else
 * the company isn't open yet. Agents, heartbeats, web chat and MCP don't
 * exist until the founder presses "Start my company" — then the company is
 * created and the full runtime starts in the same process.
 *
 * Answers are kept in `.setup/setup.json` next to where the company will
 * live, so a restart or redeploy in the middle loses nothing; the web and
 * Telegram read and write the same answers.
 */

export interface GateOptions {
	/** Where companies live (JAMOT_HOME). */
	home: string;
	/** `--data`: the company's folder, when given. */
	dataDir?: string;
	env: NodeJS.ProcessEnv;
	webRoot?: string;
	behindProxy?: boolean;
	/** The bot, already made from the token (tests pass a fake one). */
	bot?: Bot;
	/**
	 * The model that drafts the company (tests pass a fake one, or null for
	 * none); made from the env when absent.
	 */
	model?: ModelAccess | null;
	log?: (message: string) => void;
}

export interface Gate {
	app: FastifyInstance;
	/** Resolves with the company's folder once the founder starts it. */
	done: Promise<string>;
	/** Starts the bot's long polling, when there is a bot. */
	startBot(): Promise<void>;
	stop(): Promise<void>;
}

interface Founder {
	userId: string;
	chatId: string;
	name: string;
}

interface SetupFile {
	answers: Record<string, string>;
	skipped: string[];
	owner?: Founder;
	/** The company drafted from these answers (D56); cleared when one changes. */
	draft?: Draft;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const MAX_FAILED_CODES = 5;
/** Drafts per boot (D56). */
const MAX_DRAFTS = 10;
/** Wrong codes from anyone, per boot: Telegram accounts are free to make. */
const MAX_FAILED_CODES_IN_ALL = 50;

function newCode(): string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	return [...randomBytes(8)].map((b) => alphabet[b % alphabet.length]).join("");
}

const slug = (name: string) =>
	name
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40) || "company";

/** True when the runtime should open the gate instead of starting. */
export function wantsSetupGate(env: NodeJS.ProcessEnv): boolean {
	return !env.JAMOT_TEMPLATE && Boolean(env.JAMOT_PASSWORD);
}

export async function createSetupGate(opts: GateOptions): Promise<Gate> {
	const { env } = opts;
	const log = opts.log ?? ((m) => console.log(m));
	const stateDir = join(opts.dataDir ?? opts.home, ".setup");
	mkdirSync(stateDir, { recursive: true, mode: 0o700 });
	const statePath = join(stateDir, "setup.json");

	// What setup needs from the deploy, checked now rather than at the end.
	const password = env.JAMOT_PASSWORD ?? "";
	const passwordHash = await hashPassword(password); // throws when too short
	const token = env.JAMOT_TELEGRAM_TOKEN ?? "";
	if (!TELEGRAM_TOKEN.test(token))
		throw new Error(
			"set JAMOT_TELEGRAM_TOKEN to your bot's token (from @BotFather) to set the company up",
		);
	const model = modelFromEnv(env);
	// The model that drafts the company. Without one, the founder picks a template.
	let drafter: ModelAccess | null = opts.model ?? null;
	if (opts.model === undefined)
		try {
			drafter = connectModel(model);
		} catch (err) {
			log(
				`[setup] can't reach the model to draft the company (${err instanceof Error ? err.message : err}); the founder picks a template instead`,
			);
		}

	const secretKey = loadOrCreateSecretKey(join(stateDir, "secrets.key"));
	const sessions = createSessions(secretKey);
	const cookieFlags = `HttpOnly; SameSite=Strict; Path=/${opts.behindProxy ? "; Secure" : ""}`;

	const state: SetupFile = existsSync(statePath)
		? (JSON.parse(readFileSync(statePath, "utf8")) as SetupFile)
		: { answers: {}, skipped: [] };
	const save = () => {
		const tmp = `${statePath}.tmp`;
		writeFileSync(tmp, JSON.stringify(state, null, 1), { mode: 0o600 });
		renameSync(tmp, statePath);
	};
	// One change at a time: the web and Telegram share the answers.
	let queue: Promise<unknown> = Promise.resolve();
	const change = <T>(work: () => Promise<T> | T): Promise<T> => {
		const next = queue.then(work);
		queue = next.catch(() => undefined);
		return next;
	};

	// The code that claims the setup on Telegram: new on every boot, shown in
	// the logs and to the signed-in founder on the web.
	const code = state.owner ? null : newCode();
	const codeHash = code ? sha256(code) : null;
	const failedCodes = new Map<string, number>();
	let failedInAll = 0;

	const ready = () =>
		QUESTIONS.every((q) => !q.required || Boolean(state.answers[q.id]));
	const nextQuestion = () =>
		QUESTIONS.find(
			(q) => !state.answers[q.id] && !state.skipped.includes(q.id),
		) ?? null;

	async function answer(input: SetupAnswer): Promise<void> {
		const q = QUESTIONS.find((x) => x.id === input?.id);
		if (!q) throw new GateError("There's no such question.");
		if (typeof input.value !== "string")
			throw new GateError("Answer in words.");
		const value = input.value.trim();
		if (value.length > ANSWER_LIMIT)
			throw new GateError(
				`Keep it under ${ANSWER_LIMIT} characters: you can add detail later.`,
			);
		if (!value && q.required)
			throw new GateError("This one is needed to set the company up.");
		await change(() => {
			if (value !== (state.answers[q.id] ?? "")) delete state.draft;
			if (value) {
				state.answers[q.id] = value;
				state.skipped = state.skipped.filter((s) => s !== q.id);
			} else {
				delete state.answers[q.id];
				if (!state.skipped.includes(q.id)) state.skipped.push(q.id);
			}
			save();
		});
	}

	function view(): SetupState {
		return {
			questions: QUESTIONS,
			answers: state.answers,
			skipped: state.skipped,
			templates: listTemplates().map(({ id, name, summary }) => ({
				id,
				name,
				summary,
			})),
			telegram: {
				bot: botName(),
				owner: state.owner?.name ?? null,
				code: state.owner ? null : code,
			},
			ready: ready(),
			draft: state.draft?.view ?? null,
			canDraft: drafter !== null,
		};
	}

	/**
	 * Drafts the company from the answers (D56). One draft at a time; a draft
	 * made while an answer changed is dropped.
	 */
	let drafting: Promise<Draft> | null = null;
	// Each draft is a paid model call: a few are plenty.
	let drafts = 0;
	async function draft(again = false): Promise<Draft> {
		if (!drafter)
			throw new GateError(
				"There's no model to draft with. Pick the closest starting point instead.",
			);
		if (!ready())
			throw new GateError("Answer the questions marked as needed first.");
		if (state.draft && !again) return state.draft;
		if (drafting) return drafting;
		if (drafts >= MAX_DRAFTS)
			throw new GateError(
				`That's ${MAX_DRAFTS} drafts. Start from one, change an answer, or pick the closest starting point.`,
			);
		drafts++;
		const answers = { ...state.answers };
		drafting = draftCompany(
			drafter,
			answers,
			listTemplates(),
			env.JAMOT_TIMEZONE,
		)
			.then((d) =>
				change(() => {
					if (JSON.stringify(answers) === JSON.stringify(state.answers)) {
						state.draft = d;
						save();
					}
					return d;
				}),
			)
			.catch((err: unknown) => {
				log(
					`[setup] drafting failed: ${err instanceof Error ? err.message : err}`,
				);
				throw new GateError(
					"Jamot couldn't draft the company this time. Try again, or pick the closest starting point instead.",
				);
			})
			.finally(() => {
				drafting = null;
			});
		return drafting;
	}

	let resolveDone: (dir: string) => void = () => {};
	const done = new Promise<string>((r) => {
		resolveDone = r;
	});
	let finishing = false;
	/** The draft the company started from, for the founder's first steps. */
	let started: SetupDraft | null = null;
	const tellNextSteps = async () => {
		if (state.owner && started)
			await say(state.owner.chatId, nextSteps(started));
	};

	/** Creates the company: from the draft, or from the answers and a template. */
	async function finish(input: SetupFinish): Promise<string> {
		if (finishing) throw new GateError("The company is already starting.");
		if (!ready())
			throw new GateError("Answer the questions marked as needed first.");
		const template = input?.template
			? listTemplates().find((t) => t.id === input.template)
			: undefined;
		if (input?.template && !template)
			throw new GateError("Pick a starting point from the list.");
		const drafted = template ? undefined : state.draft;
		if (!template && !drafted)
			throw new GateError(
				"Draft the company first, or pick the closest starting point.",
			);
		finishing = true;
		try {
			const a = state.answers;
			let dir = opts.dataDir ?? join(opts.home, slug(a.name ?? ""));
			if (!opts.dataDir)
				for (let i = 2; existsSync(join(dir, "company.db")); i++)
					dir = join(opts.home, `${slug(a.name ?? "")}-${i}`);
			// The same key: the founder's console session carries on.
			mkdirSync(dir, { recursive: true, mode: 0o700 });
			if (!existsSync(join(dir, "secrets.key"))) {
				copyFileSync(join(stateDir, "secrets.key"), join(dir, "secrets.key"));
				chmodSync(join(dir, "secrets.key"), 0o600);
			}
			// A draft becomes a company file the setup reads like a template.
			let from = template?.id as string;
			if (drafted) {
				from = join(stateDir, "draft.company.yaml");
				writeFileSync(from, stringifyCompanyFile(drafted.file), {
					mode: 0o600,
				});
			}
			const c = drafted?.view.charter;
			const input: SetupInput = {
				dir,
				template: from,
				name: a.name as string,
				ownerName: a.founder as string,
				password,
				charter: c
					? {
							mission: c.mission,
							...(c.vision ? { vision: c.vision } : {}),
							goals: c.goals,
							values: c.values,
						}
					: {
							mission: a.what as string,
							...(a.why ? { vision: a.why } : {}),
							...(a.goals ? { goals: lines(a.goals) } : {}),
							...(a.never ? { values: lines(a.never) } : {}),
						},
				model,
				telegramToken: token,
				...(env.JAMOT_TIMEZONE ? { timezone: env.JAMOT_TIMEZONE } : {}),
			};
			await setup(input);
			await keepAnswers(dir, state);
			started = drafted?.view ?? null;
			rmSync(stateDir, { recursive: true, force: true });
			log(`[setup] ${a.name} is set up in ${dir}; starting it`);
			resolveDone(dir);
			return `${a.name} is set up. Starting it now…`;
		} catch (err) {
			finishing = false;
			throw err;
		}
	}

	// ── The web ──────────────────────────────────────────────────────────

	const app = Fastify({
		logger: false,
		bodyLimit: 64 * 1024,
		trustProxy: (_address: string, hop: number) =>
			opts.behindProxy === true && hop === 0,
		forceCloseConnections: true,
	});
	app.addHook("onSend", async (_req, reply) => {
		reply.header("x-content-type-options", "nosniff");
		reply.header("referrer-policy", "no-referrer");
		reply.header("x-frame-options", "DENY");
		if (opts.behindProxy)
			reply.header("strict-transport-security", "max-age=31536000");
	});
	// Nothing of the company exists yet: say so instead of a 404.
	const OPEN = new Set([
		"/api/me",
		"/api/login",
		"/api/logout",
		"/api/setup",
		"/api/setup/answer",
		"/api/setup/draft",
		"/api/setup/finish",
	]);
	app.addHook("onRequest", async (req, reply) => {
		const path = req.url.split("?")[0] ?? "";
		const closed =
			(path.startsWith("/api") && !OPEN.has(path)) ||
			path.startsWith("/mcp") ||
			path.startsWith("/oauth") ||
			path.startsWith("/.well-known") ||
			path.startsWith("/chat");
		if (closed)
			return reply
				.code(503)
				.send({ error: "Jamot is being set up: finish the setup first." });
	});

	app.get("/health", async () => ({ ok: true, setup: true, company: null }));

	const signedIn = (cookie: string | undefined) =>
		sessions.valid(readCookie(cookie, SESSION_COOKIE));
	const attempts = new Map<string, { count: number; since: number }>();
	app.post<{ Body: { password?: string } }>(
		"/api/login",
		async (req, reply) => {
			const now = Date.now();
			const a = attempts.get(req.ip) ?? { count: 0, since: now };
			if (now - a.since > 60_000) Object.assign(a, { count: 0, since: now });
			if (++a.count > 5)
				return reply
					.code(429)
					.send({ error: "too many tries — wait a minute" });
			attempts.set(req.ip, a);
			if (
				!(await verifyPassword(String(req.body?.password ?? ""), passwordHash))
			)
				return reply.code(401).send({ error: "wrong password" });
			attempts.delete(req.ip);
			const { token: session, maxAgeSeconds } = sessions.issue();
			reply.header(
				"set-cookie",
				`${SESSION_COOKIE}=${session}; ${cookieFlags}; Max-Age=${maxAgeSeconds}`,
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
			signedIn: signedIn(req.headers.cookie),
			passwordSet: true,
			demo: false,
			setup: true,
		}),
	);

	app.register(async (owner) => {
		owner.addHook("preHandler", async (req, reply) => {
			if (!signedIn(req.headers.cookie))
				return reply.code(401).send({ error: "sign in first" });
		});
		owner.get("/api/setup", async (): Promise<SetupState> => view());
		owner.put<{ Body: SetupAnswer }>(
			"/api/setup/answer",
			async (req, reply): Promise<SetupState | undefined> => {
				try {
					await answer(req.body);
					await askNext(); // the founder may be following on Telegram
					return view();
				} catch (err) {
					return refuse(reply, err);
				}
			},
		);
		owner.post<{ Body: { again?: boolean } }>(
			"/api/setup/draft",
			async (req, reply): Promise<SetupState | undefined> => {
				try {
					await draft(req.body?.again === true);
					return view();
				} catch (err) {
					return refuse(reply, err);
				}
			},
		);
		owner.post<{ Body: SetupFinish }>(
			"/api/setup/finish",
			async (req, reply): Promise<ActionResult | undefined> => {
				try {
					const message = await change(() => finish(req.body));
					if (state.owner) await say(state.owner.chatId, message);
					await tellNextSteps();
					return { message };
				} catch (err) {
					return refuse(reply, err);
				}
			},
		);
	});

	if (opts.webRoot) serveConsole(app, opts.webRoot);

	// ── Telegram ─────────────────────────────────────────────────────────

	const bot = opts.bot ?? null;
	function botName(): string | null {
		try {
			return bot?.botInfo.username ?? null;
		} catch {
			return null; // not connected yet
		}
	}
	const say = (chatId: string, text: string, keyboard?: InlineKeyboard) =>
		bot
			? bot.api
					.sendMessage(chatId, text, keyboard ? { reply_markup: keyboard } : {})
					.then(() => undefined)
					.catch((err: unknown) =>
						log(
							`[setup] couldn't reach Telegram: ${err instanceof Error ? err.message : err}`,
						),
					)
			: Promise.resolve();

	/** Asks the founder the next question on Telegram, or for a starting point. */
	async function askNext(): Promise<void> {
		const owner = state.owner;
		if (!owner || !bot || finishing) return;
		const q = nextQuestion();
		if (q) {
			const n = QUESTIONS.indexOf(q) + 1;
			await say(
				owner.chatId,
				[
					`${n}/${QUESTIONS.length} · ${q.title}`,
					q.hint,
					q.required ? "" : "(Send /skip if you don't know yet.)",
				]
					.filter(Boolean)
					.join("\n"),
			);
			return;
		}
		if (drafter) {
			await say(owner.chatId, "That's everything. Drafting your company…");
			try {
				const d = await draft();
				// An answer changed while drafting: draft from the new answers.
				if (state.draft !== d) return askNext();
				await say(
					owner.chatId,
					`${draftText(d.view)}\n\nStart it like this? You can change everything later. (Send /back to change an answer.)`,
					new InlineKeyboard()
						.text("✅ Start my company", "setup:start")
						.row()
						.text("🔄 Draft again", "setup:redraft"),
				);
				return;
			} catch (err) {
				await say(
					owner.chatId,
					err instanceof Error ? err.message : String(err),
				);
			}
		}
		const keyboard = new InlineKeyboard();
		for (const t of listTemplates()) keyboard.text(t.name, `tpl:${t.id}`).row();
		await say(
			owner.chatId,
			[
				"Here's what you told me:",
				"",
				...QUESTIONS.filter((x) => state.answers[x.id]).map(
					(x) => `• ${x.title}\n  ${state.answers[x.id]}`,
				),
				"",
				"Which of these is closest to it? I'll start from it and fit it to your answers; you can change everything later. (Send /back to change an answer.)",
			].join("\n"),
			keyboard,
		);
	}

	if (bot) {
		bot.on("message:text", async (ctx) => {
			if (ctx.chat.type !== "private" || !ctx.from) return;
			const from = String(ctx.from.id);
			const text = ctx.message.text.trim();
			const owner = state.owner;

			if (!owner) {
				const claim = /^\/start\s+(\S+)$/.exec(text);
				const tries = failedCodes.get(from) ?? 0;
				if (
					claim &&
					tries < MAX_FAILED_CODES &&
					failedInAll < MAX_FAILED_CODES_IN_ALL &&
					sha256(claim[1] ?? "") === codeHash
				) {
					const name =
						[ctx.from.first_name, ctx.from.last_name]
							.filter(Boolean)
							.join(" ") || "Founder";
					await change(() => {
						state.owner = { userId: from, chatId: String(ctx.chat.id), name };
						if (!state.answers.founder) state.answers.founder = name;
						save();
					});
					await ctx.reply(
						`Hi ${ctx.from.first_name}! Let's set up your company: ${QUESTIONS.length} short questions, about five minutes. Answer in your own words; /skip what you don't know yet, /back to change the last answer. You can also continue in the console — it's the same setup.`,
					);
					return askNext();
				}
				if (claim) {
					failedCodes.set(from, tries + 1);
					if (++failedInAll === MAX_FAILED_CODES_IN_ALL)
						log(
							"[setup] too many wrong codes on Telegram: claiming is closed until the next restart (the console still works)",
						);
				}
				await ctx.reply(
					claim
						? "That code didn't work. The setup code is in the service's logs, or in the console once you sign in."
						: "This company isn't open yet. Check back soon!",
				);
				return;
			}
			if (owner.userId !== from) {
				await ctx.reply("This company isn't open yet. Check back soon!");
				return;
			}
			if (finishing) return;

			if (text === "/back") {
				const answered = QUESTIONS.filter(
					(q) => state.answers[q.id] || state.skipped.includes(q.id),
				).at(-1);
				if (answered)
					await change(() => {
						delete state.answers[answered.id];
						state.skipped = state.skipped.filter((s) => s !== answered.id);
						save();
					});
				return askNext();
			}
			const q = nextQuestion();
			if (!q) return askNext();
			try {
				await answer({ id: q.id, value: text === "/skip" ? "" : text });
			} catch (err) {
				await ctx.reply(err instanceof Error ? err.message : String(err));
			}
			return askNext();
		});

		bot.on("callback_query:data", async (ctx) => {
			if (String(ctx.from.id) !== state.owner?.userId)
				return ctx.answerCallbackQuery({
					text: "Only the founder can do this.",
					show_alert: true,
				});
			const data = ctx.callbackQuery.data;
			if (data === "setup:redraft") {
				await ctx.answerCallbackQuery({ text: "Drafting again…" });
				await ctx
					.editMessageReplyMarkup({ reply_markup: undefined })
					.catch(() => undefined);
				await change(() => {
					delete state.draft;
					save();
				});
				return askNext();
			}
			const picked =
				data === "setup:start" ? ["", ""] : /^tpl:(.+)$/.exec(data);
			if (!picked) return ctx.answerCallbackQuery();
			await ctx.answerCallbackQuery();
			await ctx
				.editMessageReplyMarkup({ reply_markup: undefined })
				.catch(() => undefined);
			try {
				await ctx.reply(
					await change(() => finish(picked[1] ? { template: picked[1] } : {})),
				);
				await tellNextSteps();
			} catch (err) {
				await ctx.reply(err instanceof Error ? err.message : String(err));
			}
		});
		bot.catch((err) => log(`[setup] ${err.message}`));
	}

	if (code)
		log(
			`[setup] No company yet: open the console to set it up, or on Telegram send your bot:   /start ${code}`,
		);

	let polling = false;
	return {
		app,
		done,
		async startBot() {
			if (!bot) return;
			await bot.init();
			await bot.api.deleteWebhook();
			polling = true;
			void bot
				.start()
				.catch((err: unknown) =>
					log(
						`[setup] Telegram stopped: ${err instanceof Error ? err.message : err}`,
					),
				);
		},
		async stop() {
			if (bot && polling) await bot.stop();
			polling = false;
			await app.close();
		},
	};
}

class GateError extends Error {}

function refuse(
	reply: { code(n: number): { send(body: unknown): unknown } },
	err: unknown,
): undefined {
	if (err instanceof GateError) {
		reply.code(400).send({ error: err.message });
		return undefined;
	}
	throw err;
}

function modelFromEnv(env: NodeJS.ProcessEnv): SetupInput["model"] {
	const named = env.JAMOT_MODEL ?? "anthropic";
	const [provider, ...rest] = named.split("/");
	if (!provider || !(provider in DEFAULT_MODELS))
		throw new Error(`unknown model provider in JAMOT_MODEL: "${named}"`);
	const p = provider as keyof typeof DEFAULT_MODELS;
	const apiKey = env.JAMOT_MODEL_KEY;
	if (p !== "ollama" && !apiKey)
		throw new Error(
			"set JAMOT_MODEL_KEY to the model's API key to set the company up",
		);
	return {
		provider: p,
		modelId: rest.join("/") || DEFAULT_MODELS[p],
		...(apiKey ? { apiKey } : {}),
		...(env.JAMOT_MODEL_URL ? { baseUrl: env.JAMOT_MODEL_URL } : {}),
	};
}

/**
 * After the company exists: keep the answers (the next step drafts more of
 * the company from them), and make the founder who claimed the setup on
 * Telegram the company's owner there — no second pairing.
 */
async function keepAnswers(dir: string, state: SetupFile): Promise<void> {
	const store = openCompanyStore(join(dir, "company.db"));
	try {
		await store.transaction(async (tx) => {
			await tx.settings.set("setup.answers", {
				answers: state.answers,
				skipped: state.skipped,
				...(state.draft ? { draft: state.draft.view } : {}),
				at: new Date().toISOString(),
			});
			const owner = state.owner;
			if (!owner) return;
			let person = await tx.people.findByIdentity("telegram", owner.userId);
			if (!person) {
				person = await tx.people.create({ displayName: owner.name });
				await tx.people.addIdentity(person.id, {
					provider: "telegram",
					value: owner.userId,
					verified: true,
				});
			}
			await tx.settings.set("telegram.owner", {
				...owner,
				personId: person.id,
			});
			await tx.settings.delete("telegram.pairing.owner");
			await tx.events.append({
				type: "owner.paired",
				source: "setup",
				subject: person.id,
				idempotencyKey: `owner-paired:setup:${owner.userId}`,
			});
		});
	} finally {
		store.close();
	}
}

/** The draft as a Telegram message. */
export function draftText(d: SetupDraft): string {
	const owner = (r: SetupDraft["responsibilities"][number]) =>
		r.owner.kind === "open"
			? "open — invite someone"
			: r.owner.kind === "founder"
				? "you"
				: r.owner.kind === "agent"
					? `${r.owner.name} (agent)`
					: r.owner.name;
	return [
		"Here's your company:",
		"",
		...(d.charter.vision ? [`Why it exists: ${d.charter.vision}`] : []),
		`Its mission: ${d.charter.mission}`,
		...(d.charter.values.length
			? ["What it holds to:", ...d.charter.values.map((v) => `• ${v}`)]
			: []),
		...(d.charter.goals.length
			? ["Three months from now:", ...d.charter.goals.map((g) => `• ${g}`)]
			: []),
		"",
		`Teams: ${d.teams.map((t) => t.name).join(", ")}`,
		"Responsibilities:",
		...d.responsibilities.map((r) => `• ${r.name} — ${owner(r)}`),
		...(d.agents.length
			? ["Agents:", ...d.agents.map((a) => `• ${a.name} — ${a.role}`)]
			: []),
		...(d.people.length
			? ["People:", ...d.people.map((p) => `• ${p.name} — ${p.role}`)]
			: []),
		...(d.successor ? [`Takes over if you go quiet: ${d.successor}`] : []),
	].join("\n");
}

/** What the founder does first, once the company runs. */
export function nextSteps(d: SetupDraft): string {
	const open = d.responsibilities.filter((r) => r.owner.kind === "open");
	const steps = [
		...(open.length
			? [
					`Invite someone for ${open.map((r) => r.name).join(", ")}: in the console, Stewards → Open roles.`,
				]
			: []),
		...(d.people.length
			? [
					`Link ${d.people.map((p) => p.name).join(", ")} on Telegram: Stewards → Pairing code, one each.`,
				]
			: []),
		...(d.successor
			? [
					`Make ${d.successor} your successor: send them the code from Settings.`,
				]
			: []),
		"Talk to your agents right here: tell them what you need today.",
	];
	return [
		"Your company is running. This week:",
		...steps.map((s, i) => `${i + 1}. ${s}`),
	].join("\n");
}
