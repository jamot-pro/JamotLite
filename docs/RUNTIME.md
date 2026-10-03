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

## 9. Growing up, out and across

- **Up** — one company gets big: SQLite → Postgres, in-process jobs →
  pg-boss / Temporal / DBOS, in-process events → NATS, local accounts → SSO.
  `jamot migrate --to postgres`.
- **Out** — many companies, one operator: a fleet control plane (provisioning,
  upgrades, backups, watchdog, billing).
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
