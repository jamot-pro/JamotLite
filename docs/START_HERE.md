# Start here — from clone to your first pull request

For a new steward. Read [STEWARDS.md](../STEWARDS.md) first for the why and
the roles; this is the how. About 30 minutes.

## 1. What you're building, in one paragraph

Jamot Lite runs **one company in one process**: a `company.yaml` describes it
(its charter, teams, responsibilities, people, agents, heartbeats), and the
runtime keeps it alive — agents answer people on Telegram within the company's
rules, every conversation becomes memory, heartbeats check every
responsibility on a schedule, and anything irreversible waits for a human. The
company is also an MCP server, so anyone's own AI can connect to it. Design
and every decision: [RUNTIME.md](RUNTIME.md).

## 2. Run it

You need **Node.js 22.19+** and Git. pnpm comes through corepack.

```bash
git clone https://github.com/jamot-pro/JamotLite.git jamot-lite && cd jamot-lite
corepack enable
pnpm install
pnpm lint && pnpm typecheck && pnpm test     # all green before you change anything
```

Start a company from a template, without a Telegram bot, in a scratch folder
so it never mixes with a real one:

```bash
export JAMOT_HOME=$PWD/.dev-companies       # gitignored: your local companies live here
pnpm jamot import templates/bali-cafe.yaml
pnpm jamot password                           # the console password (10+ characters)
pnpm jamot start --no-telegram --port 3000
```

Open <http://127.0.0.1:3000> and sign in. You'll see the café's overview,
company map, people, approvals and agent runs. To let agents answer, add a
model in **Settings → Model** (an Anthropic, OpenAI or OpenRouter key, or a
local Ollama). Then:

```bash
pnpm jamot ask "What's missing in this company?"
pnpm jamot status
```

Working on the console? Keep the runtime running and start Vite next to it —
it proxies `/api` to port 3000:

```bash
pnpm --filter @jamot/web dev                  # http://127.0.0.1:5173
```

Want a real bot? Create one with [@BotFather](https://t.me/BotFather), run
`pnpm jamot secret set telegram.botToken`, start without `--no-telegram`, and
pair yourself with `pnpm jamot pair`.

**Jamot itself** is a company too:
`pnpm jamot import jamot.company.yaml` starts Jamot's own map — the
responsibilities you're about to own.

## 3. Find your way around

[AGENTS.md](../AGENTS.md) is the map of the code and its ten rules. The ones
people trip on:

- Stay inside v0.1 scope (RUNTIME.md §11, the "Out" table).
- Domain code goes through `packages/ports`, never SQLite directly.
- The agent proposes, a human decides — anything irreversible needs an approval.
- Never edit an existing migration; add a new one.
- A change that settles a question adds a line to the decision log (RUNTIME.md §12).

Your AI reads AGENTS.md too. Point Claude Code, Cursor or Codex at the repo
and start from your first issue.

## 4. Your first pull request

1. Pick up your responsibility's issue in [FIRST_ISSUES.md](FIRST_ISSUES.md);
   open it on GitHub and assign yourself.
2. Branch from `main`, build it with tests next to the code.
3. Before you push: `pnpm lint && pnpm typecheck && pnpm test`. CI also builds
   the bundle, the Docker image and runs a secret scan.
4. In the pull request:
   - fill in the template (which responsibility, what changed, how you tested);
   - add your line to [CONTRIBUTIONS.md](../CONTRIBUTIONS.md) — `pnpm ledger`
     drafts it once merged pull requests exist;
   - if you took the role, put your name in STEWARDS.md's table and in
     `jamot.company.yaml`.
5. The owner of the area reviews within 48 hours (the successor if they're
   away). Then it's merged and the ledger line stands.

Stuck for more than an hour? Ask in the stewards' Telegram group. Asking early
is part of the job.
