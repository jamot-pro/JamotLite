import { createHash, randomBytes } from "node:crypto";
import {
	type Notifier,
	OWNER_LAST_SEEN,
	type OwnerAction,
	receiveMessage,
	recordSent,
	SUCCESSION,
} from "@jamot/core";
import type { CompanyStore } from "@jamot/ports";
import { type Bot, GrammyError, InlineKeyboard } from "grammy";

/**
 * Telegram — Jamot Lite's only channel (RUNTIME D10), through grammY with
 * long polling, so it works on a laptop, a Pi or a VPS with no public URL.
 *
 * Customers write to the company's bot in private chats. The owner links
 * their own Telegram account once with a pairing code (`/start <code>`), and
 * so can a named successor. Approvals and heartbeat alerts reach the owner as
 * messages with buttons only they can press — and the successor too, while
 * the owner has gone silent (RUNTIME §7, succession).
 */

export interface TelegramDeps {
	store: CompanyStore;
	/** Carries out a person's decision on a waiting tool call (the brain's `decide`). */
	decide(approvalId: string, approved: boolean, by: string): Promise<void>;
	/** Carries out a one-tap fix a heartbeat proposed; returns what to tell them. */
	act?(action: string, by: string): Promise<string>;
	log?: (message: string) => void;
}

/** How long the first call to Telegram may take before it's retried. */
export const FIRST_CONTACT_MS = 20_000;

export type Role = "owner" | "successor";

export interface TelegramOwner {
	userId: string;
	chatId: string;
	personId: string;
	name: string;
}

export interface TelegramChannel extends Notifier {
	/** Starts long polling. Resolves once the bot is connected. */
	start(): Promise<void>;
	stop(): Promise<void>;
	/** Sends queued outbound messages. Returns how many went out. */
	sendPending(): Promise<number>;
	/** Asks the owner (and an acting successor) to decide on waiting tool calls. */
	askOwnerToApprove(approvalIds: string[]): Promise<void>;
	/** A one-time code (valid 24 h) the owner — or successor — sends as `/start <code>`. */
	createPairingCode(role?: Role): Promise<string>;
	owner(): Promise<TelegramOwner | null>;
	successor(): Promise<TelegramOwner | null>;
}

const PAIRING_TTL_MS = 24 * 60 * 60 * 1000;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const holderKey = (role: Role) => `telegram.${role}`;
const pairingKey = (role: Role) => `telegram.pairing.${role}`;

