# Join Jamot as a contributor

Welcome. Jamot is a company built to outlive any one of the people who carry
it, and it is run that way itself: on its own runtime, with every
responsibility owned by a steward and every contribution recorded. Joining
means becoming one of the people who keep it alive.

This page takes you from "I'm in" to your first merged pull request. It has
four steps:

1. [Your onboarding](#1-your-onboarding) — Jamot gets to know you
2. [Get the code running](#2-get-the-code-running) — about 30 minutes
3. [Find your way around](#3-find-your-way-around)
4. [Your first pull request](#4-your-first-pull-request) — within your first week

Before you start, read [STEWARDS.md](../STEWARDS.md) (how we work, the roles,
the responsibilities) and [PURPOSE.md](../PURPOSE.md) (why Jamot exists and
who owns it). Both are private: please keep them that way.

## 1. Your onboarding

Everyone who joins goes through the same onboarding, run by **Jamot Keeper**,
the agent in Jamot's own company map ([`jamot.company.yaml`](../jamot.company.yaml)).
It talks with you on Telegram, one question at a time, and keeps what you tell
it in your profile — so from your first day, the agents you work with know who
you are, and so does whoever works with you next.

> **Status: 🔨 next.** The automated onboarding is being built
> ([FIRST_ISSUES.md](FIRST_ISSUES.md) #9). Until it's live, the founder walks
> you through the same questions on a short call, and your answers go into
> your profile the same way.

**What Jamot Keeper will ask you:**

| | |
|---|---|
| **You** | Your name, how you like to be called, your Telegram and GitHub handles, your city and time zone |
| **Your work** | What you're good at, what you want to learn, how many hours a week you can give |
| **Your role** | The responsibility you'd like to own, and one you'd be the successor for ([STEWARDS.md](../STEWARDS.md#the-responsibilities)) |
| **Your design** | Your date of birth, your exact time of birth, and your place of birth |

### Why we ask for your birth details

From your date, time and place of birth, Jamot calculates your **Human
Design** chart and your **Gene Keys** profile. We use them so the agents know
who is who energetically: how you tend to decide, where your energy is
strongest, how you work best with others. That shapes how Jamot Keeper talks
with you, which work it brings to you first, and how it pairs people on a
responsibility.

The more exact your time of birth, the more accurate the chart. If you don't
know it, give the closest time you have and say so.

Your choices, and our promises:

- **It's yours to give.** You can skip it, or add it later. Contributing to
  Jamot never depends on it.
- **It stays private.** It lives only in your own profile in Jamot's runtime —
  never in this repository, the ledger or any public page. You and the agents
  working with you can see it; other stewards see it only if you share it.
- **It never decides anything about you.** Roles, reviews and rewards follow
  your contributions in the ledger, and nothing else (value 4 in
  [STEWARDS.md](../STEWARDS.md#the-charter-in-one-screen)).
- **You can change or delete it at any time.** Ask Jamot Keeper, or the
  founder.

### More about you, if you want

Human Design and Gene Keys are where we start. If you've taken other
personality tests — Big Five, Enneagram, DISC, CliftonStrengths, MBTI, or any
other — or want to, take them on your own and add the results to your profile
whenever you like. Tell Jamot Keeper, for example *"remember my Enneagram is
5w4"*, and the agents will take it into account from then on. All of it
optional, all of it yours to change or remove.

## 2. Get the code running

You need **Node.js 22.19+** and Git. pnpm comes through corepack. You'll get
access to the private repository once your onboarding call is done.

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

**Jamot itself is a company too:** `pnpm jamot import jamot.company.yaml`
starts Jamot's own map — the responsibilities you're about to own.

## 3. Find your way around

Jamot Lite runs **one company in one process**: a `company.yaml` describes it
(its charter, teams, responsibilities, people, agents, heartbeats), and the
runtime keeps it alive. Agents answer people on Telegram within the company's
rules, every conversation becomes memory, heartbeats check every
responsibility on a schedule, and anything irreversible waits for a human. The
company is also an MCP server, so anyone's own AI can connect to it. Design
and every decision: [RUNTIME.md](RUNTIME.md).

[AGENTS.md](../AGENTS.md) is the map of the code and its rules. The ones
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
