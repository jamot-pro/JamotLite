# AGENTS.md — read this before changing Jamot Lite

You are an AI coding assistant working in Jamot Lite. This file tells you what
the project is, where things live, and the rules you must not break. Humans:
this is also the fastest map of the codebase.

## What Jamot Lite is

One company = one runtime: one process, one data folder (`company.yaml` +
`company.db`). The runtime runs the company's humans and agents, keeps a
heartbeat on every responsibility, notices what is missing (survival), remembers
every person it talks to, talks to people through Telegram, and is an MCP
server. The design, scope and every decision live in
[docs/RUNTIME.md](docs/RUNTIME.md) — read it before building anything.

Words: **Dream** is the company's mission. **Heartbeat** is a recurring
Monitor → Evaluate → Act → Verify check. **Memory** is everything the company
knows about its people. **Operator** is a person who runs agents for a company.
Never say "zero-human", "autonomous company" or "runs itself".

## Map

| Path | What lives there |
|---|---|
| `packages/contracts` | Shared types (zod): org graph, Dream, company file. Change a shape here first. |
| `packages/company-file` | Reads and writes `company.yaml` |
| `packages/ports` | Storage interfaces the domain code uses (async, one company per database) |
| `packages/sqlite` | SQLite adapters (`node:sqlite`) and migrations |
| `packages/brain` | The agent brain: the `Brain` port and its pi adapter. pi's types never leave this package |
| `packages/telegram` | The Telegram channel (grammY): messages in, replies out, owner pairing, approval buttons |
| `packages/core` | Domain logic: company import/export, message intake, reply agents, approvals, secrets, the job worker |
| `packages/mcp` | The company as an MCP server (`/mcp`), and MCP tools for agents |
| `apps/runtime` | One company, one process: wires everything, serves `/api`, `/mcp` and the console; the `jamot` CLI |
| `apps/web` | The web console (Vite + React), served by the runtime |
| `scripts/` | `build.mjs` (the bundle) and `install.sh` |
| `templates/` | The company templates, as `company.yaml` files |
| `jamot.company.yaml` | Jamot itself, run as a Jamot company: its charter, responsibilities and heartbeats |
| `STEWARDS.md`, `PURPOSE.md` | How the people who build Jamot work, and who owns it (private) |
| `CONTRIBUTIONS.md` | The contribution ledger: append-only, one line per merged pull request |
| `docs/START_HERE.md`, `docs/FIRST_ISSUES.md` | From clone to first pull request; one first issue per responsibility |
| `docs/RUNTIME.md` | Design, v0.1 scope, milestones, decision log |
| `docs/PORTS.md` | Which storage the runtime needs, port by port |

v0.1 is built (RUNTIME.md §11 milestones M0–M6). New work starts from the
decision log and the "Out" table there.

## Commands

```bash
pnpm install
pnpm lint          # biome
pnpm typecheck
pnpm test          # vitest
pnpm jamot --help  # the CLI, from source
pnpm build         # dist/: jamot.mjs, templates, console
```

## Rules you must not break

1. **Stay inside v0.1 scope.** If it's in the "Out" table of RUNTIME.md §11,
   don't build it. New ideas go to that table, not into code.
2. **Every interaction with a person becomes memory.** Resolve the person
   first, then record the inbound and outbound message. Never write memory
   another way.
3. **The agent proposes, a human decides.** Payments, contracts, hiring and
   anything irreversible go through policy approval — no exceptions, whichever
   AI or tool produced the action.
4. **Domain code never touches SQLite directly.** Go through `packages/ports`,
   so a Postgres adapter can exist later. Never write code that only works in
   Lite or only works at scale.
5. **Secrets stay in the secret store**, encrypted with `secrets.key`. Never in
   logs, API responses, prompts or `company.yaml`.
6. **Outbound URLs are checked** against SSRF before any fetch of a
   user-supplied URL.
7. **Never edit a migration that already exists.** Add a new one.
8. **Record decisions.** A change that settles an open question updates the
   decision log in RUNTIME.md in the same commit.
9. **pi stays inside `packages/brain`.** Other packages use the `Brain` types
   only. Upgrading pi means bumping the pinned version and making the brain
   tests pass again — never loosening them.
10. **Tests next to code** (`*.test.ts`). Match the surrounding style: biome
   formatting, plain comments that explain why.
11. **Every merged pull request adds its line to `CONTRIBUTIONS.md`.** Never
   edit an existing line; correct it with a new one.
