# Blueprint — v0.2, "a business you can trust with your customers"

The construction plan for items 1–8 of [PRODUCT-BRIEF.md](PRODUCT-BRIEF.md) §6.
Each step is one pull request, owned by a responsibility in
[STEWARDS.md](../STEWARDS.md), and written so a steward — or their AI — can
pick it up cold: read the step, not the steps before it.

**v0.2 is done when** a person with no keys and no bot runs one command and
talks to a company in their browser; a real business has run on Jamot Lite
for 30 days with its backups on; two companies run on one machine without
touching each other; and the owner's own AI can work inside the company as a
named agent.

## The order

```text
S0  merge v0.1 + onboarding (#1, #2) ─────────────────────────────┐
 │                                                                 │
 ├─ S1 README repositioned ──────────────┐  (anyone, now)          │
 ├─ S2 charter everywhere (#6) ──────────┤                         │
 ├─ S3 import names the folder ──┬───────┤                         │
 ├─ S4 backups (Litestream) ─────┤       │                         │
 │                               ├─ S7 fleet & isolation (#12)     │
 ├─ S5 web chat ─────────────────┴─ S6 jamot demo                  │
 ├─ S8 bring your own agent                                        │
 └─ S9 founder's business, 30 days  (starts after S2 + S4) ────────┤
                                                   S10 release v0.2┘
```

Parallel after S0: **S1, S2, S3, S4, S5, S8** share no files and can run at
the same time. S6 waits for S3 and S5; S7 for S3 and S4; S9 starts once S2
and S4 are merged and runs for 30 days alongside everything else.

| Step | Responsibility | Size | Model tier | Depends on |
|---|---|---|---|---|
| S0 Merge v0.1 and onboarding | Quality and releases | S | — | — |
| S1 README repositioned | Stewardship and the ledger | S | default | S0 |
| S2 Charter everywhere | Console and onboarding | M | default | S0 |
| S3 Import names the folder | Quality and releases | S | default | S0 |
| S4 Backups on by default | Fleet and isolation | M | default | S0 |
| S5 Web chat channel | Telegram and channels | M | **strongest** | S0 |
| S6 `jamot demo` | Templates and first companies | M | default | S3, S5 |
| S7 Two companies, one machine | Fleet and isolation | M | **strongest** | S3, S4 |
| S8 Bring your own agent | Runtime and brain | M | **strongest** | S0 |
| S9 The founder's business, 30 days | Templates and first companies | M, mostly not code | — | S2, S4 |
| S10 Release v0.2 | Quality and releases | S | default | all |

*Strongest* = the step touches a public endpoint or authentication; use the
most capable model you have, and ask for a second review.

## Invariants — true after every step

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass; CI green.
- Dependencies point down: `core` never imports `sqlite`, `telegram` or a
  channel package; storage goes through `ports` (AGENTS.md).
- Every message in or out resolves the person first and becomes memory, in
  one transaction ([ARCHITECTURE.md](ARCHITECTURE.md), lifecycle 1).
- Anything irreversible waits for a person; MCP never approves (D23).
- No personal data in the repository, logs or tests (AGENTS.md rule 12).
- Migrations are only added, never edited. A settled question adds a line to
  the decision log ([RUNTIME.md](RUNTIME.md) §12). One pull request, one
  ledger line ([CONTRIBUTING.md](../CONTRIBUTING.md)).
- **Rollback for every step:** revert its squash commit. Every migration is
  additive, so a revert never needs a down-migration.

---

## S0 · Merge v0.1 and onboarding

