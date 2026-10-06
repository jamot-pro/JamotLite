import { createHash, randomBytes } from "node:crypto";
import {
	acceptInvite,
	answerCheckin,
	type Candidate,
	decideContribution,
	decideInvite,
	isRetired,
	ledgerText,
	type Notifier,
	noteStewardActivity,
	OWNER_LAST_SEEN,
	type OwnerAction,
	onboardingBrief,
	receiveMessage,
	recordContribution,
	recordSent,
	SUCCESSION,
} from "@jamot/core";
import type { CompanyPorts, CompanyStore } from "@jamot/ports";
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
	/** A one-time code (24 h) that links a person of the company map (D48). */
	createMemberPairingCode(nodeKey: string): Promise<string>;
	owner(): Promise<TelegramOwner | null>;
	successor(): Promise<TelegramOwner | null>;
	/** People of the map who linked their Telegram, by node key. */
	members(): Promise<Record<string, TelegramOwner>>;
	/** The stewards' group the bot posts to (D49), if one is connected. */
	group(): Promise<TelegramGroup | null>;
	/**
	 * The founder's yes or no to someone who used an invitation (D52): on a
	 * yes they join owning the role, are linked here and get their welcome.
	 * Returns what to tell the founder.
	 */
	decideInvite(
		inviteId: string,
		approved: boolean,
		by: string,
	): Promise<string>;
	/** The bot's @username once connected, for t.me links. */
	botName(): string | null;
}

export interface TelegramGroup {
	chatId: string;
	title: string;
	connectedAt: string;
}

const PAIRING_TTL_MS = 24 * 60 * 60 * 1000;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const holderKey = (role: Role) => `telegram.${role}`;
const pairingKey = (role: Role) => `telegram.pairing.${role}`;
/** Stewards linked to their node in the map, and their pending codes (D48). */
export const MEMBERS_SETTING = "telegram.members";
export const GROUP_SETTING = "telegram.group";
/** Set when long polling stopped (another program took the bot); cleared on start. */
export const TELEGRAM_STOPPED = "telegram.stopped";
const MEMBER_PAIRING = "telegram.pairing.members";
type Pending = { codeHash: string; expiresAt: string };
/** Codes that didn't work, per person, before they must wait (D52). */
const MAX_FAILED_CODES = 5;
const FAILED_CODES_WINDOW_MS = 60 * 60 * 1000;

/** Unambiguous characters only: people type this. */
function newCode(): string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	return [...randomBytes(8)].map((b) => alphabet[b % alphabet.length]).join("");
}

