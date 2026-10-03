import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
	forgetPerson,
	type Notifier,
	receiveMessage,
	recordSent,
} from "@jamot/core";
import type { CompanyStore } from "@jamot/ports";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readCookie } from "./auth.js";

/**
 * The web chat (BLUEPRINT S5, RUNTIME D39): a customer talks to the company
 * from a browser. Public by design, so it is off until the owner turns it on,
 * and every route answers 404 while it's off.
 *
 * The visitor is a person like any other, known by a signed cookie
 * (`provider: "web"`); their messages go through the same intake as
 * Telegram's, so the person is resolved first and every message becomes
 * memory. Replies wait in the outbox like any channel's; `deliver()` marks
 * them sent and pushes them to the visitor's open page over SSE.
 *
 * Limits: a message is at most 2,000 characters; a visitor may send 6 a
 * minute and the whole web chat 60; and when the day's web replies have cost
 * the daily cap, new messages wait until tomorrow and the owner is told once.
 * None of these routes reaches the console or MCP: the visitor cookie is
 * signed with its own key and is no console session.
 */

export const WEBCHAT_SETTING = "webchat";
const PAUSED_SETTING = "webchat.pausedOn";
const VISITOR_COOKIE = "jamot_visitor";

export interface WebChatSettings {
	enabled: boolean;
	/** The most the web chat's agent runs may cost in a day (UTC), in US dollars. */
	dailyCapUsd: number;
}
export const WEBCHAT_DEFAULTS: WebChatSettings = {
	enabled: false,
	dailyCapUsd: 2,
};

/** Checks a change to the settings; the owner's way in is the console or `jamot webchat`. */
export function updateWebChatSettings(
	current: WebChatSettings,
	patch: { enabled?: unknown; dailyCapUsd?: unknown },
): WebChatSettings {
	const next = { ...current };
	if (patch.enabled !== undefined) {
		if (typeof patch.enabled !== "boolean")
			throw new Error("enabled is true or false");
		next.enabled = patch.enabled;
	}
	if (patch.dailyCapUsd !== undefined) {
		const cap = Number(patch.dailyCapUsd);
		if (!Number.isFinite(cap) || cap <= 0 || cap > 1_000)
			throw new Error("the daily cap is between $0.01 and $1,000");
		next.dailyCapUsd = cap;
	}
	return next;
}

export const LIMITS = {
	textChars: 2_000,
	nameChars: 60,
	perVisitorPerMinute: 6,
	perCompanyPerMinute: 60,
	/** New visitor cookies one address may get, so dropping the cookie doesn't escape the limits. */
	newVisitorsPerAddressPerMinute: 10,
	streamsPerVisitor: 3,
	streams: 200,
} as const;

export interface WebChatDeps {
	store: CompanyStore;
	secretKey: Buffer;
	notifier: Notifier;
	secureCookies?: boolean;
	log?: (message: string) => void;
}

export interface WebChat {
	/** Marks queued web replies sent and pushes them to open pages. */
	deliver(): Promise<number>;
	settings(): Promise<WebChatSettings>;
}

/** Visitor ids: "<random id>.<hmac>", signed with a key of their own. */
function visitorTokens(secretKey: Buffer) {
	const key = createHmac("sha256", secretKey)
		.update("jamot web visitors v1")
		.digest();
	const sign = (id: string) =>
		createHmac("sha256", key).update(id).digest("base64url");
	return {
		issue(): { id: string; token: string } {
			const id = randomBytes(16).toString("base64url");
			return { id, token: `${id}.${sign(id)}` };
		},
		verify(token: string | undefined): string | null {
			if (!token) return null;
			const [id, signature] = token.split(".");
			if (!id || !signature || !/^[A-Za-z0-9_-]{22}$/.test(id)) return null;
			const good = Buffer.from(sign(id));
			const given = Buffer.from(signature);
			return good.length === given.length && timingSafeEqual(good, given)
				? id
				: null;
		},
	};
}

