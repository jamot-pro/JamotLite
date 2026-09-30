# Jamot Lite

**The organization that doesn't die when people leave.**

Jamot Lite is a company runtime: one program, one folder, one company. Describe
your company in a file, and Jamot runs it with humans and AI agents side by
side — it remembers every customer, puts a heartbeat on every responsibility,
notices the moment something is missing, and is an MCP server your own AI can
plug into.

> **Status: pre-alpha.** Nothing runs yet. We are building v0.1 in the open —
> see [docs/RUNTIME.md](docs/RUNTIME.md) for the design, the decisions, and the
> milestones.

## What v0.1 will do

```bash
curl -fsSL https://jamot.pro/install.sh | bash
jamot setup      # pick a template, paste an LLM key and a Telegram bot token
jamot start
```

1. Start from a company template — café, restaurant, school, electrician,
   plumber, farm, online shop.
2. Customers write to your Telegram bot; an agent answers, and every
   conversation becomes the company's memory.
3. Heartbeats watch every responsibility. When one has no owner, you get a
   message with a proposed fix — approve it in one tap.
4. Every agent run shows its tokens and cost.
5. Connect Claude, Cursor or Hermes to your company over MCP.
6. Export the company — `company.yaml` + `company.db` — and run it anywhere.

## Not zero-human. Best-human.

Agents are becoming a commodity. The people who run them well are scarce.
Jamot is built for them: operators who set up and keep companies alive, and
build a track record doing it.

## Build it with us

- Read [AGENTS.md](AGENTS.md) — the map and the rules. Your AI reads it too.
- Pick a milestone in [docs/RUNTIME.md](docs/RUNTIME.md#milestones).

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

## Licence

[AGPL-3.0](LICENSE). Free to use, run, modify and share. If you run a modified
Jamot as a service, share your changes.

*Write your Dream. The rest is Just A Matter Of Time.*
