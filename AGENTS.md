# AGENTS.md — read this before changing Jamot Lite

You are an AI coding assistant working in Jamot Lite. This file tells you what
the project is, where things live, and the rules you must not break. Humans:
this is also the fastest map of the codebase.

## What Jamot Lite is

Hermes and OpenClaw are your assistant; Paperclip manages your agents;
**Jamot runs your business** — its customers, its people, and a charter that
outlives them.

One company = one runtime: one process, one data folder (`company.yaml` +
`company.db`). The runtime runs the company's humans and agents, keeps a
heartbeat on every responsibility, notices what is missing (survival), remembers
every person it talks to, talks to people through Telegram and a web chat,
backs itself up every day, and is an MCP server that outside agents join as
someone in the company. The design, scope and every decision live in
[docs/RUNTIME.md](docs/RUNTIME.md) — read it before building anything.

Words: a **Company** runs from its **charter** — Vision, Mission, Values,
Goals. `dream` is only the code name for the charter (the root node,
`DreamConfig`); never write "Dream" in anything a person reads. People join as
**Stewards** (responsible; they govern), **Backers** (they fund) or **Taskers**
(they do tasks agents hand out). **Heartbeat** is a recurring Monitor →
Evaluate → Act → Verify check. **Memory** is everything the company knows
about its people. Never say "zero-human", "autonomous company" or "runs itself".

How a message, a heartbeat and an approval flow through the packages, where to
look for what, and the code conventions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Map

| Path | What lives there |
|---|---|
| `packages/contracts` | Shared types (zod): org graph, the charter (`DreamConfig`), company file, and what the console's API returns (`console.ts`). Change a shape here first. |
| `packages/company-file` | Reads and writes `company.yaml` |
| `packages/ports` | Storage interfaces the domain code uses (async, one company per database) |
| `packages/sqlite` | SQLite adapters (`node:sqlite`) and migrations |
| `packages/brain` | The agent brain: the `Brain` port and its pi adapter. pi's types never leave this package |
| `packages/telegram` | The Telegram channel (grammY): messages in, replies out, owner pairing, approval buttons |
| `packages/core` | Domain logic: company import/export, message intake, reply agents, approvals, secrets, the job worker |
| `packages/mcp` | The company as an MCP server (`/mcp`), and MCP tools for agents |
| `apps/runtime` | One company, one process: wires everything, serves `/api`, `/mcp` and the console; the `jamot` CLI |
| `apps/web` | The web console (Vite + React), served by the runtime. `src/ui`: tokens and components; `src/pages`: screens made of them; [DESIGN.md](apps/web/DESIGN.md) |
| `scripts/` | `build.mjs` (the bundle) and `install.sh` |
| `templates/` | The company templates, as `company.yaml` files |
| `interviews/` | What Jamot asks in a conversation (RUNTIME §8d): the founder's charter, a newcomer's welcome, and their skills — YAML and `SKILL.md`, changed without code |
| `jamot.company.yaml` | Jamot itself, run as a Jamot company: its charter, responsibilities and heartbeats |
| `STEWARDS.md`, `PURPOSE.md` | How the people who build Jamot work, and who owns it (private) |
| `CONTRIBUTIONS.md` | The contribution ledger: append-only, one line per merged pull request |
| `docs/START_HERE.md`, `docs/FIRST_ISSUES.md` | Joining as a contributor, from onboarding to first pull request; one first issue per responsibility |
| `docs/ARCHITECTURE.md` | The two-minute map: the three lifecycles, where to look, conventions |
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
pnpm ledger        # merged pull requests missing from CONTRIBUTIONS.md
pnpm dev:company   # a seeded company on :3000 for building the console
pnpm dev:web       # the console with live reload on :5173 (/dev/ui: every component)
pnpm ui-check      # the console's UI rules (rule 13)
```

Workflow: branch `<area>/<short-name>` from `main`; one pull request per
change, using the template; commits are a short capitalised sentence, no
prefix; the area's owner in `.github/CODEOWNERS` reviews; squash-merge.

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
12. **Personal data stays with the person.** Birth details, Human Design /
   Gene Keys readings and personality results live only in that person's
   profile: never in logs, the repository, exports of the company map, the
   ledger, or another person's prompt — and never used to decide roles,
   reviews or allocations (D31). Tests use made-up values.
13. **Screens are made of components, data comes from contracts** (D46). A
   page in `apps/web/src/pages` uses only components from `apps/web/src/ui`
   — no class names, no inline styles, no raw layout tags — and the shapes it
   reads from `@jamot/contracts`, which the runtime's routes are typed with.
   What a screen shows is decided on the server, not in the page. A new look
   is a change to `src/ui`, never to every page. `pnpm ui-check` enforces
   it; [apps/web/DESIGN.md](apps/web/DESIGN.md) is the guide.
14. **Add-ons live outside this repository** (RUNTIME.md §8c, D59, D60).
   Something only some companies need — a catalog, bookings, profiles — is
   its own repository built on `@jamot/addon-kit`, released signed, and
   downloaded by the companies that turn it on. Never add add-on code here:
   this repository holds the kit and the loader only. An add-on never changes
   the base's tables, routes or screens, and reaches the base's data only
   through the ports. Read §8c before changing the kit or the loader.

## Building the console with Claude Code

The repository carries its own setup in `.claude/`:

- **Preview:** start `company` (`pnpm dev:company`: a seeded restaurant on
  the demo model, nothing leaves the machine; the password is in
  `scripts/dev-company.ts`) and `console` (`pnpm dev:web`, port 5173). Check
  every change there — desktop, phone width, dark — and `/dev/ui`, which
  shows every component in every state.
- **Skills:** `new-screen` (a screen end to end), `restyle` (a new look,
  through tokens and components only), `ui-review` (before the pull request).
- **Hook:** after each edit in `apps/web` or `packages/contracts`, the file is
  formatted, the console typechecked and the UI rules checked; a problem
  comes back straight away.
