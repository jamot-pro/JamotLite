# Jamot Lite — the company runtime

Status: **draft — design and decision record**, 2026-09-30.

This is the design and decision record for Jamot Lite: what we are building —
one independent runtime per company — how, and why, with a log of decisions
made and still open. The product contract (a new, shorter SPEC) will be written
from it. References to `SPEC`, `ARCHITECTURE` and code paths like
`dream/survival.ts` point to the archived J-Nesys repository this project was
seeded from.

---

## 1. The idea in one paragraph

Every company is its own **runtime**: one process, one data folder, fast to
install and independent of any platform. The company is described in a file
(`company.yaml`) and remembers everything in a database file (`company.db`).
It runs its humans and agents, keeps a heartbeat on every responsibility,
notices when something is missing, and is an MCP server your AI can plug into.
jamot.pro becomes a thin **hub** around many runtimes.

**Positioning:** *Not zero-human. Best-human.* Agents are becoming a
commodity; the people who run them well — **operators** — are scarce.

## 2. The four tiers

| Tier | What it is | Who pays |
|---|---|---|
| **Lite** | The runtime. Free and open source under MIT (D34). How the project spreads. | Nobody |
| **Hosted** | Jamot runs your runtime: one isolated container per company, backups on. | The company or its operator |
| **Pro / Enterprise** | Postgres, SSO, fleet management, support. Same core, bigger adapters. | Larger companies, franchises, operators with many clients |
| **Network** | The hub: directory, relay, identity, watchdog, operator reputation. | Usage and subscriptions |

One codebase, one data model, one company file, one MCP surface at every tier.

## 3. The runtime

```text
jamot  (one process, one port)
├── Web console        static SPA served by the runtime
├── API                Fastify
├── Company brain      org graph · readiness · agent harness · policy · memory
├── Heartbeats + jobs  in-process scheduler + jobs table, timezone-aware
├── Channels           Telegram only, through grammY (long polling)
├── MCP server         the Dream MCP surface
└── /data
    ├── company.yaml   structure: forkable, diffable
    ├── company.db     SQLite: people, conversations, memory, runs, ledger
    ├── secrets.key    generated on first run; never the session secret
    └── uploads/
```

Targets: boot < 2 s · idle memory < 150 MB · Docker image < 150 MB · no
required external service except an LLM key. (Bundle today: 2.8 MB.)

### Installing it (the Hermes way)

Installing is one line, then a wizard, like Hermes Agent:

```bash
curl -fsSL https://jamot.pro/install.sh | bash
jamot setup            # pick a template, paste an LLM key and a Telegram bot token
jamot start            # runs the company as a service (systemd / launchd)
```

| Command | Does |
|---|---|
| `jamot setup` | Wizard: template, owner account, model, Telegram |
| `jamot start` / `stop` / `status` | Run the company as a background service |
| `jamot doctor` | Diagnose: key valid, bot reachable, disk, last backup, version |
| `jamot update` | Update with an automatic backup before migrations |
| `jamot backup` / `restore` | Snapshot and restore `/data` |
| `jamot export` / `import` | `company.yaml` + `company.db`, portable to any machine |
| `jamot import hermes` / `import openclaw` | Bring an operator's existing skills and memory in |
| `jamot new <template>` | Start another company on the same machine (one folder each) |

Data lives in `~/.jamot/<company>/`. The installer only needs Node 22+; releases
are signed with published checksums, and the script can be read before running.
Docker (`ghcr.io/jamot-pro/jamot-lite`) stays for Hosted and for people who prefer it.

## 4. The six pillars, per runtime

| Pillar | In the runtime |
|---|---|
| Brain | **pi** (`pi-ai` + `pi-agent-core`), keys owned by the company, Ollama for local — see D3 |
| Orchestration | pi's agent loop + Jamot extensions: policy gate, memory rule, budgets, attribution |
| Persistent state | SQLite through Node's built-in `node:sqlite` (WAL, FTS5, `sqlite-vec` later) + `company.yaml` + Litestream backups — see D15 |
| Job queue | `jobs` table + in-process worker, croner, retries, dead-letter, per-provider limits |
| Event-driven | SQLite outbox, CloudEvents envelope, Telegram long polling (no public URL or webhook needed) |
| Observability | Runs page (tokens, cost, tool calls) in SQLite, pino logs, optional OpenTelemetry → Langfuse, opt-in crash reports |

New risks this model creates, and their answers: the process is a single point
of failure (restart policy, health check, **hub watchdog**); upgrades spread
across installs (migrations at boot with automatic backup, update channels);
no fleet-wide visibility (opt-in telemetry); the relay is the one shared
service left (treat it as production infrastructure from day one).

## 5. The company file

`company.yaml` holds the Dream (mission), teams, responsibilities, humans,
agents, tools, heartbeats, policies, survival settings, the named successor,
and which data may leave the company. It is versioned, with migrations between
versions. Templates are company files. Forking a company = copying the file.
Export = `company.yaml` + `company.db`.

## 6. Where the CRM lives

- **The company's CRM lives in the runtime** (`company.db`): contacts,
  identities and merging, conversations, memory about each customer, lists,
  consent. The company is the data controller.
- **The person's own profile lives with the person** (on the hub for now):
  account, the profile they choose to share, consents, reputation.
- A contact may be *linked* to a Jamot identity; the runtime receives only what
  the person agreed to share. No company reads another company's notes.
- Lead sourcing is a plugin. Deal pipelines come from connected CRMs (Twenty,
  HubSpot, Odoo) over MCP unless a template really needs them.

This reverses ARCHITECTURE §77.2, which keeps person memory in the marketplace.

## 7. Survival — the kernel

Runs locally in every runtime. Four vital signs:

| Vital | Measures |
|---|---|
| Money | Runway = balance ÷ burn, including LLM spend; from verified sources when connected |
| People | Readiness: unowned responsibilities, people gone quiet, bus factor |
| Work | Failing heartbeats, backlog, customers waiting |
| Runtime | Crashes, last backup, disk, version |

Escalation ladder: **notice → propose → escalate to a human (approve / reject
in one tap) → degrade gracefully → succession → dormant, not dead.**
Succession: if the owner is silent for N days, the successor named in the
company file is contacted and given access. The hub watchdog covers the case
where the runtime itself is down.

Claim we make: *it notices and proposes on its own; people decide. If people
disappear, it finds the next person.* Never "it runs itself".

Known bugs to fix when porting `dream/survival.ts`: the tier is written to
memory every minute even when unchanged; `low_funding` and `critical` behave
the same; quarantine state lives only in process memory.

## 8. Bring your own agent

The company sets the rules; the operator chooses the tools. Three ways in:
their AI connects to the company over MCP; the company calls their agent (HTTP,
MCP, later A2A harness); their tool is attached as an MCP tool.

Whatever the tool: policy applies in the runtime, every interaction with a
person becomes memory, permissions are scoped to the operator's
responsibilities, data egress is declared in the company file, who pays is
explicit, every action is attributed to agent + operator. Only work that passes
through the runtime counts toward reputation.

## 8b. Skills — the company's know-how