/** Counts in a sliding minute. */
function perMinute(max: number) {
	const hits = new Map<string, number[]>();
	return (key: string, now = Date.now()): boolean => {
		const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
		if (recent.length >= max) {
			hits.set(key, recent);
			return false;
		}
		recent.push(now);
		hits.set(key, recent);
		if (hits.size > 10_000) hits.clear(); // a flood of new visitors resets, never grows
		return true;
	};
}

const startOfUtcDay = (now: Date) =>
	`${now.toISOString().slice(0, 10)}T00:00:00.000Z`;

export function registerWebChat(
	app: FastifyInstance,
	deps: WebChatDeps,
): WebChat {
	const { store } = deps;
	const log = deps.log ?? ((m: string) => console.log(m));
	const tokens = visitorTokens(deps.secretKey);
	const visitorLimit = perMinute(LIMITS.perVisitorPerMinute);
	const companyLimit = perMinute(LIMITS.perCompanyPerMinute);
	const newVisitorLimit = perMinute(LIMITS.newVisitorsPerAddressPerMinute);
	const streams = new Map<string, Set<FastifyReply>>();
	let openStreams = 0;

	const settings = async (): Promise<WebChatSettings> => ({
		...WEBCHAT_DEFAULTS,
		...((await store.settings.get<Partial<WebChatSettings>>(WEBCHAT_SETTING)) ??
			{}),
	});

	const cookie = (value: string, maxAge: number) =>
		`${VISITOR_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/chat; Max-Age=${maxAge}${deps.secureCookies ? "; Secure" : ""}`;

	const knownVisitor = (req: FastifyRequest): string | null =>
		tokens.verify(readCookie(req.headers.cookie, VISITOR_COOKIE));

	/** The visitor, or a new one with its cookie set on the reply — at most a
	 *  few new ones a minute per address (null once that's used up). */
	const visitor = (req: FastifyRequest, reply: FastifyReply): string | null => {
		const known = knownVisitor(req);
		if (known) return known;
		if (!newVisitorLimit(req.ip)) return null;
		const { id, token } = tokens.issue();
		reply.header("set-cookie", cookie(token, 365 * 86_400));
		return id;
	};
	const tooManyNew = (reply: FastifyReply) =>
		reply
			.code(429)
			.send({ error: "too many new visitors — try again in a minute" });
	const openPageFirst = (reply: FastifyReply) =>
		reply.code(403).send({ error: "open the chat page first" });

	const visitorConversation = async (visitorId: string) => {
		const person = await store.people.findByIdentity("web", visitorId);
		if (!person) return null;
		return (
			(await store.conversations.list({ personId: person.id })).find(
				(c) => c.channel === "web" && c.externalThreadId === visitorId,
			) ?? null
		);
	};

	/** Off means not there at all. */
	const whenOn =
		<R extends FastifyRequest>(
			handler: (req: R, reply: FastifyReply) => Promise<unknown>,
		) =>
		async (req: R, reply: FastifyReply) => {
			if (!(await settings()).enabled)
				return reply.code(404).send({ error: "not found" });
			return handler(req, reply);
		};

	/** True once today's web replies have cost the cap; tells the owner once. */
	const overCap = async (now = new Date()): Promise<boolean> => {
		const { dailyCapUsd } = await settings();
		const spent = await store.runs.totals({
			since: startOfUtcDay(now),
			sessionPrefix: "web:",
		});
		if (spent.costMicroUsd < dailyCapUsd * 1_000_000) return false;
		const today = now.toISOString().slice(0, 10);
		if ((await store.settings.get<string>(PAUSED_SETTING)) !== today) {
			await store.settings.set(PAUSED_SETTING, today);
			log(
				`[webchat] today's cap of $${dailyCapUsd} is reached; web chat waits until tomorrow`,
			);
			await deps.notifier
				.toOwner({
					text: `The web chat reached today's limit of $${dailyCapUsd} and is paused until midnight UTC. Raise it with \`jamot webchat on --cap <dollars>\`.`,
				})
				.catch(() => false);
		}
		return true;
	};

	app.get(
		"/chat",
		whenOn(async (req, reply) => {
			if (!visitor(req, reply)) return tooManyNew(reply);
			const company = await store.graph.getCompany();
			return reply
				.header(
					"content-security-policy",
					"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
				)
				.type("text/html; charset=utf-8")
				.send(page(company?.name ?? "the company"));
		}),
	);
	app.get(
		"/chat/chat.js",
		whenOn(async (_req, reply) =>
			reply.type("text/javascript; charset=utf-8").send(SCRIPT),
		),
	);
	app.get(
		"/chat/chat.css",
		whenOn(async (_req, reply) =>
			reply.type("text/css; charset=utf-8").send(STYLE),
		),
	);

	app.get(
		"/chat/history",
		whenOn(async (req) => {
			const id = knownVisitor(req);
			const conversation = id ? await visitorConversation(id) : null;
			if (!conversation) return { messages: [] };
			const messages = await store.conversations.listMessages(conversation.id, {
				limit: 100,
			});
			return {
				messages: messages
					.filter((m) => m.direction === "in" || m.status === "sent")
					.map((m) => ({
						from: m.direction === "in" ? "you" : "company",
						text: m.text,
						at: m.createdAt,
					})),
			};
		}),
	);

	type Post = FastifyRequest<{ Body: { text?: unknown; name?: unknown } }>;
	app.post(
		"/chat/messages",
		whenOn(async (req: Post, reply) => {
			// JSON only: a cross-site form can't send it without asking first.
			if (!req.headers["content-type"]?.startsWith("application/json"))
				return reply.code(415).send({ error: "send JSON" });
			// Only a visitor the page already met: no cookie, no message.
			const id = knownVisitor(req);
			if (!id) return openPageFirst(reply);
			const text =
				typeof req.body?.text === "string" ? req.body.text.trim() : "";
			if (!text)
				return reply.code(400).send({ error: "write something first" });
			if (text.length > LIMITS.textChars)
				return reply
					.code(413)
					.send({ error: `keep it under ${LIMITS.textChars} characters` });
			const name =
				typeof req.body?.name === "string"
					? req.body.name.trim().slice(0, LIMITS.nameChars)
					: "";
			if (!visitorLimit(id))
				return reply.code(429).send({ error: "a little slower, please" });
			if (!companyLimit("all"))
				return reply
					.code(429)
					.send({ error: "the company is busy — try again in a minute" });
			if (await overCap())
				return reply.code(503).send({
					error:
						"the company has answered all it can for today — try again tomorrow",
				});
			await receiveMessage(store, {
				channel: "web",
				threadId: id,
				messageId: randomBytes(12).toString("base64url"),
				from: { userId: id, displayName: name || "Web visitor" },
				text,
			});
			return reply.code(202).send({ ok: true });
		}),
	);

	app.get(
		"/chat/events",
		whenOn(async (req, reply) => {
			const id = knownVisitor(req);
			if (!id) return openPageFirst(reply);
			const mine = streams.get(id) ?? new Set<FastifyReply>();
			if (
				mine.size >= LIMITS.streamsPerVisitor ||
				openStreams >= LIMITS.streams
			)
				return reply.code(429).send({ error: "too many open pages" });
			reply.hijack();
			reply.raw.writeHead(200, {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-store",
				"x-content-type-options": "nosniff",
				// Render and nginx would otherwise buffer the stream.
				"x-accel-buffering": "no",
			});
			reply.raw.write(": open\n\n");
			mine.add(reply);
			streams.set(id, mine);
			openStreams++;
			const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);
			req.raw.on("close", () => {
				clearInterval(ping);
				mine.delete(reply);
				if (mine.size === 0) streams.delete(id);
				openStreams--;
			});
		}),
	);

	app.post(
		"/chat/forget",
		whenOn(async (req, reply) => {
			if (!req.headers["content-type"]?.startsWith("application/json"))
				return reply.code(415).send({ error: "send JSON" });
			const id = knownVisitor(req);
			if (id) {
				const person = await store.people.findByIdentity("web", id);
				if (person) await forgetPerson(store, person.id);
				for (const s of streams.get(id) ?? []) s.raw.end();
			}
			reply.header("set-cookie", cookie("", 0));
			return {
				ok: true,
				message:
					"Forgotten: everything you wrote here, and what the company knew about you from it.",
			};
		}),
	);

	return {
		settings,
		async deliver() {
			let sent = 0;
			for (const message of await store.conversations.listPending(50, "web")) {
				const conversation = await store.conversations.get(
					message.conversationId,
				);
				if (!conversation) continue;
				// The page reads it from history, so it is delivered once it's stored.
				await recordSent(store, message.id, null);
				sent++;
				const data = JSON.stringify({
					from: "company",
					text: message.text,
					at: message.createdAt,
				});
				for (const s of streams.get(conversation.externalThreadId) ?? [])
					s.raw.write(`event: message\ndata: ${data}\n\n`);
			}
			return sent;
		},
	};
}

