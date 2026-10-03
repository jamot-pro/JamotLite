# How Jamot Lite works — the two-minute map

For a new steward who has read [START_HERE.md](START_HERE.md) and wants to know
where things happen before opening a file. The *why* behind every choice is in
[RUNTIME.md](RUNTIME.md) §12 (the decision log); the rules are in
[AGENTS.md](../AGENTS.md).

## Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Language | TypeScript 5.9 on Node.js ≥ 22.19 | ESM everywhere; pnpm workspace |
| Storage | `node:sqlite` (built into Node) | WAL, FTS5 for memory search; no ORM (D15) |
| Agent brain | pi (`@earendil-works/pi-agent-core` 0.99.1, pinned) | Wrapped behind our `Brain` port in `packages/brain` (D3, D20) |
| Telegram | grammY 1.x, long polling | The only channel in v0.1 (D10) |
| HTTP | Fastify 5 | `/api` for the console, `/mcp`, `/health`, the console itself |
| MCP | Official SDK 1.31 | Stateless streamable HTTP, bearer token (D23) |
| Scheduling | croner | Heartbeats in the company's time zone |
| Console | React 19 + Vite | Served by the runtime |
| Tooling | biome (lint + format), vitest, esbuild | `pnpm build` bundles one `jamot.mjs` (D25) |

About 9,500 lines of source across ten packages. Small enough to read the
part you own in an afternoon.

## The shape

```text
                       apps/runtime  ── one process per company: wires it all, CLI, HTTP
                     ┌──────┼───────────────┬───────────────┐
             packages/telegram        packages/mcp       apps/web (console)
                     │                      │                  │  (/api)
                     └──────────┬───────────┴──────────────────┘
                          packages/core        domain logic: intake, replies, approvals,
                                │              heartbeats, survival, readiness, import/export
                     ┌──────────┼──────────────┐
             packages/brain   packages/ports   packages/company-file
             (pi lives here)        │          (company.yaml ⇄ graph)
                               packages/sqlite
                                    │
                         company.db + secrets.key   ← the whole company, one folder
```

`packages/contracts` (zod types) sits under everything. Dependencies only point
down: `core` never imports `telegram` or `sqlite`; it talks to storage through
`ports` (rule 4), so a Postgres adapter can exist later.

## Lifecycle 1 — a customer writes on Telegram

1. **`packages/telegram/src/channel.ts`** — grammY receives the text and calls
   `receiveMessage`.
2. **`packages/core/src/channels/intake.ts` → `receiveMessage`**, in **one
   transaction**: find or create the person by their Telegram identity, open
   the conversation, store the message (a duplicate is ignored), write it to
   the person's **memory**, append an event, and enqueue an `agent.reply` job.
   Nothing is ever half-recorded.
3. **`packages/core/src/jobs/worker.ts`** — the worker claims due jobs with a
   lease, runs the handler, retries with backoff on failure.
4. **`packages/core/src/agents/reply.ts` → `replyToMessage`** — finds the agent
   wired to Telegram in the company map, builds its instructions from the
   charter and its rules, adds the person's recent memory and tools
   (`remember` / `recall`, MCP tools it can reach), and runs the **brain**.
5. **`packages/brain/src/pi-brain.ts`** — pi runs the turn. Every tool call
   passes the **policy gate**: `allow` runs, `deny` refuses, `approve` pauses
   the run (lifecycle 3). Tokens and cost are recorded on the run.
6. Back in `reply.ts`, the answer is **queued** as an outbound message.
   `telegram.sendPending()` sends it, and `recordSent` writes it to memory —
   again in one transaction.

## Lifecycle 2 — a heartbeat fires

1. **`packages/core/src/heartbeats/schedule.ts` → `planHeartbeats`** (every 30
   s) turns each heartbeat's cron, in the company's time zone, into a
   `heartbeat.run` job — once per slot, only the latest after downtime.
2. **`heartbeats/run.ts` → `runHeartbeat`**: **Monitor** (read the vital
   signs from `survival/vitals.ts`: money, people, work, runtime) →
   **Evaluate** (open issues vs the last run) → **Act** (tell the owner once,
   with a one-tap fix, through the `Notifier`) → **Verify** (the next run marks
   issues fixed and says so).
3. The owner taps a fix in Telegram → **`heartbeats/actions.ts`** applies it
   (e.g. assign a responsibility). If the owner has gone quiet, issues go to
   the **successor** (`notify.ts`, `SUCCESSION`).

## Lifecycle 3 — an agent wants to do something irreversible

1. A tool with `policy: "approve"` (a refund, a payment) is called → the brain
   stores an **approval** and pauses the run.
2. `onApprovalNeeded` → the owner gets Approve / Reject buttons on Telegram
   (and the console's Approvals page).
3. **`reply.ts` → `decideApproval`** resumes the run with the decision; a
   second decision is refused. The customer gets the outcome.

## Where to look

| I want to… | Look at… |
|---|---|
| Change what a company file can say | `packages/contracts/src/company-file.ts`, then `packages/company-file/src/yaml.ts` |
| Add or change a template | `templates/*.yaml` (the round-trip test checks every one) |
| Change how agents think or what they're told | `packages/core/src/agents/spec.ts`, `reply.ts` |
| Add a tool agents can use | `packages/core/src/agents/` (built-in) or an MCP server on a tool node |
| Change a heartbeat check or a vital sign | `packages/core/src/heartbeats/`, `packages/core/src/survival/` |
| Store something new | a port in `packages/ports`, its adapter + a **new** migration in `packages/sqlite` |
| Add an API endpoint for the console | `apps/runtime/src/api.ts` (+ `api.test.ts`) |
| Add a console page | `apps/web/src/pages/` |
| Add a CLI command | `apps/runtime/src/cli.ts`, `cli/commands.ts` |
| Expose something to the owner's AI | `packages/mcp/src/server.ts` (read and note only — D23) |
| See how it all starts | `apps/runtime/src/runtime.ts` → `createRuntime` |

## Conventions

- **Files:** kebab-case (`memory-tools.ts`); React pages PascalCase
  (`Overview.tsx`). Tests sit next to the code: `thing.ts` → `thing.test.ts`.
- **Tests:** vitest, end to end where it matters. `apps/runtime/src/runtime.test.ts`
  runs a whole company offline with a fake Telegram and a fake model
  (`@jamot/brain/testing`) — copy its style for anything that crosses packages.
  The console (`apps/web`) has no tests yet.
- **Errors:** plain `Error` with a sentence a person can act on ("no Telegram
  bot token is stored yet — run `jamot setup`"). Errors aren't swallowed:
  background loops log them with a `[area]` prefix and keep going.
- **Atomicity:** anything that records a message, a decision or a job happens
  inside `store.transaction(...)`.
- **Money** is integers in minor units; **cost** is micro-USD.
- **Comments** say *why*, in plain sentences. biome formats; don't fight it.
- **Commits:** a short sentence saying what changed, capitalised, no prefix
  (see `git log`). Branches: `<area>/<short-name>`, e.g. `survival/successors`.