export function createTelegramChannel(
	bot: Bot,
	deps: TelegramDeps,
): TelegramChannel {
	const { store } = deps;
	const log = deps.log ?? ((m) => console.log(m));
	let stopped = false;
	const failedCodes = new Map<string, { count: number; since: number }>();
	const tooManyCodes = (userId: string) => {
		const f = failedCodes.get(userId);
		if (!f || Date.now() - f.since > FAILED_CODES_WINDOW_MS) return false;
		return f.count >= MAX_FAILED_CODES;
	};
	const codeFailed = (userId: string) => {
		const f = failedCodes.get(userId);
		if (!f || Date.now() - f.since > FAILED_CODES_WINDOW_MS)
			failedCodes.set(userId, { count: 1, since: Date.now() });
		else f.count++;
	};
	const holder = (role: Role) =>
		store.settings.get<TelegramOwner>(holderKey(role));

	/** Who may decide right now: the owner, and the successor while succession is on. */
	async function deciders(): Promise<TelegramOwner[]> {
		const people = [await holder("owner")];
		if (await store.settings.get(SUCCESSION))
			people.push(await holder("successor"));
		return people.filter((p): p is TelegramOwner => p !== null);
	}

	/** The node key of a linked steward with this Telegram account, if any. */
	async function memberKey(userId: string): Promise<string | null> {
		const members =
			(await store.settings.get<Record<string, TelegramOwner>>(
				MEMBERS_SETTING,
			)) ?? {};
		return (
			Object.entries(members).find(([, m]) => m.userId === userId)?.[0] ?? null
		);
	}

	/** A steward wrote: they're here (D53). */
	async function seenMember(userId: string): Promise<void> {
		const key = await memberKey(userId);
		if (key) await noteStewardActivity(store, key);
	}

	async function seenOwner(userId: string): Promise<void> {
		if ((await holder("owner"))?.userId === userId)
			await store.settings.set(OWNER_LAST_SEEN, new Date().toISOString());
	}

	bot.on("message:text", async (ctx) => {
		if (!ctx.from) return;
		// In a group, the bot posts the company's heartbeats and nothing else
		// (D49): agents talk to people one to one.
		if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
			const text = ctx.message.text.trim();
			const command = /^\/(\w+)(?:@(\w+))?(?:\s|$)/.exec(text);
			const me = bot.botInfo?.username;
			if (command && (!command[2] || command[2] === me)) {
				if (command[1] === "here") {
					// Only the paired owner connects a group.
					if ((await holder("owner"))?.userId !== String(ctx.from.id)) {
						await ctx.reply(
							"Only the company's owner can connect this group: they send /here from their own Telegram.",
						);
						return;
					}
					const title =
						"title" in ctx.chat && ctx.chat.title ? ctx.chat.title : "group";
					await store.settings.set(GROUP_SETTING, {
						chatId: String(ctx.chat.id),
						title,
						connectedAt: new Date().toISOString(),
					} satisfies TelegramGroup);
					await store.events.append({
						type: "group.connected",
						source: "channel/telegram",
						subject: String(ctx.chat.id),
						data: { title },
						idempotencyKey: `group-connected:${ctx.chat.id}:${ctx.message.message_id}`,
					});
					const company = await store.graph.getCompany();
					await ctx.reply(
						`This is now ${company?.name ?? "the company"}'s stewards' group. I'll post the heartbeats here; approvals stay in private.`,
					);
				}
				return;
			}
			// Mentioned: point them to a private chat, where memory is kept per person.
			if (me && text.includes(`@${me}`))
				await ctx.reply(
					"I post the company's heartbeats here. To talk to me, write to me privately.",
				);
			return;
		}
		if (ctx.chat.type !== "private") return;
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

		const coded = /^\/(start|join)\s+(\S+)/.exec(text);
		if (coded) {
			const code = coded[2] as string;
			if (tooManyCodes(who.userId)) {
				await ctx.reply(
					"Too many codes that didn't work. Try again in an hour.",
				);
				return;
			}
			if (coded[1] === "join") {
				if (!(await join(code, who, ctx.from.username))) codeFailed(who.userId);
				return;
			}
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
			const member = await pairMember(code, who);
			if (member) {
				const company = await store.graph.getCompany();
				await ctx.reply(
					`You're now linked to ${company?.name ?? "the company"} as ${member}. Your team's heartbeats will reach you here.`,
				);
				return;
			}
			// A t.me/<bot>?start=<code> link carries an invitation code too.
			if (await join(code, who, ctx.from.username, true)) return;
			codeFailed(who.userId);
			// A code that matched nothing is a pairing attempt, not a message
			// for the agents: say so, instead of answering in silence.
			await ctx.reply(
				"That code didn't work — it may have expired (a code works once, for 24 hours). Get a new one with `jamot pair`, or in the console under Settings.",
			);
			return;
		}

		await seenOwner(who.userId);
		await seenMember(who.userId);
		// The contribution record (D54): a person's own, never the agents'.
		const record = /^\/(did|ledger)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(
			text.trim(),
		);
		if (record) {
			await ctx.reply(
				await contribute(
					record[1] as "did" | "ledger",
					record[2]?.trim() ?? "",
					who,
				),
			);
			return;
		}
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
		// A check-in (D53) is answered by the steward it was for, and only them.
		const checkin = /^(still|handover|pause):(.+)$/.exec(data);
		if (checkin) {
			const key = checkin[2] as string;
			if ((await memberKey(String(ctx.from.id))) !== key)
				return ctx.answerCallbackQuery({
					text: "This question was for someone else.",
					show_alert: true,
				});
			await ctx.answerCallbackQuery();
			await ctx
				.editMessageReplyMarkup({ reply_markup: undefined })
				.catch(() => undefined);
			await ctx.reply(
				await answerCheckin(
					{ store, notifier: self },
					key,
					checkin[1] as "still" | "handover" | "pause",
				),
			);
			return;
		}
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

		const claim = /^did:(yes|no):([\w-]+)$/.exec(data);
		if (claim) {
			await ctx.answerCallbackQuery();
			await ctx
				.editMessageReplyMarkup({ reply_markup: undefined })
				.catch(() => undefined);
			const yes = claim[1] === "yes";
			try {
				const { message, nodeKey, what } = await decideContribution(
					store,
					claim[2] as string,
					yes,
					person.name,
					await memberKey(person.userId),
				);
				await self.toMember?.(nodeKey, {
					text: yes
						? `✅ The founder confirmed: ${what}`
						: `The founder didn't confirm: ${what}. Ask them if you're unsure why.`,
				});
				await ctx.reply(message);
			} catch (err) {
				await ctx.reply(err instanceof Error ? err.message : String(err));
			}
			return;
		}

		const invite = /^invite:(approve|decline):(\w+)$/.exec(data);
		if (invite) {
			await ctx.answerCallbackQuery();
			await ctx
				.editMessageReplyMarkup({ reply_markup: undefined })
				.catch(() => undefined);
			await ctx.reply(
				await decide(
					invite[2] as string,
					invite[1] === "approve",
					person.name,
				).catch((err: unknown) =>
					err instanceof Error ? err.message : String(err),
				),
			);
			return;
		}

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

	// Taken out of the stewards' group: stop posting there.
	bot.on("my_chat_member", async (ctx) => {
		const status = ctx.myChatMember.new_chat_member.status;
		if (status !== "left" && status !== "kicked") return;
		const group = await store.settings.get<TelegramGroup>(GROUP_SETTING);
		if (group?.chatId === String(ctx.chat.id)) {
			await store.settings.delete(GROUP_SETTING);
			log(`[telegram] removed from ${group.title}: no group any more`);
		}
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

	/** `/did …` and `/ledger` from the founder or a steward (D54). */
	async function contribute(
		command: "did" | "ledger",
		what: string,
		who: { userId: string; chatId: string; name: string },
	): Promise<string> {
		const isOwner = (await holder("owner"))?.userId === who.userId;
		const founderKey = (await store.graph.getCompany())?.founderKey ?? null;
		const key = isOwner ? founderKey : await memberKey(who.userId);
		if (!key && !isOwner)
			return "Only the people who run the company keep a record here.";
		if (command === "ledger") return ledgerText(store, isOwner ? null : key);
		if (!key)
			return "Your place in the company map isn't set, so there's nothing to record against. Add yourself in the console (Stewards).";
		if (!what)
			return "Say what you did after /did — for example: /did Wrote the opening menu.";
		try {
			const { id, message } = await recordContribution(
				store,
				{ nodeKey: key, what },
				isOwner ? "the owner (Telegram)" : who.name,
				isOwner,
			);
			if (!isOwner)
				for (const p of await deciders())
					await send(p, `${who.name} says they did: ${what}\nConfirm it?`, [
						{ label: "✅ Confirm", action: `did:yes:${id}` },
						{ label: "Not this", action: `did:no:${id}` },
					]);
			return message;
		} catch (err) {
			return err instanceof Error ? err.message : String(err);
		}
	}

	/**
	 * Someone sent an invitation code (D52). Returns false when the code isn't
	 * an invitation; `quiet` leaves the "didn't work" reply to the caller.
	 */
	async function join(
		code: string,
		who: { userId: string; chatId: string; name: string },
		username: string | undefined,
		quiet = false,
	): Promise<boolean> {
		const company = (await store.graph.getCompany())?.name ?? "the company";
		const members = Object.values(
			(await store.settings.get<Record<string, TelegramOwner>>(
				MEMBERS_SETTING,
			)) ?? {},
		);
		const known = [
			await holder("owner"),
			await holder("successor"),
			...members,
		];
		if (known.some((p) => p?.userId === who.userId)) {
			if (quiet) return false;
			await replyTo(
				who.chatId,
				`You're already part of ${company}. Ask the founder to give you the role in the console (Stewards).`,
			);
			return true;
		}
		const candidate: Candidate = { ...who, ...(username ? { username } : {}) };
		const accepted = await acceptInvite(store, code, candidate);
		if (!accepted) {
			if (!quiet)
				await replyTo(
					who.chatId,
					"That invitation didn't work — it may have expired or been used (an invitation works once, for 24 hours). Ask the founder for a new one.",
				);
			return false;
		}
		await replyTo(who.chatId, accepted.reply);
		const role = (await store.graph.listNodes()).find(
			(n) => n.key === accepted.invite.responsibilityKey,
		);
		const handle = username ? ` (@${username})` : "";
		for (const p of await deciders())
			await send(
				p,
				`${who.name}${handle} used your invitation and wants to take ${role?.name ?? "the role"}. Let them in?`,
				[
					{
						label: "✅ Yes, welcome them",
						action: `invite:approve:${accepted.invite.id}`,
					},
					{ label: "❌ No", action: `invite:decline:${accepted.invite.id}` },
				],
			);
		return true;
	}

	const replyTo = (chatId: string, text: string) =>
		bot.api.sendMessage(chatId, text).then(() => undefined);

	/** Carries out the founder's yes or no on an invitation; tells the candidate. */
	async function decide(
		inviteId: string,
		approved: boolean,
		by: string,
	): Promise<string> {
		const { message, invite } = await decideInvite(
			store,
			inviteId,
			approved,
			by,
			(tx, nodeKey, who) => linkMember(tx, nodeKey, who.name, who),
		);
		const chatId = invite.candidate?.chatId;
		if (chatId) {
			const text =
				approved && invite.nodeKey
					? await onboardingBrief(store, invite.nodeKey)
					: "Thank you for your interest. The founder has decided not to go ahead this time.";
			await replyTo(chatId, text).catch((err: unknown) =>
				log(
					`[telegram] couldn't reach ${invite.candidate?.name}: ${err instanceof Error ? err.message : err}`,
				),
			);
		}
		return message;
	}

	/** Links a Telegram account to a person of the map, inside a transaction. */
	async function linkMember(
		tx: CompanyPorts,
		nodeKey: string,
		name: string,
		who: { userId: string; chatId: string },
	): Promise<void> {
		let person = await tx.people.findByIdentity("telegram", who.userId);
		if (!person) {
			person = await tx.people.create({ displayName: name });
			await tx.people.addIdentity(person.id, {
				provider: "telegram",
				value: who.userId,
				verified: true,
			});
		}
		const members =
			(await tx.settings.get<Record<string, TelegramOwner>>(MEMBERS_SETTING)) ??
			{};
		await tx.settings.set(MEMBERS_SETTING, {
			...members,
			[nodeKey]: {
				userId: who.userId,
				chatId: who.chatId,
				name,
				personId: person.id,
			},
		});
	}

	/** Links a steward's Telegram to their node; returns their name, or null. */
	async function pairMember(
		code: string,
		who: { userId: string; chatId: string; name: string },
	): Promise<string | null> {
		const pending =
			(await store.settings.get<Record<string, Pending>>(MEMBER_PAIRING)) ?? {};
		const hash = sha256(code);
		const nodeKey = Object.keys(pending).find(
			(k) =>
				pending[k]?.codeHash === hash &&
				Date.parse(pending[k]?.expiresAt ?? "") >= Date.now(),
		);
		if (!nodeKey) return null;
		const node = (await store.graph.listNodes()).find(
			(n) => n.kind === "human" && n.key === nodeKey && !isRetired(n),
		);
		if (!node) return null;
		await store.transaction(async (tx) => {
			await linkMember(tx, nodeKey, node.name, who);
			const left =
				(await tx.settings.get<Record<string, Pending>>(MEMBER_PAIRING)) ?? {};
			delete left[nodeKey]; // one use only
			await tx.settings.set(MEMBER_PAIRING, left);
			await tx.events.append({
				type: "steward.paired",
				source: "channel/telegram",
				subject: nodeKey,
				idempotencyKey: `steward-paired:${nodeKey}:${hash}`,
			});
		});
		return node.name;
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

	const self: TelegramChannel = {
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
							void store.settings
								.delete(TELEGRAM_STOPPED)
								.catch(() => undefined);
							resolve();
						},
					})
					.catch((err: unknown) => {
						// After start, polling only ends on an error such as another
						// program using the same bot token (409): say so.
						if (!started) return reject(err);
						const reason = err instanceof Error ? err.message : String(err);
						log(`[telegram] stopped receiving messages: ${reason}`);
						// Sending still works: the heartbeat tells the owner (D57).
						void store.settings
							.set(TELEGRAM_STOPPED, { at: new Date().toISOString(), reason })
							.catch(() => undefined);
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
			const code = newCode();
			await store.settings.set(pairingKey(role), {
				codeHash: sha256(code),
				expiresAt: new Date(Date.now() + PAIRING_TTL_MS).toISOString(),
			});
			return code;
		},

		async createMemberPairingCode(nodeKey) {
			const node = (await store.graph.listNodes()).find(
				(n) => n.kind === "human" && n.key === nodeKey && !isRetired(n),
			);
			if (!node) throw new Error(`There's no one "${nodeKey}" any more.`);
			const code = newCode();
			const pending =
				(await store.settings.get<Record<string, Pending>>(MEMBER_PAIRING)) ??
				{};
			await store.settings.set(MEMBER_PAIRING, {
				...pending,
				[nodeKey]: {
					codeHash: sha256(code),
					expiresAt: new Date(Date.now() + PAIRING_TTL_MS).toISOString(),
				},
			});
			return code;
		},

		async toMembers(nodeKeys, message) {
			const members =
				(await store.settings.get<Record<string, TelegramOwner>>(
					MEMBERS_SETTING,
				)) ?? {};
			const live = new Set(
				(await store.graph.listNodes())
					.filter((n) => n.kind === "human" && !isRetired(n))
					.map((n) => n.key),
			);
			// Whoever decides already got it, with the buttons.
			const told = new Set((await deciders()).map((d) => d.chatId));
			let reached = 0;
			for (const key of new Set(nodeKeys)) {
				const m = members[key];
				if (!m || !live.has(key) || told.has(m.chatId)) continue;
				told.add(m.chatId);
				try {
					await bot.api.sendMessage(m.chatId, message.text);
					reached++;
				} catch (err) {
					log(
						`[telegram] couldn't reach ${m.name}: ${err instanceof Error ? err.message : err}`,
					);
				}
			}
			return reached;
		},

		async toMember(nodeKey, message) {
			const m = (
				await store.settings.get<Record<string, TelegramOwner>>(MEMBERS_SETTING)
			)?.[nodeKey];
			const live = (await store.graph.listNodes()).some(
				(n) => n.kind === "human" && n.key === nodeKey && !isRetired(n),
			);
			if (!m || !live) return false;
			try {
				await send(m, message.text, message.actions);
				return true;
			} catch (err) {
				log(
					`[telegram] couldn't reach ${m.name}: ${err instanceof Error ? err.message : err}`,
				);
				return false;
			}
		},

		async toGroup(message) {
			const group = await store.settings.get<TelegramGroup>(GROUP_SETTING);
			if (!group) return false;
			try {
				await bot.api.sendMessage(group.chatId, message.text);
				return true;
			} catch (err) {
				log(
					`[telegram] couldn't post to ${group.title}: ${err instanceof Error ? err.message : err}`,
				);
				return false;
			}
		},

		group: () => store.settings.get<TelegramGroup>(GROUP_SETTING),
		decideInvite: decide,
		botName() {
			try {
				return bot.botInfo.username;
			} catch {
				return null; // not connected yet
			}
		},
		owner: () => holder("owner"),
		successor: () => holder("successor"),
		members: async () =>
			(await store.settings.get<Record<string, TelegramOwner>>(
				MEMBERS_SETTING,
			)) ?? {},
	};
	return self;
}
