# Product brief — Jamot Lite, the next phase

Written 2026-10-03 with the ECC product lens (competitive scoping → product
diagnostic → founder review → user journey → ICE prioritisation). It answers
one question: **what is Jamot Lite, next to the agents everyone already
knows, and what do we build next?** The plan that follows from it is
[BLUEPRINT.md](BLUEPRINT.md).

## 1. Positioning

**Jamot Lite is the open-source runtime for running a business with AI
agents — its customers, its people and its purpose — that keeps going when
people leave.**

| | Is for | Runs | Humans |
|---|---|---|---|
| **Hermes Agent, OpenClaw** | One person | *My* assistant: my inbox, my files, my tasks | The user |
| **Paperclip** | A founder running agents | Agents as employees in an org chart, doing internal work | A board that approves |
| **Jamot** | A business and everyone in it | *The company*: customers on Telegram, every person remembered, responsibilities with owners and successors, a charter that runs | Stewards own responsibilities; agents propose, people decide |

One line for the README:

> Hermes and OpenClaw are your assistant. Paperclip manages your agents.
> **Jamot runs your business** — with your customers, your people, and a
> charter that outlives all of them.

What only Jamot does, together:

1. **Customer-facing from day one.** Agents answer the company's customers on
   Telegram; every conversation lands in that person's memory. Paperclip's
   chat connectors are beta and its work is internal; Hermes and OpenClaw
   remember *their user*, not a company's customers.
2. **It survives people.** Every responsibility has an owner and a successor;
   heartbeats notice an owner gone quiet and move the work. Nobody else models
   continuity — Paperclip's goal is *zero-human*.
3. **The company is a file.** `company.yaml` — charter, teams,
   responsibilities, agents, heartbeats — readable, forkable, versioned.
   Seven templates today.
4. **One company, one process, one folder.** Nothing is shared between
   companies (D1, D35). Paperclip runs many companies in one deployment and
   one database.
5. **Owned by the people who build it.** Stewards, Backers, Taskers and a
   contribution ledger — the model Jamot runs on itself.

**Strategic tension:** *autonomy × accountability*. Agents do more every
month; Jamot's bet is that the companies that last keep a named human
accountable for every responsibility. We win where a business has customers
and people it can't afford to lose; we lose where someone wants a factory of
coding agents (that is Paperclip's lane — connect to it, don't copy it).

## 2. The competitive set

Scored 1–5. *Overlap* = how much of Jamot's offer it covers; *Distinctiveness*
= how ownable its stance is; *Credibility* = adoption and maturity.

| Candidate | Tier | Stance | Overlap | Distinct. | Credibility | What we learn |
|---|---|---|---|---|---|---|
| **Paperclip** — "the open-source app everyone uses to manage agents at work"; Node + React; org chart, goals, heartbeats, budgets, approvals; embedded Postgres; MIT; ~96k stars | **Direct** | Zero-human companies, internal work | 4 | 5 | 5 | Same concepts, opposite stance. One `npx` command to start. Bring-your-own-agent adapters (Claude Code, Codex, OpenClaw) |
| **Hermes Agent** (Nous Research) — self-improving personal agent; Telegram, WhatsApp, Slack, Signal; FTS5 memory; skills; MIT; ~250k stars | Adjacent | Personal | 2 | 4 | 5 | Installer, skills that improve, DM pairing — already borrowed (D11, D13) |
| **OpenClaw** (OpenClaw Foundation) — personal assistant over messaging apps; MIT; ~380k stars; serious security incidents with third-party skills | Adjacent | Personal | 2 | 4 | 4 | Demand is huge; so is the cost of unchecked agent permissions. Our policy gate and approvals are a selling point |
| **CrewAI and agent frameworks** | Substitute | Library for developers | 1 | 2 | 5 | They build agents; Jamot runs a company. Their agents can be tools or agents in a Jamot map |
| **n8n and workflow tools** | Substitute | Automations | 1 | 2 | 5 | Many small businesses "run on n8n"; a heartbeat is a workflow that knows who is responsible |
| **"AI company OS" projects** (Claw Company, RagLeap and others) | Watch | Many AI "employees" | 3 | 2 | 1 | Crowded naming; none found with real adoption — not profiled (single sources only) |

