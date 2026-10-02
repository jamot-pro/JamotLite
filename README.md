# Jamot Lite

**The organization that doesn't die when people leave.**

Jamot Lite is a company runtime: one program, one folder, one company. Describe
your company in a file, and Jamot runs it with humans and AI agents side by
side — it remembers every customer, puts a heartbeat on every responsibility,
notices the moment something is missing, and is an MCP server your own AI can
plug into.

> **Status: v0.1, pre-release.** Everything below works and is tested
> (end to end, offline); it hasn't met real customers yet. Design and every
> decision: [docs/RUNTIME.md](docs/RUNTIME.md).

## Start a company

You need Node.js 22.19+ and a Telegram bot token from
[@BotFather](https://t.me/BotFather).

```bash
curl -fsSL https://jamot.pro/install.sh | sh     # once the first release is out
jamot setup                                      # pick a company, a model, the bot
jamot start
```

Or with Docker:

```bash
docker run -it --rm -v jamot:/data ghcr.io/jamot-pro/jamot-lite setup
docker run -d --name jamot -p 127.0.0.1:3000:3000 -v jamot:/data --restart unless-stopped ghcr.io/jamot-pro/jamot-lite
```

Then send your bot the `/start <code>` that setup printed — that makes you the
owner — and open the console at <http://127.0.0.1:3000>.

## What it does

- **Seven companies to fork** — café, restaurant, Montessori school,
  electrician, plumber, organic farm, online shop — each a readable
  [`company.yaml`](templates/restaurant.yaml).
- **Customers write on Telegram; an agent answers**, within the company's rules,
  and every message in and out becomes the company's memory.
- **Humans decide.** Payments, refunds, anything irreversible waits for the
  owner: one tap on Telegram, or in the console.
- **Heartbeats keep watch** in the company's time zone. When a responsibility
  has no owner, a team is empty, a customer waits too long or money runs low,
  the owner hears about it once, with a one-tap fix — and hears when it's fixed.
- **It survives people.** Name a successor: if the owner goes silent, the
  company turns to them.
- **Every agent run shows its tokens and cost.** Budgets tighten when money
  gets tight.
- **Your AI can connect** — the company is an MCP server
  ([recipe](docs/recipes/connect-your-ai.md)); agents can use MCP tools too.
- **One folder, yours.** `company.db` + `secrets.key`; `jamot backup`,
  `jamot export`, move it anywhere.

## Commands

```text
jamot setup | start | status | doctor | ask "<question>" | pair [successor]
jamot mcp | backup | export --to <dir> | import <dir> | secret set <name>
jamot password | templates | service install
```

## Not zero-human. Best-human.

Agents are becoming a commodity. The people who run them well are scarce.
Jamot is built for them: operators who set up and keep companies alive, and
build a track record doing it.

## Build it with us

Jamot is built the way it wants every company to work: as a Jamot company, by
stewards who each own a responsibility. Start with [STEWARDS.md](STEWARDS.md),
then [docs/START_HERE.md](docs/START_HERE.md) from clone to first pull request.
[AGENTS.md](AGENTS.md) is the map and the rules — your AI reads it too.

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm jamot --help        # run the CLI from source
pnpm build               # dist/: the bundled jamot.mjs, templates, console
```

## Licence

[AGPL-3.0](LICENSE). Free to use, run, modify and share. If you run a modified
Jamot as a service, share your changes.

*Write your Dream. The rest is Just A Matter Of Time.*