**Context.** `main` holds only M0. The runtime is on `v0.1` (pull request #1)
and the onboarding docs on `stewards-onboarding` (#2), stacked.
**Tasks.** Merge #1, then retarget #2 to `main` and merge it, then this
branch. Tag `v0.1.0`.
**Verify.** `git log main --oneline | head`; CI green on `main`.
**Exit.** `main` has v0.1, the onboarding docs and this blueprint;
STEWARDS.md's launch gate has its third box ticked.

## S1 · README repositioned

**Context.** [PRODUCT-BRIEF.md](PRODUCT-BRIEF.md) §1 is the positioning:
Hermes and OpenClaw are personal assistants, Paperclip manages agents doing
internal work, **Jamot runs the business** — customers, people, a charter
that outlives them. The README opens on "the company that doesn't die" and
doesn't yet say how Jamot differs from those three.
**Tasks.**
- Add a short "Jamot and the agents you know" section after "Why Jamot":
  the comparison table and the one-liner from the brief, fair to each project.
- Make the first screen say who it's for: a business with customers and
  people, and the operator who runs it.
- Mirror the one-liner in `docs/START_HERE.md`'s welcome and AGENTS.md's first
  paragraph.
**Verify.** The link checker finds no broken link; read the first screen
aloud — it should answer "what is it, for whom, why not Paperclip".
**Exit.** Merged; no feature claimed that isn't built (chapters keep ✅🔨🌱).

## S2 · Charter everywhere — first issue 4, GitHub #6

**Context.** Jamot's words are Company and its **charter**: Vision, Mission,
Values, Goals. In `company.yaml` they are `vision`, `objective`,
`constraints`, and `outcomes` / `kpis` / `timeline` (format 1, D29). The
console, CLI, templates and agent instructions still say "Dream".
**Tasks.** Exactly as written in [FIRST_ISSUES.md](FIRST_ISSUES.md) §4.
**Verify.** `git grep -niw dream -- apps templates packages/core/src/agents`
shows only code names; the round-trip test passes for all templates.
**Exit.** `jamot setup` asks for the four parts; the Overview shows them.

## S3 · `jamot import` names the folder after the company · [GitHub #14](https://github.com/jamot-pro/JamotLite/issues/14)

**Context.** `jamot import templates/x.yaml` puts every company in
`$JAMOT_HOME/company/`, so a second import collides with the first. S6 and
S7 both need one folder per company id. Part of first issue 7 (GitHub #9).
**Tasks.**
- `apps/runtime/src/cli/paths.ts` / `commands.ts`: the folder is the file's
  `dream.id`; `--as <id>` overrides; importing over an existing folder is
  refused with a sentence saying how to replace it.
- `jamot start`, `status`, `ask`… take `--company <id>` when there is more
  than one, and say which ones exist when it's missing.
**Verify.** `commands.test.ts`: two imports → two folders; collision refused.
**Exit.** Two companies can live in one `JAMOT_HOME`.

## S4 · Backups on by default · [GitHub #15](https://github.com/jamot-pro/JamotLite/issues/15)

**Context.** A business's whole life is `company.db` + `secrets.key` in one
folder. `jamot backup` exists (`commands.ts`, `store.backup`) but nothing runs
it; the vital signs already read *backup age* (`survival/vitals.ts`).
Litestream was planned for v0.2 (RUNTIME §11).
**Tasks.**
- A built-in backup heartbeat: a consistent snapshot every night to a folder
  the owner chooses, keeping the last N; backup age turns red after 48 hours.
- Optional continuous replication with Litestream to S3-compatible storage,
  configured in `jamot setup` and the console; the credentials go in the
  secret store.
- `jamot restore <backup>` with a dry run, and a recipe:
  `docs/recipes/backups.md`. A test restores a snapshot and finds the memory.
- A decision-log line: what is backed up, where `secrets.key` goes (never next
  to the database in the same bucket unencrypted).
**Verify.** Restore round trip test; the vital sign flips when backups stop.
**Exit.** A new company has nightly backups without the owner doing anything.

## S5 · Web chat channel · [GitHub #16](https://github.com/jamot-pro/JamotLite/issues/16)

**Context.** Telegram is the only channel (`Channel = "telegram"` in
`packages/ports/src/conversations.ts`). A demo, and many customers, need to
talk to a company from a browser. Intake already handles any channel
(`packages/core/src/channels/intake.ts` → `receiveMessage`).
**Tasks.**
- `Channel` gains `"web"`; a new migration only if the schema needs it.
- `packages/webchat` (or a module in `apps/runtime`): `GET /chat` serves a
  small page; `POST /chat/messages` takes text; replies stream back over SSE.
  The visitor is a person identified by a signed cookie (`provider: "web"`),
  resolved before anything else; every message becomes memory.
- Public by design, so: off by default, turned on per company; size limit,
  rate limit per visitor and per company, and a daily cost cap that pauses
  web replies and tells the owner; no console or MCP route reachable through
  it; the visitor can ask to be forgotten.
- A decision-log line on how the runtime is exposed (Lite binds to
  127.0.0.1; web chat goes public through a tunnel or reverse proxy — recipe).
**Verify.** End-to-end test in `runtime.test.ts` style: visitor writes →
agent answers → both in the person's memory; rate limit and cost cap tested;
`route-guard`-style test that console routes stay behind auth.
**Exit.** A customer can talk to the company in a browser, safely.

## S6 · `jamot demo` · [GitHub #17](https://github.com/jamot-pro/JamotLite/issues/17)

**Context.** Time to first win is about 30 minutes for a developer and out of
reach for an owner (brief §5); Paperclip starts with one command. The test
model `fakeModel` lives in `packages/brain/src/testing.ts`.
**Tasks.**
- `jamot demo [template]`: imports a template into a throwaway folder (S3),
  starts it with no Telegram and web chat on (S5), and opens the browser.
- A **demo model**: answers from the company's charter and template with
  scripted, clearly labelled replies ("demo model — add a real one in
  Settings"); can never be selected for a company with Telegram or real
  people, and the console shows a banner while it's on.
- README "Start a company" leads with `npx jamot demo` (or the installer).
**Verify.** CI runs `node jamot.mjs demo --no-open` from the bundle and posts
one chat message; the reply arrives with no network.
**Exit.** One command, no keys, a company answering in under 5 minutes.

## S7 · Two companies, one machine — first issue 10, GitHub #12

**Context and tasks:** exactly as written in [FIRST_ISSUES.md](FIRST_ISSUES.md)
§10 (decision D35). Needs one folder per company (S3) and backups per company
(S4).
**Verify.** `scripts/isolation-check.mjs` in CI.
**Exit.** The fleet control plane is designed in RUNTIME §9 from what the
check taught us — designed, not built.

## S8 · Bring your own agent · [GitHub #18](https://github.com/jamot-pro/JamotLite/issues/18)

**Context.** Owners already have Hermes, OpenClaw, Claude Code. Today they can
connect over MCP (`packages/mcp/src/server.ts`, ten tools) with one company
token, as nobody in particular; MCP reads and notes, never approves (D23).
Paperclip's strength is "bring your own agent"; ours should be "bring your
agent **into the company**, accountable".
**Tasks.**
- One MCP token per connection, tied to a node in the company map — an agent
  or a human — created in the console or with `jamot mcp add <node>`, and
  revocable. The old shared token keeps working until revoked.
- Every MCP call is recorded as that node's activity (events, Runs page).
- A `propose` tool: an external agent can propose an action (message a
  customer, change an owner) that becomes an **approval** for a person — it
  never acts directly.
- A recipe per agent: `docs/recipes/connect-hermes.md`, `connect-openclaw.md`,
  next to the existing `connect-your-ai.md`.
**Verify.** Tests: a token sees only what its node may see; a revoked token is
refused; `propose` creates an approval and nothing else.
**Exit.** "Claude, as our Ops agent" shows up in the company with its own name
and history.

## S9 · The founder's business, 30 days

**Status: running since 2026-10-03 — Jamot runs as a Jamot company, until
2026-11-02. Journal: [S9-JOURNAL.md](S9-JOURNAL.md).**

**Context.** The one thing that 10× Jamot is a real business visibly running
on it (brief §4). It runs on charter-aware Lite (S2) with backups on (S4).
**Tasks.**
- Write the business's `company.yaml` (start from the closest template) in its
  own private repository; `JAMOT_HOME` outside this repository.
- Run it on a machine you control, owner and successor paired on Telegram,
  web chat on once S5 lands.
- Every Friday: what broke becomes an issue labelled `from: real company`; a
  short note in the weekly update.
**Exit.** 30 days of real conversations and heartbeats; the issues filed; a
`help` ledger line for each person who helped; brief §4 re-scored.

## S10 · Release v0.2

**Tasks.** Changelog from the ledger; tag `v0.2.0`; the release workflow builds
the bundle and image; re-run [PRODUCT-BRIEF.md](PRODUCT-BRIEF.md) and update
its scores. **Exit.** v0.2 installed from the release on a fresh machine.

---

## Review — what the adversarial pass changed

Reviewed against the blueprint checklist (completeness, dependency order,
cold-start briefs, anti-patterns):

- **S0 added.** Every step assumed `main` held v0.1; it doesn't yet.
- **S3 split out of first issue 7.** Demo and fleet both silently depended on
  one folder per company.
- **Backups moved before the real business (S9 after S4).** Thirty days of a
  real business's memory with no backup was the plan's worst risk.
- **Web chat marked strongest-tier, off by default, with a cost cap.** It is
  the first public endpoint in Lite; an open chat with a paid model is an
  invoice waiting to happen.
- **The demo model can't reach real customers.** A scripted model answering a
  real person would break the "agent proposes, person decides" promise.
- **S8 keeps D23.** External agents propose; they never approve or act.

## Changing this plan

Split, insert, skip or reorder a step in a pull request that edits this file,
with one line in the log below saying why. A step that turns out bigger than
one pull request is split before it's started, not halfway.

| Date | Change | Why |
|---|---|---|
| 2026-10-03 | Plan written | From PRODUCT-BRIEF.md §6 |
| 2026-10-03 | S3–S6, S8 opened as GitHub #14–#18; S2, S3 (with #9) and S7 labelled `v0.2` | So stewards can pick steps up on GitHub |