export function createTelegramChannel(
	bot: Bot,
	deps: TelegramDeps,
): TelegramChannel {
	const { store } = deps;
	const log = deps.log ?? ((m) => console.log(m));
	let stopped = false;
	const holder = (role: Role) =>
		store.settings.get<TelegramOwner>(holderKey(role));

	/** Who may decide right now: the owner, and the successor while succession is on. */
	async function deciders(): Promise<TelegramOwner[]> {
		const people = [await holder("owner")];
		if (await store.settings.get(SUCCESSION))
			people.push(await holder("successor"));
		return people.filter((p): p is TelegramOwner => p !== null);
	}

	async function seenOwner(userId: string): Promise<void> {
		if ((await holder("owner"))?.userId === userId)
			await store.settings.set(OWNER_LAST_SEEN, new Date().toISOString());
	}

	bot.on("message:text", async (ctx) => {
		// Groups come later; a company bot talks to people one to one.
		if (ctx.chat.type !== "private" || !ctx.from) return;
		const text = ctx.message.text;
		const displayName =
			[ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") ||
			ctx.from.username ||
			"Someone";
		const who = {
			userId: String(ctx.from.id),
			chatId: String(ctx.chat.id),
			name: displayName,
		};

		if (text.startsWith("/start ")) {
			const code = text.slice(7).trim();
			for (const role of ["owner", "successor"] as const) {
				if (await pair(role, code, who)) {
					const company = await store.graph.getCompany();
					const name = company?.name ?? "this company";
					await ctx.reply(
						role === "owner"
							? `You're now the owner of ${name} on Telegram. Approvals and heartbeat alerts will come to you here.`
							: `You're now the named successor of ${name}. If the owner goes silent, the company will turn to you.`,
					);
					await seenOwner(who.userId);
					return;
				}
			}
			// A code that matched nothing is a pairing attempt, not a message
			// for the agents: say so, instead of answering in silence.
			await ctx.reply(
				"That code didn't work — it may have expired (a code works once, for 24 hours). Get a new one with `jamot pair`, or in the console under Settings.",
			);
			return;
		}

		await seenOwner(who.userId);
		await receiveMessage(store, {
			channel: "telegram",
			threadId: who.chatId,
			messageId: String(ctx.message.message_id),
			from: { userId: who.userId, displayName },
			text,
			at: new Date(ctx.message.date * 1000).toISOString(),
		});
	});

	bot.on("callback_query:data", async (ctx) => {
		const data = ctx.callbackQuery.data;
		const person = (await deciders()).find(
			(p) => p.userId === String(ctx.from.id),
		);
		if (!person) {
			return ctx.answerCallbackQuery({
				text: "Only the company's owner can decide this.",
				show_alert: true,
			});
		}
		await seenOwner(person.userId);

		const decision = /^(approve|decline):(.+)$/.exec(data);
		if (decision) {
			const approved = decision[1] === "approve";
			const approvalId = decision[2] as string;
			const approval = await store.approvals.get(approvalId);
			if (!approval)
				return ctx.answerCallbackQuery({
					text: "This request no longer exists.",
				});
			if (approval.status !== "pending")
				return ctx.answerCallbackQuery({ text: `Already ${approval.status}.` });
			await ctx.answerCallbackQuery({
				text: approved ? "Approved" : "Declined",
			});
			await ctx
				.editMessageReplyMarkup({ reply_markup: undefined })
				.catch(() => undefined);
			await deps.decide(approvalId, approved, person.name);
			await ctx.reply(
				approved
					? `✅ Approved: ${approval.tool}`
					: `❌ Declined: ${approval.tool}`,
			);
			return;
		}

		if (!deps.act) return ctx.answerCallbackQuery();
		await ctx.answerCallbackQuery();
		await ctx.reply(await deps.act(data, person.name));
	});

	bot.catch((err) => log(`[telegram] ${err.message}`));

	async function pair(
		role: Role,
		code: string,
		who: { userId: string; chatId: string; name: string },
	): Promise<boolean> {
		const pairing = await store.settings.get<{
			codeHash: string;
			expiresAt: string;
		}>(pairingKey(role));
		if (
			!pairing ||
			pairing.codeHash !== sha256(code) ||
			Date.parse(pairing.expiresAt) < Date.now()
		)
			return false;
		await store.transaction(async (tx) => {
			let person = await tx.people.findByIdentity("telegram", who.userId);
			if (!person) {
				person = await tx.people.create({ displayName: who.name });
				await tx.people.addIdentity(person.id, {
					provider: "telegram",
					value: who.userId,
					verified: true,
				});
			}
			await tx.settings.set(holderKey(role), {
				...who,
				personId: person.id,
			} satisfies TelegramOwner);
			await tx.settings.delete(pairingKey(role)); // one use only
			await tx.events.append({
				type: `${role}.paired`,
				source: "channel/telegram",
				subject: person.id,
				idempotencyKey: `${role}-paired:${who.userId}:${pairing.codeHash}`,
			});
		});
		return true;
	}

	async function send(
		to: TelegramOwner,
		text: string,
		actions?: OwnerAction[],
	): Promise<void> {
		const keyboard = new InlineKeyboard();
		for (const a of actions ?? []) keyboard.text(a.label, a.action).row();
		await bot.api.sendMessage(
			to.chatId,
			text,
			actions?.length ? { reply_markup: keyboard } : {},
		);
	}

	return {
		async start() {
			// grammy retries network errors and Telegram outages silently and
			// forever; make first contact ourselves so the reason is in the logs.
			for (let wait = 2_000; ; wait = Math.min(wait * 2, 60_000)) {
				if (stopped) return;
				try {
					// A connection that hangs would otherwise wait grammy's 500 s.
					// (grammy types its signal with a polyfill; Node's is the same thing.)
					const signal = AbortSignal.timeout(FIRST_CONTACT_MS) as Parameters<
						typeof bot.init
					>[0];
					await bot.init(signal);
					await bot.api.deleteWebhook(undefined, signal);
					break;
				} catch (err) {
					if (err instanceof GrammyError && err.error_code === 401)
						throw new Error(
							"Telegram refused the bot token — store a new one with `jamot secret set telegram.botToken`",
						);
					log(
						`[telegram] can't reach Telegram yet (${err instanceof Error ? err.message : err}); trying again in ${wait / 1000}s`,
					);
					await new Promise((r) => setTimeout(r, wait));
				}
			}
			log(`[telegram] connected as @${bot.botInfo.username}`);
			await new Promise<void>((resolve, reject) => {
				let started = false;
				bot
					.start({
						onStart: () => {
							started = true;
							resolve();
						},
					})
					.catch((err: unknown) => {
						// After start, polling only ends on an error such as another
						// program using the same bot token (409): say so.
						if (!started) return reject(err);
						log(
							`[telegram] stopped receiving messages: ${err instanceof Error ? err.message : err}`,
						);
					});
			});
		},

		async stop() {
			stopped = true;
			await bot.stop();
		},

		async sendPending() {
			let sent = 0;
			for (const message of await store.conversations.listPending(
				20,
				"telegram",
			)) {
				const conversation = await store.conversations.get(
					message.conversationId,
				);
				if (conversation?.channel !== "telegram") continue;
				try {
					const result = await bot.api.sendMessage(
						conversation.externalThreadId,
						message.text,
					);
					await recordSent(store, message.id, String(result.message_id));
					sent++;
				} catch (err) {
					if (err instanceof GrammyError && err.error_code === 429) {
						log("[telegram] rate limited; the rest waits for the next pass");
						break;
					}
					// Blocked by the user, chat gone, message refused: this one won't succeed later.
					const reason = err instanceof Error ? err.message : String(err);
					await store.conversations.markFailed(message.id, reason);
					log(`[telegram] could not send ${message.id}: ${reason}`);
				}
			}
			return sent;
		},

		async askOwnerToApprove(approvalIds) {
			const people = await deciders();
			for (const id of approvalIds) {
				const approval = await store.approvals.get(id);
				if (approval?.status !== "pending") continue;
				if (people.length === 0) {
					await store.events.append({
						type: "approval.unrouted",
						source: "channel/telegram",
						subject: id,
						data: { reason: "no owner paired on Telegram" },
						idempotencyKey: `approval-unrouted:${id}`,
					});
					continue;
				}
				const args = JSON.stringify(approval.args, null, 1);
				// A proposal from an outside AI connected over MCP says so.
				const outside = approval.sessionId.startsWith("mcp:")
					? " (an outside AI, connected over MCP)"
					: "";
				const text = [
					`${approval.agentKey}${outside} wants to use ${approval.tool}:`,
					args.length > 800 ? `${args.slice(0, 800)}…` : args,
					"",
					"Approve?",
				].join("\n");
				for (const p of people) {
					await bot.api.sendMessage(p.chatId, text, {
						reply_markup: new InlineKeyboard()
							.text("✅ Approve", `approve:${id}`)
							.text("❌ Decline", `decline:${id}`),
					});
				}
			}
		},

		async toOwner(message) {
			const people = await deciders();
			for (const p of people) await send(p, message.text, message.actions);
			return people.length > 0;
		},

		async toSuccessor(message) {
			const successor = await holder("successor");
			if (!successor) return false;
			await send(successor, message.text, message.actions);
			return true;
		},

		async createPairingCode(role = "owner") {
			// Unambiguous characters only: people type this.
			const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
			const code = [...randomBytes(8)]
				.map((b) => alphabet[b % alphabet.length])
				.join("");
			await store.settings.set(pairingKey(role), {
				codeHash: sha256(code),
				expiresAt: new Date(Date.now() + PAIRING_TTL_MS).toISOString(),
			});
			return code;
		},

		owner: () => holder("owner"),
		successor: () => holder("successor"),
	};
}