Skills are how a company does things: *how we quote a bathroom leak*, *how we
handle a refund*, *how we onboard a new family*. They use the open
**agentskills.io** format (a folder with a `SKILL.md`), so skills move between
Jamot, Hermes, Claude and other tools. They live in the company file's
`skills/` folder — versioned, diffable, forkable with the company. Today's
`skills` table (name, description, body, version) maps onto this.

**Skills write themselves, and people approve them:**

1. After a task finishes — especially one a *human* had to handle after an
   escalation — the agent drafts a skill from what happened.
2. The draft is **proposed**, never active: the owner of that responsibility
   approves, edits or rejects it (one tap on Telegram, diff in the console).
3. Approved skills are versioned; when a skill is used and the result is
   corrected, the agent proposes an improvement the same way.
4. A skill can never widen permissions: policy still gates every action.
5. Every skill records who wrote and approved it — a reputation signal for
   operators.

Why it matters: **when someone leaves, their know-how stays as skills.** That
is the hook — "the organization that doesn't die when people leave" — made
concrete. Survival's People vital counts responsibilities with no skills as a
bus-factor risk. Later, operators can publish skills on the hub.

## 8c. Add-ons — more than the base, never inside it

The base runtime is what every company needs: the company map, people and
memory, Telegram and the web chat, heartbeats and survival, tasks, the record
and MCP. Anything only some companies need — a product catalog, bookings,
invoices, a till — is an **add-on**: a separate package, off until a company
turns it on, that plugs into the runtime through one contract and touches the
base only through its ports. A company can run several add-ons on top of the
base. This section is the contract (D59); every add-on follows it.

**What an add-on is**

- One workspace package in `addons/<id>/`, named `@jamot/addon-<id>`, with
  its own `package.json`, tests and README. `<id>` is short, lowercase and
  unique (`catalog`, `bookings`).
- It exports one object made with `defineAddon` from `@jamot/addon-kit`:
  its id, name, version, a one-line summary, and what it adds (below).
- It depends only on `@jamot/addon-kit`, `@jamot/ports`, `@jamot/contracts`
  and the `Brain` types. The base never imports an add-on: no `if (catalog)`
  in core, the channel or the console's frame.
- The add-ons that ship are bundled into `jamot.mjs` and listed in the
  runtime's registry; a company turns them on in `company.yaml`
  (`addons: { catalog: { …its settings… } }`) or in the console (Settings →
  Add-ons). Loading add-ons from npm or a URL is **FUTURE**: running someone
  else's code inside the company's process is a security decision of its own.

**What an add-on may add — and nothing else**

| It may add | How | Rule |
|---|---|---|
| Tables | `migrations`, ids `<id>:0001_…`, applied after the base's | Every table is prefixed `<id>_`. Never alter or read a base table directly; never edit a migration that shipped |
| Its storage | A port (async interface) and its SQLite adapter, inside the package | Domain code uses the port; the base's data only through `CompanyStore` |
| Settings | Its section of `company.yaml`, checked by its own zod schema | Exported and imported with the company; secrets never here |
| Secrets | The secret store, names `<id>.…` | Never in logs, prompts, API responses or `company.yaml` |
| Agent tools | `agentTools(ctx)`: `BrainTool`s, names `<id>_…` | Anything with money, a contract or the physical world carries a policy (approval) in the same change |
| MCP tools | `mcpTools(ctx, caller)`, names `<id>_…` | Each tool decides what *this caller* may see: shared token, a connection, or a customer. Never a person's name or contact unless they published it |
| Console page | One page in `apps/web/src/addons/<id>/`, from `src/ui` components and contracts only | Shown only while the add-on is on; `pnpm ui-check` covers it |
| HTTP routes | Under `/api/addons/<id>/…`, behind the console's session | Public routes only under `/addons/<id>/public/…`, read-only or rate-limited, never people |
| Jobs | Handlers for job kinds `<id>.<kind>` | Same worker, same retries; a job that can't finish fails loudly |
| A heartbeat check | `check(ctx, now)` returning issues, like the vitals | Joins the company heartbeat; never sends on its own |
| Tasks | `createTask` with the requester (customer, agent, person) | Work that needs someone goes through the selector (D58), never around it |
| Events | Types `<id>.<what>` in the shared event log | Append-only, with an idempotency key |