const escapeHtml = (s: string) =>
	s.replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			] as string,
	);

function page(company: string): string {
	const name = escapeHtml(company);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Talk to ${name}</title>
<link rel="stylesheet" href="/chat/chat.css">
<script src="/chat/chat.js" defer></script>
</head>
<body>
<main>
  <header><h1>${name}</h1><button id="forget" type="button">Forget me</button></header>
  <ol id="messages" aria-live="polite"></ol>
  <p id="status" role="status"></p>
  <form id="send">
    <input id="name" placeholder="Your name (optional)" maxlength="${LIMITS.nameChars}" autocomplete="name">
    <div class="row">
      <textarea id="text" rows="2" maxlength="${LIMITS.textChars}" placeholder="Write a message…" required></textarea>
      <button type="submit">Send</button>
    </div>
  </form>
  <footer>What you write here is kept by ${name} so it can answer you and remember you. “Forget me” erases it.</footer>
</main>
</body>
</html>`;
}

// No innerHTML anywhere: every message is shown as text.
const SCRIPT = `"use strict";
const list = document.getElementById("messages");
const status = document.getElementById("status");
const form = document.getElementById("send");
const text = document.getElementById("text");
const name = document.getElementById("name");
const show = (m) => {
  const li = document.createElement("li");
  li.className = m.from;
  li.textContent = m.text;
  list.appendChild(li);
  li.scrollIntoView({ block: "end" });
};
fetch("/chat/history").then((r) => r.json()).then((h) => h.messages.forEach(show));
const events = new EventSource("/chat/events");
events.addEventListener("message", (e) => { status.textContent = ""; show(JSON.parse(e.data)); });
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const value = text.value.trim();
  if (!value) return;
  const res = await fetch("/chat/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: value, name: name.value }),
  });
  if (res.ok) { show({ from: "you", text: value }); text.value = ""; status.textContent = "…"; }
  else status.textContent = (await res.json().catch(() => ({}))).error || "That didn't go through.";
});
text.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
});
document.getElementById("forget").addEventListener("click", async () => {
  if (!confirm("Erase everything you wrote here?")) return;
  const res = await fetch("/chat/forget", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const body = await res.json().catch(() => ({}));
  list.replaceChildren();
  status.textContent = body.message || "";
});
`;

const STYLE = `:root{--bg:#fafaf7;--fg:#1d1d1b;--muted:#6b6b66;--you:#1d4ed8;--company:#ececE6;--line:#dcdcd5}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ececE6;--muted:#9a9a93;--you:#3b82f6;--company:#262624;--line:#33332f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 system-ui,sans-serif}
main{max-width:640px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column;padding:16px}
header{display:flex;justify-content:space-between;align-items:center;gap:8px}h1{font-size:1.25rem;margin:0}
#messages{list-style:none;margin:16px 0;padding:0;flex:1;display:flex;flex-direction:column;gap:8px}
#messages li{max-width:85%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere}
li.you{align-self:flex-end;background:var(--you);color:#fff}li.company{align-self:flex-start;background:var(--company)}
#status{color:var(--muted);min-height:1.4em;margin:0}form{display:flex;flex-direction:column;gap:8px}
.row{display:flex;gap:8px}textarea,input{flex:1;font:inherit;padding:8px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit}
button{font:inherit;padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:var(--fg);color:var(--bg);cursor:pointer}
#forget{background:transparent;color:var(--muted)}footer{color:var(--muted);font-size:.8rem;margin-top:12px}
`;