Sources: [Paperclip](https://github.com/paperclipai/paperclip) ·
[Paperclip overview](https://rywalker.com/research/paperclip) ·
[Hermes Agent](https://github.com/NousResearch/hermes-agent) ·
[Hermes guide](https://lucaberton.com/blog/what-is-hermes-agent-nous-research/) ·
[OpenClaw on Wikipedia](https://en.wikipedia.org/wiki/OpenClaw) ·
[OpenClaw guide](https://www.digitalocean.com/resources/articles/what-is-openclaw) ·
[company-os topic](https://github.com/topics/company-os). Star counts move
weekly; check before quoting.

## 3. Diagnostic

1. **Who is it for?** The owner of a small business with real customers —
   a café, a plumber, a studio, 1–20 people — whose customers already write
   on their phone; and the **operator** who sets Jamot up for several such
   businesses and holds a share in them. The first one is the founder's own
   business.
2. **The pain.** Customers wait or are forgotten; what the business knows
   lives in one or two heads; when a key person leaves, things break quietly.
   Today they use a personal assistant (which belongs to one person), a
   workflow tool (which knows no one is responsible) or nothing.
3. **Why now.** Agents became a commodity in 2026: OpenClaw and Hermes proved
   people want an agent that lives where they chat; Paperclip proved founders
   want to run a company of agents. Nobody owns *the business that keeps its
   people accountable and its customers remembered*.
4. **The 10-star version.** Start a company from a file; it answers every
   customer, knows everyone, notices every gap, survives anyone leaving, earns
   and pays its stewards, and finds partners through the hub.
5. **The MVP.** v0.1 as built, plus **one real business running on it for 30
   days** — the founder's own.
6. **Anti-goals.** Not zero-human. Not a personal assistant. Not an agent
   framework. Not an orchestrator for coding agents (connect to Paperclip
   instead). Not many companies in one database. Nothing on-chain in Lite.
7. **How we know it works.**
   - Companies running 30 days or more on Jamot Lite (the north star).
   - In each: customers answered within the company's own target time;
     heartbeat issues fixed within a week.
   - Developers who joined and merged a pull request (the launch gate, D33).

**Verdict: GO** — with the positioning above, and with the founder's own
business as the first proof, before any new chapter.

## 4. Founder review

**What it's trying to be:** the runtime of a company, not an assistant.

| Signal | Score | Evidence |
|---|---|---|
| Usage | 0 | No company runs on Lite yet |
| Retention | 0 | No contributors beyond the founder yet |
| Revenue | 1 | Hosted tier designed (RUNTIME §2), nothing billed |
| Moat | 5 | Customer-facing + survival + company file + isolation together; stance is ownable; code alone is copyable (MIT) |
| **PMF signals** | **2 / 10** | Normal before launch; the work is to make the first two lines move |

**The one thing that 10× it:** a real business visibly running on Jamot —
the founder's own, then the Bali café — with its readiness and its story in
public.

**Built, but not what matters now:** chapters 4–7 (agents negotiating,
robots, on-chain treasuries, the federated network) and the hub page before
there is a second company to list. Keep them as story; don't build them yet.

## 5. User journey — from clone to first win

Measured on 2026-10-01 from a clean clone, following START_HERE §2.

| Step | Friction found | Status |
|---|---|---|
| Install Node 22.19 + pnpm | Needs a specific Node; corepack | Documented |
| `jamot import` a template | ~~Lands in `company/` instead of its id~~ — fixed in S3 | First issue 7 |
| `jamot start` without a bot | Required a Telegram token | ✅ Fixed (`--no-telegram`, D30) |
| First agent answer | Needs a model key before anything answers | Open |
| One-line installer | Fails while the repository is private | First issue 7 |

**Time to first win:** about 30 minutes for a developer; out of reach for a
business owner without help. **Paperclip:** one `npx` command, no account.
**Target:** 5 minutes from a single command to a company answering a message.

Top three fixes:

1. **`jamot demo`** — a template company running with a built-in demo model
   and a web chat, no keys, no bot.
2. **A web chat** next to Telegram, so a customer (or a demo) can talk to the
   company without Telegram.
3. **The installer and the image work publicly** (first issue 7).

## 6. What to build next — ICE

Impact × Confidence ÷ Effort, each 1–5.

| # | Candidate | I | C | E | ICE |
|---|---|---|---|---|---|
| 1 | README and docs repositioned (§1) | 5 | 5 | 1 | **25** |
| 2 | The founder's own business on Lite, 30 days | 5 | 4 | 2 | **10** |
| 3 | `jamot demo` — no keys, no bot | 4 | 4 | 2 | **8** |
| 4 | Charter everywhere (first issue 4) | 3 | 5 | 2 | **7.5** |
| 5 | Backups with Litestream, on by default | 3 | 5 | 2 | **7.5** |
| 6 | Fleet and isolation: two companies, one machine (first issue 10) | 4 | 4 | 3 | **5.3** |
| 7 | Web chat channel | 3 | 4 | 3 | **4** |
| 8 | Bring your own agent: Hermes, OpenClaw, Claude Code as a company's agents or Taskers over MCP | 4 | 3 | 3 | **4** |
| 9 | WhatsApp (where most small businesses' customers are) | 5 | 3 | 4 | **3.75** |
| 10 | Hub page and badge (first issue 6) | 3 | 3 | 3 | 3 |
| 11 | Stewards' onboarding with Human Design and Gene Keys (first issue 9) | 2 | 4 | 3 | 2.7 |
| 12 | Agent skills (first issue 1) | 3 | 3 | 4 | 2.25 |

**v0.2 — "a business you can trust with your customers":** 1–8. WhatsApp
waits for the hub relay (RUNTIME §11) and comes right after. Onboarding with
Human Design and Gene Keys stays for the stewards, after v0.2.

## 7. Next step

[BLUEPRINT.md](BLUEPRINT.md) turns §6 into pull-request-sized steps with
owners. Rerun this brief when the first company has run 30 days.