It may not: change the base's tables, routes, commands, tools or screens;
add a Telegram command of its own (people talk to agents, and agents have the
add-on's tools); call another add-on except through a port that add-on
publishes and lists in `requires`.

**Rules every add-on keeps**

1. **Off by default; on and off are safe.** Turning it on runs its
   migrations; turning it off hides its tools, routes and page and keeps its
   data. Turning it on again finds everything where it was.
2. **The base works without it.** The runtime's tests pass with no add-on
   on, and the add-on's own tests start a runtime with it on.
3. **Money is integer minor units with an ISO currency**, like the ledger.
   No floats, ever.
4. **The agent proposes, a human decides** (AGENTS.md rule 3). An add-on
   never moves money or commits the company without a policy gate.
5. **People stay private.** An add-on publishes what the company offers,
   never who works there; customer data is the customer's memory
   (person scope).
6. **Every interaction with a person becomes memory**, through the base's
   intake, never another way.
7. **Recorded like the rest.** A decision in §12, a line in the add-ons
   table below, a ledger line, a README that says what it adds and what it
   costs (tables, tools, jobs).

**Add-ons**

| Id | What it adds | Status |
|---|---|---|
| `catalog` | Products and orders: what the company sells, and orders that become tasks (C6) | planned |

### The product catalog (`@jamot/addon-catalog`) — the first add-on

Light e-commerce for a small business, built the way the good small shops
do it:

- **Products:** a SKU (unique), name, description, price in minor units and
  one currency per company, whether prices include tax, images (URLs),
  tags, and stock — a number, or "not tracked". A product is active or
  archived, never deleted: old orders still point at it. Variants (size,
  colour) are separate SKUs grouped by a parent, not a second model.
- **Orders:** lines copy the product's name and price **at the time of the
  order**, so a later price change never rewrites what a customer agreed to.
  An order is created once per idempotency key; it moves *placed →
  confirmed → fulfilled*, or *cancelled*; stock is reserved on confirmation
  and released on cancellation.
- **Every confirmed order becomes a task** ("Fulfil order 1042") for the
  selector: an agent first (confirm the details, write the delivery note),
  then the person who owns fulfilment.
- **Payment:** none in the first version — paid on delivery or by invoice,
  outside Jamot. A payment link comes later, with its policy gate.
- **Agents** get `catalog_search`, `catalog_product` and `catalog_order`
  (an order above the founder's limit waits for their approval).
- **Over MCP** an outside agent can search the catalog, read a product, place
  an order for its customer and follow it — the customer side of C6. The
  public product list is also served as schema.org `Product` data, so other
  agents and search engines can read it.
- **Console:** a Catalog page — products, stock, orders — and a CSV import.

## 9. Growing up, out and across

- **Up** — one company gets big: SQLite → Postgres, in-process jobs →
  pg-boss / Temporal / DBOS, in-process events → NATS, local accounts → SSO.
  `jamot migrate --to postgres`.
- **Out** — many companies, one operator: a fleet control plane (provisioning,
  upgrades, backups, watchdog, billing). The first step is proven (S7):
  two companies on one machine, independent by process, one start per folder
  ([recipe](recipes/many-companies-one-machine.md), `pnpm isolation-check`).

  **The fleet control plane — designed, not built.** What the check taught
  us shapes it:
  - *Each company stays a process with its own folder.* The control plane
    never opens a company's database; it talks to each through its CLI and
    `/health`, as the isolation check does, so a bug in it can't corrupt a
    company.
  - *Provisioning* = `jamot import` into a new folder, plus a service
    (systemd, launchd or a container) with its own port, volume and limits.
    One company, one volume: a shared disk is the one thing the check showed
    companies still share.
  - *Upgrades one company at a time:* stop, swap the bundle, start, wait for
    `/health`; on failure, start the old bundle. The run lock (D42) makes it
    safe: no double start during a swap, no crashed company locked out.
  - *Backups* are per company already (D37); the control plane reads their
    age from each company and ships `backups/` off the machine.
  - *Watchdog:* `/health` per company on a schedule; a dead one is restarted
    by its service manager, a repeatedly dying one is reported, never
    restarted in a loop.
  - *Billing* stays out until there is a second operator.
- **Across** — companies working together through the hub, MCP and A2A. A
  large organization can be a parent runtime watching child runtimes.

Contracts to fix and version now: the company file · the Dream MCP surface ·
storage ports · CloudEvents · OIDC identity · full export/import.
Never write code that only works in Lite or only works at scale.

## 10. Operators and reputation (Network tier)

Operators build a verified, portable track record from the companies they run:
keeps it alive · delivers results · runs agents efficiently · reliable ·
trustworthy · peer-rated · experience. Companies sign attestations; the person
owns them (Verifiable Credentials later). Preconditions: verified data
sources, attribution from graph history (`validFrom`/`validTo`), append-only
audit trail, anti-gaming, GDPR-compliant profiling (transparency, consent,
contest). Investors backing people is still investing: Jamot provides evidence,
money moves through regulated channels.

## 11. v0.1 — the minimum viable build

**Done when this demo passes as an automated end-to-end test** on a clean
machine:

1. `curl -fsSL https://jamot.pro/install.sh | bash && jamot setup` (or
   `docker run -p 3000:3000 -v jamot-data:/data ghcr.io/jamot-pro/jamot-lite`)
2. Create the owner account, pick a template, paste an LLM key and a Telegram
   bot token.
3. A customer writes to the bot; the agent answers; the conversation lands in
   the customer's memory.
4. A responsibility has no owner; a heartbeat notices; the owner gets a
   Telegram message with a proposed fix.
5. The Runs page shows every agent run with tokens and cost.
6. The owner's own AI connects over MCP and answers "what's missing in my
   company?".
7. Export → import on another machine brings the company back with its memory.

**In:** company file + 7 templates · org graph, canvas, readiness · heartbeats,
survival v1, escalation · agent harness, policy approvals, Runs page · people,
identities, conversations, memory · Telegram (grammY) · Dream MCP surface ·
owner and member accounts.

**Communication in Lite is Telegram only, through grammY** (D10). Customers,
employees, the owner's escalations and approvals all go through Telegram.

**Out, and where it goes:**

| Out of v0.1 | Goes to |
|---|---|
| WhatsApp (Cloud API needs a public webhook) | Later, through the hub relay (Hosted / Network) |
| Web chat widget | Later |
| Chatwoot, mautrix bridges, Matrix | Optional connectors (Pro), never inside Lite |
| Litestream backups | v0.2 optional; default on Hosted |
| Marketplace, directory, supporters, identity, relay, watchdog | Network |
| Postgres adapter, SSO, fleet | Pro / Enterprise |
| Provisioning, billing | Hosted |
| Operator passport, attestations | Network, after the audit trail |
| Bettino, leads, outreach campaigns, commerce, payments, on-chain treasury, cross-org governance, Matrix, Graphiti, archetype-engine, HQ, CopilotKit | Dropped from Lite; stays in the archive repo |

### Repo layout

```text
JamotLite/
├── apps/runtime        entry point: one process, serves API + UI + MCP
├── apps/web            Vite + React SPA
├── packages/contracts  zod types + company-file schema (versioned)
├── packages/core       graph, readiness, heartbeats, survival, policy, memory, pi extensions
├── packages/ports      storage / job / event interfaces
├── packages/sqlite     SQLite adapters + migrations
├── templates/          the 7 companies as company.yaml
└── docs/
```

### Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Repo and decisions | New repo, CI (typecheck, test, lint), this doc, AGENTS.md, secret scan of imported code |
| M1 | Company file and storage | ✅ **Done.** Schema v1 and `company.yaml` (D16); 7 templates; one `CompanyStore` with graph, settings, people (identities, merge), conversations (inbound once, outbound queue), memory (FTS5 search), events (outbox), jobs (leases, retries, dead), ledger (integer minor units); atomic transactions across ports; live backup; import → export and backup → reopen round trips. Agents and tasks: see D18 |
| M2 | Brain | ✅ **Done.** `packages/brain`: the `Brain` port and `createPiBrain` on pi 0.99.1 — policy gate (allow / approve / deny), human approvals that pause a run and resume it on the decision (a second decision is refused), transcripts in the company database that survive restarts, crash repair of cut-off tool calls (never re-run), tokens and cost on every run (pi's price catalog), budgets (cost, turns), per-tool timeouts, one run at a time per session, an audit event per tool call, `connectModel` for Anthropic, OpenAI, OpenRouter and Ollama. The Runs page itself is M6 |
| M3 | Telegram and memory | ✅ **Done** (CRM screens move to M6 with the rest of the UI). `packages/telegram` on grammY 1.46 with long polling; every message in and out resolves the person first and becomes memory, in one transaction (`core/channels/intake.ts`); the reply agent is the one wired to Telegram in the company map, framed by the Dream and its rules, with `remember` / `recall` tools; the owner pairs with a one-time code and decides approvals with buttons only they can press; the encrypted secret store (`secrets.key`); a job worker with retries; `apps/runtime` wires it all into one process, tested end to end |
| M4 | Heartbeats and survival | ✅ **Done.** Heartbeats planned as jobs in the company's time zone (croner), once per slot, only the latest after downtime; each run is Monitor → Evaluate → Act → Verify: issues go to the owner once with a one-tap fix, a reminder after a day, and a ✅ when the next run finds them fixed. Vital signs: money (runway from the ledger, LLM spend), people (unowned responsibilities, owners gone quiet), work (customers waiting, failed replies, dead jobs), runtime (backup age, disk). The tier sets agent budgets and is recorded only when it changes; the successor pairs on Telegram and is contacted when the owner is silent too long, then stood down when they return. The three old survival bugs are gone. Not yet: the skills-based bus factor (skills arrive with §8b) |
| M5 | MCP | ✅ **Done.** `packages/mcp` on the official MCP SDK 1.31: the Dream MCP surface at `/mcp` (streamable HTTP, stateless, bearer token created on first start and stored encrypted) with ten tools — overview, what's missing, company map, people, a person's profile, a conversation, memory search and notes, recent runs with cost, pending approvals; agents get the MCP tools of servers attached to tool nodes they can reach, behind the SSRF guard; recipe in [recipes/connect-your-ai.md](recipes/connect-your-ai.md) |
| M6 | UI and packaging | ✅ **Done.** The console (Vite + React, 74 KB gzipped): sign-in, overview with vitals and one-tap fixes, company map with owner assignment, people (the CRM: profiles, memories, conversations), approvals, agent runs with cost, settings (model, Telegram pairing, MCP, company.yaml download); the `jamot` CLI (setup, start, status, doctor, ask, pair, mcp, backup, export, import, secret, password, templates, service install); one bundled `jamot.mjs` (2.8 MB, 870 KB packed) that runs with no `node_modules`; Dockerfile; install script; CI builds and runs the bundle standalone and builds the image; a release workflow for version tags. Not verified here: the Docker image (no Docker daemon on the build machine — CI builds it) and a live Telegram bot / real model key |

### Carried over from this repo

- **Keep:** `contracts`; `dream/` (readiness, heartbeat, templates, MCP tools,
  survival, quarantine); `policy/`; `people/merge`; `ingest/channel-person`;
  `channels/interaction-memory`; `mcp/ssrf`; canvas and people screens; their
  tests.
- **Rewrite behind ports:** storage (the runtime uses ~75 of today's 238
  repository methods), MCP client/server, scheduler, Telegram, auth, app shell.
- **Replace with pi:** `llm/` and `agent/` (loop, session, compaction, retry,
  hooks, nested) — see D3.

## 12. Decision log

### Decided

| # | Decision | Why |
|---|---|---|
| D1 | One runtime per company; jamot.pro becomes a thin hub | Independence, isolation by process, the "company is a file" story |
| D2 | New repo, fresh history, seeded by copying selected code (not a fork, not a rewrite) | Clean story and history; keep what is proven |
| D3 | **Brain: pi** (`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`), MIT, instead of our hand-written `llm/` + `agent/` | Our Agent Loop v2 (session tree, compaction, hooks, retries) re-implements pi's design. pi is mature, active and embeddable: `beforeToolCall` can block (our policy gate), `afterToolCall`/`finishTurn`/`subscribe` give audit and Runs, `prepareRequest` plugs in our session storage, and a SQLite session backend exists. Pending the spike in O1. |
| D4 | **No CopilotKit in Lite.** Console chat uses a thin streaming endpoint; AG-UI support considered later | Weight and a second AI stack; AG-UI keeps the door open without the dependency |
| D5 | The company's CRM lives in the runtime; the person's profile lives with the person | Data controller is the company; privacy across companies |
| D6 | Survival runs locally in every runtime, with four vital signs and an escalation ladder ending in succession | The product's core promise must not depend on the hub |
| D7 | Operators bring their own agents and tools; the company's rules apply in the runtime | Attract skilled operators; keep guarantees tool-independent |
| D8 | Primary persona: the AI Operator; local businesses arrive through operators | Operators are the distribution channel to small businesses |
| D9 | Fixed contracts: company file, Dream MCP surface, storage ports, CloudEvents, OIDC, export format | Lets Lite, Pro and Network interoperate |
| D10 | **Lite communicates through Telegram only, using grammY** with long polling. Every other channel sits behind the same `ChannelAdapter` interface and comes later | One channel done well; long polling needs no public URL, so it works on a laptop, a Pi or a VPS; inline buttons give one-tap approvals |
| D11 | **Install like Hermes Agent:** one-line installer, `jamot setup` wizard, runs as a service, `doctor` / `update` / `backup` / `import hermes`. Docker kept for Hosted | Operators install on a VPS in minutes; importing from Hermes and OpenClaw lowers switching cost |
| D12 | **Skills use the agentskills.io format and write themselves from experience, approved by a human** | The company's know-how survives people leaving; skills are portable across tools |
| D13 | Borrow from Hermes: Telegram DM pairing to link a user to a person safely; voice notes transcribed (plumbers and farmers send voice); sleep when idle on Hosted | Proven patterns, small effort |
| D14 | **Repo `jamot-pro/JamotLite`, licence AGPL-3.0-only** (licence replaced by MIT in D34) | Real open source; anyone running a modified Jamot as a service must share the source, which protects Hosted from closed clones while letting operators run it for paying clients; matches the guardian veto on closing the open-source core. (An earlier scaffold chose the Sustainable Use License; replaced, because it would have blocked the operator model.) |
| D15 | **SQLite through Node's built-in `node:sqlite`, plain SQL behind the ports, no ORM for now** (replaces "through Drizzle") | Zero native modules to build, so install stays one line on any machine; the ports already isolate SQL; migrations are a list of SQL strings applied at boot. Revisit if queries get complex. Requires Node 22.13+ (22.19+ with pi, D17) |
| D16 | **Company file on disk:** nodes grouped by kind (`teams:`, `agents:` …), an item's extra fields are its config, links written as `from relation to` lines; `jamot: 1` is the format version | Readable and forkable by people who don't code; errors point at the line they wrote |
| D17 | **O1 settled — adopt pi (`pi-ai` + `pi-agent-core`) behind our own `Brain` port.** Spike 2026-09-30 on 0.99.1, offline with fake providers: headless agent, 200 concurrent agents, policy gate in `beforeToolCall`, token usage and cost per call (built-in price catalog), MCP tools bridged in ~20 lines, resume after a kill — all pass. We write ourselves: approval pause/resume (block + `terminate`, then replace the tool result and `continue()`), per-tool timeouts, tool-name rules (`[a-zA-Z0-9_-]`), persisting the system message. Conversations live in our own `brain_messages` / `brain_runs` tables; not pi's `AgentHarness` or its SQLite backend for now | Mature loop we would otherwise rebuild. **Costs:** releases break every 2–3 weeks (pin exact versions, keep all pi code in one adapter, re-run the spike checks on each upgrade); install is ~118 MB with every provider SDK plus an esbuild binary, which threatens the < 150 MB image target — prune unused provider SDKs or fall back to pi-ai only with our own loop; needs Node 22.19+ |
| D18 | **Agents are graph nodes, not a separate store.** An agent's role, instructions and permissions live in its node's config (and so in `company.yaml`). Tasks, approvals and agent sessions are built in M2 with the Brain, where pi's needs decide their shape | One place defines an agent, forkable with the company; no storage built before its first user |
| D19 | **One `CompanyStore`, one connection, a queue.** Every port call is atomic on its own; `transaction()` makes work across ports atomic; calling the outer store inside a transaction throws instead of hanging | `node:sqlite` is synchronous with one connection per file; this keeps multi-step work (a message arrives: person, conversation, message, memory, event) all-or-nothing without an ORM |
| D20 | **How the Brain works around pi.** A session is one transcript (e.g. one Telegram chat with one agent), stored message by message in `transcript_messages`; the agent's instructions are a named system-prompt section, replaced in place when they change. An `approve` tool call is blocked with a "waiting for approval" result, and the agent gets one more turn to tell the person it's waiting (no pi `terminate`, so it speaks in its own words); the run ends as `awaiting_approval`. The decision writes the real result where the placeholder was, and the agent carries on. The brain tests are the gate for every pi upgrade: they exercise the approval flow, crash repair, budgets, timeouts and cost through pi | Keeps every pi-specific detail inside one package, with a test suite that fails loudly when upstream changes break us |
| D21 | **No automatic "dead" tier.** Survival tiers are normal, low_funding and critical; critical cuts agent budgets and raises it with the owner every day. Going dormant is a person's decision, never the runtime's | Stopping a company on a number is too dangerous to automate; the old tier list's "dead" becomes the human-decided dormant state (§7) |
| D22 | **The successor pairs on Telegram** (`createPairingCode("successor")`) instead of being named in `company.yaml`. Succession starts when the owner hasn't been seen for `survival.successionDays` (default 14): the successor is told, receives approvals and alerts, and can decide; it ends when the owner is seen again | A successor must be reachable to be useful; pairing proves they are. `company.yaml` can name one later for display |
| D23 | **The MCP surface reads and notes; it never approves.** Approvals stay with a person pressing a button on Telegram. MCP tools given to agents wait for approval unless the company file lists them in `allow`. A tool may opt into the company's own LAN with `allowPrivateNetwork`; loopback is always refused | A leaked token or a misbehaving external tool can't move money or act irreversibly on its own (AGENTS.md rule 3) |
| D24 | **Console sign-in for v0.1 is one owner password** (scrypt) and a signed session cookie keyed from `secrets.key`, instead of Better Auth | One owner per company in v0.1; nothing to run beside the runtime. Better Auth returns with members and roles (Pro) |
| D25 | **Distribution: one bundled file** (`esbuild` → `jamot.mjs`, with templates and the console beside it), installed from GitHub releases with npm or run from the Docker image; not the npm registry yet | 870 KB to download, no native modules, no `node_modules` at run time; `node:sqlite` is built into Node |
| D26 | **The overview headline is "responsibilities owned", not the readiness average** | The average hid three missing key roles behind "96%"; who owns what is what the owner must act on |
| D27 | **Jamot Lite is the home of the first stewards, and Jamot runs as a Jamot company.** Its charter and map are `jamot.company.yaml`; how stewards work is STEWARDS.md; who owns Jamot is PURPOSE.md (renamed from the J-Nesys CHARTER.md draft). J-Nesys stays the hub (Network tier) | A small, green repo new developers can ship in within a week; running Jamot on its own runtime is the proof and the first real user |
| D28 | **The contribution ledger starts now, in `CONTRIBUTIONS.md`, private and internal while Jamot is private.** Append-only; founding work first; `pnpm ledger` lists merged pull requests without a line | Contribution is recorded from day one so the 45% pool can be allocated fairly once the ownership plan is approved |
| D29 | **The charter gets an optional `vision`** in `company.yaml` (file format stays 1). The rest of the rename (Mission / Values / Goals labels, templates, console) is first issue 4 (GitHub #6) | J-Nesys adopted Company + charter on 2026-10-02; Jamot's own company file needs a vision now |
| D30 | **`jamot start --no-telegram` needs no bot token.** Anything that would reach Telegram fails with a clear error | A new developer can run the console and MCP before creating a bot |
| D31 | **People who join Jamot are onboarded by an agent, and asked — optionally — for their birth date, time and place to calculate their Human Design and Gene Keys** (`natalengine`, MIT; J-Nesys `archetype-engine` carried over). Other tests are self-reported. The data is private to the person and the agents working with them, deletable, never in exports of the company map, the ledger or public pages, and never used for roles, reviews or allocations. Built as a person-profile feature a company turns on (first issue 9, GitHub #11) | Agents that know who they work with collaborate better; making it optional and private keeps it consistent with values 3 and 4 |
| D32 | **How work moves:** branch `<area>/<short-name>` from `main`; one pull request per change with the template and its ledger line; the area's owner in `.github/CODEOWNERS` is asked automatically and reviews within 48 hours; squash-merge — one pull request, one commit, one ledger line. Branch protection needs a paid GitHub plan for a private repository, so for now this is a convention the Friday heartbeat checks | Clear, cheap rules the first stewards can follow from day one; the ledger stays one line per merged change |
| D33 | **Jamot Lite is the product, and launch means developers can join and build it.** J-Nesys is feature-frozen (its D16): fixes, security and the hub only; nothing in it is archived, and a module moves here when a company on Lite needs it. The launch gate is in STEWARDS.md | One founder can't grow two codebases; the people who build Jamot are its first users, so being ready for them is being ready |
| D34 | **Licence: MIT** (2026-10-03), replacing AGPL-3.0-only (D14), for Lite as for J-Nesys. Done while the founder was the only author, so no contributor's consent was needed | The widest adoption: any company, operator or developer can use and build on Jamot with no conditions, which matters more now than protecting Hosted from closed clones; Jamot's edge is its stewards, its companies and the hub, not the licence. Trade-off accepted: anyone may run a closed, changed Jamot as a service |
| D35 | **Fleet and isolation is a responsibility** (2026-10-03). Its first step — two companies on one machine, proven independent — is in scope now; the fleet control plane stays in the "Out" table until that check passes. J-Nesys's shared database and processes are not the model for running many companies | The founder's goal is shares in many businesses on one infrastructure, none able to harm another; process-per-company (D1) gives that only if it's proven and kept proven |
| D36 | **A company can run on a host behind a TLS proxy** (2026-10-03). `JAMOT_BEHIND_PROXY=1` trusts exactly one hop — the peer that connected — for the client address, and marks the session cookie `Secure`; `jamot start` sets the company up on first boot when `JAMOT_TEMPLATE` is set and the folder is empty. Jamot itself runs this way on Render (`render.yaml`) | Trusting the whole `X-Forwarded-For` would let a client write its own address and dodge the login limit; trusting none would make one guesser lock everyone out. First-boot setup means a container needs no interactive step, and a later boot never runs setup over a company that exists |
| D37 | **Backups are on by default** (2026-10-03). The running company snapshots `company.db` once a day into `backups/` in its folder and keeps the last 7; `secrets.key` is never copied there. `jamot restore` checks a backup and stages it as `restore.db`; the next start swaps it in before opening the database and sets the old one aside in `backups/`. Off-site replication (Litestream) is the next step, not a requirement | A company that only backs up when someone remembers doesn't back up. A snapshot without the key holds no readable secret, so it can travel anywhere. Staging makes a restore safe from a shell beside a running company, and reversible |
| D38 | **The bundle keeps class names, and CI proves it reaches Telegram** (2026-10-03). `scripts/build-options.mjs` sets `keepNames`; `pnpm smoke` bundles a grammy call with the same options and expects Telegram to refuse a fake token | Found live on Render: node-fetch (under grammy) recognises an abort signal by its class name, esbuild renamed the polyfill's class, and every Telegram call hung without an error. Tests run from source and couldn't see it; only the bundle can |
| D39 | **The web chat is a public channel, off by default** (2026-10-03). `/chat` answers 404 until the owner turns it on (`jamot webchat on`, or the console). A visitor is a person identified by a cookie signed with its own key (`provider: "web"`), scoped to `/chat`. Limits: 2,000 characters, 6 messages a minute per visitor (who must have opened the page) and 60 for the company, 10 new visitors a minute per address, a daily cost cap counted from the runs of `web:` sessions, after which it pauses until midnight UTC and the owner is told once. "Forget me" erases messages, memories, transcripts, the input and output of the runs, and the person. Lite still binds to 127.0.0.1; a company goes public through an HTTPS proxy or tunnel (`docs/recipes/web-chat.md`) | Many customers won't install Telegram, and a demo needs a browser. Everything public must be safe to leave on overnight: a cap in money, not just in messages, because cost is what can hurt the owner. Forgetting is a person's right and must be one click |
| D40 | **An outside AI joins as someone in the company, and only proposes** (2026-10-03). Each MCP connection has its own token tied to an agent or human of the company map, with `company` or `people` access; only a hash is kept. Every call is a run and an event under that node; a connection sees only its own runs and proposals. `propose` creates an approval (message a person, assign an owner); a person decides it on Telegram or in the console, and an approved message goes through the outbox like any other. Limits per connection: 30 calls a minute, 5 open proposals; run words only with people access; Telegram marks a proposal as coming from an outside AI. The shared token keeps working until revoked | Owners already have Claude Code, Hermes, OpenClaw; bringing them in is Jamot's answer to “bring your own agent”, but accountable: a name, limits and a history. MCP still never approves (D23) |
| D41 | **`jamot demo` runs on a scripted demo model, and only there** (2026-10-03). A template goes into a throwaway folder with web chat on, no Telegram, and a password made up for the run. The demo model answers from the company's own name, summary and vision, always labelled, at no cost; the runtime refuses it whenever Telegram is on, the console can't select it, and the console shows a banner while it's on. CI starts the bundle's demo and gets a reply | Time to first win was 30 minutes for a developer and out of reach for an owner. A demo must never be mistaken for the real thing, or reach a real person |
| D42 | **One running company per folder** (2026-10-03). `jamot start` takes `runtime.lock` in the company folder (pid, host, start time) and refuses a second start, naming the process that holds it. The running company refreshes a heartbeat in it every 10 s. On this machine a lock is left behind when its process is gone or carries our own pid (a restarted container); from another machine (two containers on one volume, a past Render instance) only when its heartbeat is 30 s old — a start waits that long, so a crashed instance's replacement still comes up. Release removes the lock only if it's still ours; short commands beside a running company don't take it. `jamot service install --port` lets companies share a machine | Two runtimes on one SQLite folder would race each other's jobs and outbox; the isolation check (S7) needs a company to be provably one process. A lock must never keep a crashed company down |
| D43 | **Continuous off-site copies with Litestream, optional** (2026-10-03). `jamot replicate set s3://…` stores the URL in settings and the bucket keys in the secret store; the running company supervises `litestream replicate <company.db> <url>`, restarting it with backoff, and passes the keys only as that process's environment (no other variable of ours). The endpoint passes the outbound URL check (private networks only with `--private-network`), at set time and every start; the binary is `JAMOT_LITESTREAM` or a system install, never a PATH search; Litestream is stopped (and awaited) before the run lock is released, and one a crash left running is ended at the next start. `jamot replicate restore` stages the replica's latest copy like any backup. `secrets.key` is never replicated: the owner keeps it elsewhere. The Docker image carries a pinned Litestream release, verified by checksum | Daily snapshots on the same disk don't survive losing the disk. Keeping the key out of the bucket means a leaked bucket leaks no secrets; the cost is that the owner must keep the key |
| D44 | **MCP sign-in with OAuth, for clients that only do OAuth** (2026-10-05). `/mcp` follows the MCP authorization spec (2025-11-25): a 401 names `/.well-known/oauth-protected-resource/mcp`; the runtime is its own authorization server (`/.well-known/oauth-authorization-server`, `/oauth/authorize`, `/oauth/token`), public clients only, PKCE S256 required, codes single-use for 10 minutes and kept in memory. A client is a Client ID Metadata Document URL (fetched through the outbound URL check, no redirects, 5 s, 20 KB, must name itself; cached 10 minutes — the check resolves the host before the fetch does, so DNS rebinding stays a known gap, bounded by the JSON-only, 20 KB, 5 s read) or registers itself (`/oauth/register`, HTTPS or localhost redirects, 50 kept, 10 an hour per address). Redirect URIs must match exactly; a bad client or redirect is shown on the page, never redirected to. The consent page names the client and its host, warns when it only redirects to this computer, lets the owner pick the map node and people access, and asks for the console password every time. A yes is a D40 connection: the access token is its token, for an hour; the refresh token (30 days) works once and rotates; revoking ends both, and every rotation, grant and revoke happens in one transaction, so two refreshes with one token can't both win and a refresh can't undo a revoke. The public address is `JAMOT_PUBLIC_URL`, else Render's `RENDER_EXTERNAL_URL`, else the request's (with a warning behind a proxy) | claude.ai's custom connectors and other hosted clients can't send a custom header, so a pasted token shuts them out. Making OAuth produce an ordinary connection keeps one model of who an outside AI is, what it may see and how to end it. The password (not the session cookie) guards consent because the page is reached from another site, where a SameSite=Strict cookie isn't sent |
| D45 | **The company as an MCP App, read-only** (2026-10-05). `company_dashboard` carries `_meta.ui.resourceUri` → `ui://jamot/company-dashboard` (`text/html;profile=mcp-app`): one self-contained page — no outside scripts, styles or requests — that hosts like Claude show in the conversation. It renders the tool's `structuredContent` (overview, what's missing, map, runs, proposals waiting and decided) with text nodes only, and its Refresh calls the same tool through the host, so the caller's access, limits and run log apply. Proposals show status only: deciding stays on Telegram or the console (D23). Hosts without MCP Apps get a one-line summary | "Show me the company" should be a picture, not a JSON dump, where the owner already talks to an AI. Approving from inside another company's app would let whoever holds a connection act as the owner |
| D46 | **The console is tokens, components and screens; its data shapes are contracts** (2026-10-05). `apps/web/src/ui` holds the design tokens (`tokens.css`, light and dark, also forced by `data-theme`), the components and their styles; pages in `src/pages` are made only of components — no class names, inline styles, raw layout tags or their own API types — checked by `pnpm ui-check` in CI. What the console's API returns is typed once in `packages/contracts/src/console.ts`, used by the runtime's routes and the pages. `/dev/ui` (development builds only) shows every component in every state; `pnpm dev:company` runs a seeded restaurant on the demo model for building against. The repository's `.claude/` carries the preview configurations, an after-edit hook (format, typecheck, UI rules) and the `new-screen`, `restyle` and `ui-review` skills | The UI will be redesigned more than once and is built mostly with Claude Code. A look that lives in one layer can change without touching screens; shared types turn API drift into build errors (two were found moving the pages over); a seeded preview and written skills let any session build and check a screen the same way |
| D47 | **Agents are managed from the console, by the owner only** (2026-10-05). The Agents page shows each agent's role, instructions, team, tools (its own and its team's), what it owns, the channels it answers, its runs and cost for 30 days and the outside AIs connected as it, and each tool's approval rule in a sentence. The owner changes name, role, instructions (8,000 characters at most) and team; sets the tools it uses itself; adds an agent (its key comes from its name); or retires one. Each change is one transaction and one `agent.*` event naming who made it; an agent reads its node at every run, so a change applies from its next run. Retiring ends the agent's edges and stamps `retiredAt`: it then answers no channel, owns nothing, is no owner candidate, can't be connected to (its MCP tokens stop working), and isn't exported; its runs stay. A company keeps at least one agent. None of this is reachable over MCP: an outside AI can only propose. The graph port gains `addNode` and `updateNode`. Approval rules stay on the tool (its `allow` list) | Changing an agent meant editing `company.yaml`, which a running company never reads again. Instructions steer what agents do, so only the owner's session changes them and every change is on the record; retiring keeps history that deleting would lose |
| D48 | **Stewards: the people who run a company, managed from the console** (2026-10-05). The Stewards page lists the company map's people with their role, Telegram and GitHub handles, team, what they own, whether their Telegram is linked and the AIs connected as them. The owner adds a person (key from the name), edits them, sets what they own (ticking a responsibility someone else owns moves it; unticking leaves it unowned, which the Overview and heartbeats show), and retires them like an agent (D47) — never the founder. Any steward can link their Telegram with a one-time code (24 h) from their card: the bot then knows them, and a team's heartbeat issues reach the team's linked people as well as the owner, without buttons and never twice to the same chat; deciding stays with the owner. Every heartbeat issue carries a scope: `team:<key>` (empty team, someone quiet), `company` (a responsibility nobody owns) or none — money, customers waiting, failed replies and jobs, backups — which only the owner reads. Successors per responsibility stay first issue 3 (#5) | The first stewards need a place in the company that's running, not only in `company.yaml`; alerts that only reach the founder don't make a company that outlives them |
| D49 | **The stewards' Telegram group hears the heartbeats; agents still talk one to one** (2026-10-05). The owner adds the bot to a group and sends `/here` there from their paired Telegram (anyone else is told only the owner can); the group is remembered and gets each heartbeat's company- and team-scoped issues (D48), without buttons — never money, customers' names or failures, which stay with the owner. Approvals and one-tap fixes stay in the owner's (and acting successor's) private chat. While there's a group, team heartbeats aren't also sent to stewards privately (D48). In the group the bot answers nothing but `/here` and a mention, which it points to a private chat; group talk never reaches the agents or memory. Removing the bot from the group forgets it. Settings shows the group and how to connect one | The last item of the launch gate. A group is shared by everyone in it, so it gets the company's pulse but never an agent conversation, where memory is kept per person |
| D50 | **The console takes J-Nesys's Modernist look: an icon rail and one workspace card** (2026-10-05). The tokens are J-Nesys's design system value for value: warm greys, near-black ink, one red accent (#ff2657) with a darker ink for text, Archivo 400/600/800 bundled with @fontsource (no font CDN, works offline), lucide icons, light and dark (the system's setting, or the switch in the rail, remembered per browser). The frame is a 60 px rail (logo, one icon per section with a tooltip, theme and sign out) beside a card that holds the page; on a phone the rail becomes a bottom bar and theme and sign out move into the page header. Only tokens, components and the frame changed (D46); no screen was rewritten | The founder chose a new structure and look before tasks are built (2026-10-05). J-Nesys is frozen (D33), so its look moves here; D46 made it a two-file change plus the frame |
| D51 | **Jamot is the founder's operating system (option C)** (2026-10-05). A founder brings the idea; agents do the work first; people from the founder's network are invited to open roles, onboarded on Telegram, and re-invited when someone drops a role; every contribution is recorded and the founder decides rewards. The agent never hires, removes, pays or rewards anyone on its own. No tokens, equity or payouts; no public marketplace until the experiment in VISION.md (2026-10-06 → 2026-11-30) says so. Built as C1–C5 in BLUEPRINT, after S10, additive to what runs today | Chosen over staying a small-business operator only (A) and an AI venture builder that recruits strangers and splits rewards itself (B): A undersells the idea, B carries legal, marketplace and fairness risk that hasn't been tested. C is about 70% built and can be tested on Jamot itself |
| D52 | **Open roles are filled by invitation, and the founder says yes** (2026-10-05). A responsibility nobody owns is an open role. The owner makes an invitation code for it in the console (Stewards → Open roles): one use, 24 hours, kept only as a hash in the `roles.invites` setting, a new code replacing an unused one. The person sends `/join CODE` to the bot, or opens `t.me/<bot>?start=CODE`; they see the charter and the role only, and the owner (and an acting successor) gets *Yes, welcome them / No* buttons, also shown in the console. On a yes, in one transaction, they become a person of the map owning the role and their Telegram is linked; then they get a welcome with the charter, who's who and what's still open, never money or customers (D49). Someone already in the company is pointed to the console; five wrong codes in an hour and the bot stops checking for that person. The agent never decides who joins | VISION.md step C2. Telegram is where the founder's network already is, and pairing codes (D48) already work there, so joining needs no new public page |
| D53 | **A quiet steward gets a kind check-in; with no answer, their roles open again** (2026-10-05). Jamot keeps when each linked steward last wrote to the bot or pressed a button (`stewards.lastSeen`). A steward who owns responsibilities and has been quiet for 14 days gets a private check-in with three buttons only they can press: *I'm still on it*, *Hand it over*, *Pause for 2 weeks*. Handing over opens their roles at once; pausing stops check-ins until the date; any message ends a check-in. With no answer 7 days later, their responsibilities become open roles and the founder is told who could take them, or to invite someone (D52). The person stays in the company. The timing is the `roles.dropCheck` setting (`quietDays`, `graceDays`). The founder isn't checked: the company's successor switch (D22) covers them. Stewards not linked on Telegram are never released, since Jamot can't tell they're quiet. The Stewards page shows when each was last heard from, and any pause or unanswered check-in | VISION.md step C3. People drop out of projects for ordinary reasons; asking first, kindly, and keeping them in the company makes it easy to step back and to come back, while the work doesn't wait for them |
| D54 | **The contribution record lives in the event log; the founder confirms and rewards** (2026-10-06). Joining (D52) and taking on a role count by themselves, read from the events those already write. A person adds work with `/did …` on Telegram; the founder gets *Confirm / Not this* buttons (and the console's Contributions page), and the person is told. The founder's own `/did`, and what they record in the console, count at once. A reward is a `reward.given` event: a note the founder writes ("€50 for the menu"), never a payment; Jamot moves no money. `/ledger` shows a steward their own record and rewards only; the founder sees everyone's. The Contributions page shows the record, the claims waiting, the rewards, and VISION.md's experiment numbers: joined of invited, first work within two weeks, active after six weeks, agent runs against people's contributions in 30 days, and roles picked up again after a hand-over. No migration: the event log is already append-only, which is what a record should be. Nobody confirms their own claim, an acting successor included. Each kind of event is read up to 10,000 at a time, which is years for a company of 1–50 people; an index comes when a company gets near it. It is separate from CONTRIBUTIONS.md, which records pull requests to Jamot itself | VISION.md step C4, and the measure for the experiment ending 2026-11-30. Rewards stay notes until there's legal advice (VISION.md, "not building yet") |
| D55 | **A new company is set up through a gate, by interview, on the web or Telegram** (2026-10-06). `jamot start` with no company, no `JAMOT_TEMPLATE` and a `JAMOT_PASSWORD` runs the setup gate instead of the runtime, on the same port. The console shows only the setup (after the password); every other route answers 503; the bot answers only the founder, who claims the setup with the code in the logs (or the console's *Continue on Telegram* link), and tells everyone else the company isn't open yet. Nine questions — name, the founder's name, what and for whom, why, three-month goals, what it never does, who's in and who's missing, what to hand to agents, who takes over — one at a time, with "I don't know yet" for all but the first three; the web and Telegram share the answers, kept in `.setup/setup.json` so a redeploy loses nothing. After a review and a starting point, *Start my company* creates it (the charter from the answers, the founder as owner, the Telegram founder already paired), keeps the answers in `setup.answers`, and the full runtime starts in the same process; the console session carries over. Agents, heartbeats, web chat and MCP don't exist before that. With `JAMOT_TEMPLATE` set, the first boot works as before | The founder's first minutes decide whether they stay. Templates fit known businesses, not a new idea; asking what Jamot needs, and nothing else running until it has it, is the onboarding VISION.md promises. Next: the company drafted from the answers (people, open roles, agents, successor), then the bot and model connected inside the gate |
| D56 | **The setup drafts the company from the founder's answers; the founder reviews it** (2026-10-06). When the interview is done, one model call turns the answers into a plan — teams, responsibilities and who owns each (the founder, an agent, a person they named, or open for an invitation), agents with instructions, the people named, the successor. Code then checks and builds it: at most 4 teams, 4 agents and 8 responsibilities; a person the founder didn't name is dropped and what they'd own becomes open; every agent's instructions end with the law (propose; never pay, sign, hire or promise without the owner); a heartbeat for the charter and one per team, so readiness is whole except the open roles; tools only from the closest template, never invented; the result must pass the company-file schema. The review shows the charter, who does what, the agents and people; *Draft again* asks once more, a changed answer drops the draft, and when the model can't give a usable plan the founder picks a template as before (D55). On Telegram the draft comes as a message with *Start my company* / *Draft again*, and after the start a short "this week" list: invite for the open roles, link the people named, pair the successor. While answering, the console shows the company taking shape. `pnpm dev:setup` runs the gate with a scripted model for building its screens | The setup's promise is that Jamot configures itself from a few answers; the model is good at the plan, code is reliable at the rules, and nothing exists until the founder says start |
| D57 | **A model that's down or busy never leaves a customer unanswered; a Telegram that stopped listening is told** (2026-10-06). Before, a model error ended the reply as "failed" with no retry. Now an error that passes — rate limit, overloaded, 5xx, timeout, network — first tries the **backup model** (Settings → Backup model; `model.fallback` and its key in the secret store; a `model.fallback_used` event), and if there's none or it fails too, the reply job is retried with the worker's backoff (10 s, 40 s, 90 s…). Only the last attempt records the failed answer the Overview counts. A refused request or a wrong key isn't retried. A retried reply reruns in the same session: errored turns are left out of what the model sees (pi does this), so at worst the agent sees the customer's question twice. When Telegram's long polling stops after starting — usually a 409 because another program polls the same token — the time and reason are kept (`telegram.stopped`, cleared on the next start) and the company heartbeat tells the owner, with what to do; sending still works, so the message gets through | From the architecture review (2026-10-06): the brain had one model and no plan B, and a stolen poll made the company deaf without anyone knowing. Both fixes stay inside the one process; the uptime check and replication are the owner's (Phase 1) |
| D58 | **Tasks: someone asks the company to get something done, and the company decides who does it** (2026-10-06). A task is a row in its own `tasks` table (migration 0006: a short number, title, details, status, responsibility, assignee, who asked, result, note); the jobs queue moves it with three new kinds — `task.route` (the selector), `task.run` (an agent works on it) and `task.tell` (a person is told) — so retries, the backup model (D57) and the run lock apply unchanged. Tasks are not jobs: a job is machine work that is retried and can die, a task lives for days, waits on people and stays on the record. A status change only happens from the statuses it expects, so two presses of one button never both win. **Who may ask:** the founder (`/task …` on Telegram, or by telling an agent, which has an `add_task` tool) — it starts at once; a steward — it waits for the founder's yes. Customers can't (C6 opens that over MCP). **The selector:** asks the model which responsibility the task belongs to (an answer that isn't one of them is ignored), then gives it to an agent first: the one that owns it, else one in a team that needs it, else the company's default agent. **The agent's turn** ends with one of three tools: `finish_task` (done, with the result for whoever asked), `hand_to_person` (to the responsibility's owner, else the founder) or `ask_founder` (answered with `/answer 12 …`, then the same agent carries on). An agent that only answers in words never marks its own work done: the founder sees the answer and decides. A run that fails waits for the founder with three buttons — give it to a person, I'll do it, cancel. **People** get the task on Telegram with Done and Can't; their Done waits for the founder's confirmation, and a confirmed task goes on their record (D54) — the founder's own Done needs nobody. Someone not linked on Telegram can't be told, so the task waits for the founder. **Follow-up** is part of the company heartbeat: a person with no news for 3 days is asked once how it's going, and the founder gets one summary a day (done, under way, waiting for you, no news). `/tasks` shows the founder everything and a steward only theirs and what they asked for; agents talking with the founder or a steward can report the same, never to customers. No console page: people work in Telegram, and a Mini App will read the same table | The founder's operating system (VISION.md, C5) needs work to move without the founder pushing it: agents first, people where agents can't, the founder deciding. A queue per person is the founder's idea; separate from jobs so a person not answering never looks like a broken runtime |
| D59 | **Add-ons: what only some companies need is a separate package, off by default, on top of the base** (2026-10-06). One contract for all of them (§8c): a workspace package `@jamot/addon-<id>` made with `defineAddon` from `@jamot/addon-kit`; its own prefixed tables and migrations, storage behind its own port, settings in its section of `company.yaml`, tools named `<id>_…` for agents and MCP, at most one console page made of the console's components, routes under `/api/addons/<id>`, job kinds `<id>.<kind>`, a heartbeat check, tasks through the selector. The base never imports an add-on; an add-on never changes the base. Bundled add-ons are listed in the runtime's registry and turned on per company; loading add-ons from npm is FUTURE. Money in minor units, policy on anything that commits the company, people never published. The product catalog is the first (C6) | The founder (2026-10-06): the catalog is an add-on, and more will follow on top of the base model. Without one contract each would reach into core and the base would stop being small; with it, a company carries only what it uses and the base stays the same for everyone |

### Open

| # | Question | Default if nobody decides |
|---|---|---|
| O2 | SQLite or PGlite | SQLite |
| O3 | Node or Bun | Node 22+ in Docker; Bun binary later |
| O8 | **Contributor licence agreement.** Under MIT (D34) contributions can already be used in any product, so a CLA is no longer needed to relicense; what remains is confirming contributors have the right to give their code (DCO) and how contributions count toward ownership. Must be settled before the first outside contribution, and must fit the steward-ownership charter | DCO now; decide CLA vs separate Pro code with counsel |
| O6 | Public names: Believers → Supporters; "Dream" as the mission field only; "Company map" for the canvas | Adopt with the new README |
| O7 | Hub hosting provider for Hosted runtimes | Fly Machines (scale to zero) |

## 13. Biggest risks

1. Telegram only: strong where Telegram is common (Indonesia, Eastern Europe,
   communities, operators), weaker where customers live on WhatsApp. Keep the
   `ChannelAdapter` interface clean so WhatsApp can follow through the relay.
2. The storage rewrite is where time goes — keep ports to what the demo needs.
3. Scope creep from the vision — every new idea goes to the "out" table until
   the demo passes.
4. Dependence on pi's pace of change — pin, wrap, test.
