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
| **Lite** | The runtime. Free and open source under AGPL-3.0 (D14). How the project spreads. | Nobody |
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
required external service except an LLM key.

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
| Persistent state | SQLite (WAL, FTS5, `sqlite-vec` later) + `company.yaml` + Litestream backups |
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
| M1 | Company file and storage | Schema v1; SQLite ports for graph, people, memory, agents, tasks, jobs, events, ledger; 7 templates in YAML; export/import round-trip test |
| M2 | Brain | pi harness with Jamot extensions (policy gate, memory rule, budgets); Runs with tokens and cost; resume after restart |
| M3 | Telegram and memory | Telegram through grammY (long polling); person resolution → `recordInteractionMemory` for inbound and outbound; approve/reject buttons for escalations; CRM screens |
| M4 | Heartbeats and survival | croner + jobs; timezones; vitals; escalation with approve/reject; survival bugs fixed |
| M5 | MCP | Dream MCP surface on the official MCP SDK; "connect Claude" recipe works |
| M6 | UI and packaging | Onboarding, template picker, canvas, people, Runs, settings; installer + `jamot` CLI (setup, start, doctor, update, backup, export/import); image < 150 MB; boot < 2 s; the demo test passes |

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
| D14 | **Repo `jamot-pro/JamotLite`, licence AGPL-3.0-only** | Real open source; anyone running a modified Jamot as a service must share the source, which protects Hosted from closed clones while letting operators run it for paying clients; matches the guardian veto on closing the open-source core. (An earlier scaffold chose the Sustainable Use License; replaced, because it would have blocked the operator model.) |

### Open

| # | Question | Default if nobody decides |
|---|---|---|
| O1 | **pi spike (1–2 days):** run `pi-agent-core` headless with concurrent sessions; policy gate in `beforeToolCall`; sessions in our SQLite; token usage and cost for the Runs page (not documented in the agent README — check `pi-ai`); MCP tools bridged as pi tools; abort and timeouts; pin versions and wrap behind our own `Brain` port (the project moves fast — its npm scope already changed once) | Adopt pi if all pass; otherwise Vercel AI SDK + our existing loop |
| O2 | SQLite or PGlite | SQLite |
| O3 | Node or Bun | Node 22+ in Docker; Bun binary later |
| O8 | **Contributor licence agreement.** If Pro/Enterprise features are ever sold under a non-AGPL licence, Jamot Ltd needs the right to relicense contributions (a CLA), or Pro must be separate code. Must be settled before the first outside contribution, and must fit the steward-ownership charter | DCO now; decide CLA vs separate Pro code with counsel |
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
