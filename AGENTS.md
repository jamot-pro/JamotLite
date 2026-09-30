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
| `packages/contracts` | Shared types (zod). Change a shape here first. |
| `docs/RUNTIME.md` | Design, v0.1 scope, milestones, decision log |

The full layout planned for v0.1 (`apps/runtime`, `apps/web`, `packages/core`,
`packages/ports`, `packages/sqlite`, `templates/`) is in RUNTIME.md §11. Create
those folders when a milestone needs them, not before.

## Commands

```bash
pnpm install
pnpm lint          # biome
pnpm typecheck
pnpm test          # vitest
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
9. **Tests next to code** (`*.test.ts`). Match the surrounding style: biome
   formatting, plain comments that explain why.
