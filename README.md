<div align="center">

# Jamot

### The company that doesn't die when people leave.

Write your company's **charter** — its vision, mission, values and goals.
Jamot runs it with humans and AI agents side by side, remembers everyone it
touches, notices what's missing, and keeps going.

This repository is **Jamot Lite**: one company, one runtime, on your own machine.

[Why Jamot](#why-jamot) · [How it works](#how-it-works) · [Start a company](#start-a-company) · [Build Jamot with us](#build-jamot-with-us)

</div>

---

## Why Jamot

Companies die when people leave.

The founder burns out. The one person who knew how everything worked moves on.
The customers who were remembered stop being remembered. The purpose fades, and
the tools stay behind like furniture in an empty office.

We think a company's purpose should outlive any one of the people who carry it.

Most companies write their purpose down once — a vision, a mission, some values
— and hang it on a wall. **In Jamot, the charter runs.** The mission becomes
responsibilities, every responsibility gets an owner, and the company names a
successor for when its owner goes quiet. The values become rules no agent may
break. The goals are what the heartbeats measure. When someone goes quiet or
leaves, Jamot notices, and the work moves to whoever is next, carrying
everything the company knows.

## Not zero-human. Best-human.

Agents are becoming a commodity. People who can run them well, and people who
care about a company enough to keep it alive, are not.

Jamot is built around people:

- **Stewards** are responsible for the company. Each owns a responsibility and
  is the successor on another, and they decide.
- **Backers** fund it. Backing never buys a vote.
- **Taskers** pick up the work the agents hand out, and get credit for it.

Agents prepare, remember, follow up and do the work that wears people down.
**An agent proposes; a person decides.** Payments, contracts, hiring and
anything irreversible always wait for a human.

## How it works

```text
              CHARTER          vision · mission · values · goals
                 │
       ┌─────────┴──────────┐
     TEAMS           RESPONSIBILITIES     each with an owner
       │                    │
       └──── HUMANS + AGENTS              side by side, on Telegram
                    │
          TOOLS · HEARTBEATS              what they use · what keeps watch
                    │
                  MEMORY                  everyone the company has ever met
                    │
      ✦ JAMOT — Just A Matter Of Time ✦
```

A company is one readable file, [`company.yaml`](templates/bali-cafe.yaml).
Jamot Lite turns it into a running company:

- **It notices.** Every responsibility has a heartbeat: a check on a schedule
  that monitors, evaluates, acts and verifies. A responsibility nobody owns, a
  customer left waiting, an owner gone quiet, money running low — the right
  person hears about it once, with a one-tap fix, and hears when it's fixed.
- **It remembers.** Every conversation with every person becomes the company's
  memory. Whoever comes next starts with everything the company knows.
- **It survives people.** Name a successor: if the owner goes silent, the
  company turns to them.
- **It connects.** The company is an MCP server, so your own AI — Claude,
  Cursor, Hermes — can plug into it ([recipe](docs/recipes/connect-your-ai.md)).
- **It's yours.** One folder: export it, back it up, move it, self-host it.

When every responsibility has an owner and every owner has a heartbeat, the
company earns its **JAMOT** — *Just A Matter Of Time*. It means *ready to keep
going*, not *guaranteed to succeed*. That part is still up to the people.

## The story, chapter by chapter

**✅ In Jamot Lite today** · **🔨 Next** · **🌱 Where we're headed**

1. **A company that stays alive** ✅ — the charter, owners and successors,
   heartbeats, memory, approvals, Telegram, MCP, on your own machine.
2. **A company that senses the world** 🔨 — sensors over MCP feed the
   heartbeats: a thermometer, a soil probe, a door.
3. **Companies that find each other** 🔨 — a hub where companies say what they
   need and people find the ones worth joining.
4. **Companies that work together** 🌱 — one company posts a problem, others
   solve it; agents negotiate with agents; trust is earned by delivering.
5. **Companies with hands** 🌱 — robots join as embodied agents; a human
   approves, a sensor verifies.
6. **Companies that sustain themselves** 🌱 — they earn and pay for work,
   within limits a human signed, and reward the people who helped them grow.
7. **A network no one owns** 🌱 — independent Jamot networks connected by open
   protocols; your identity and reputation travel with you.

Every decision behind Jamot Lite, and exactly what's in and out of this
version, is in [docs/RUNTIME.md](docs/RUNTIME.md).

## Start a company

> **Status: v0.1, pre-release.** Everything below works and is tested end to
> end, offline. It hasn't met real customers yet.

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

**Seven companies to start from**, each a `company.yaml` you can read and
change: a community café in Bali, a restaurant, a Montessori school, an
electrician, a plumber, an organic farm, an online shop.

```text
jamot setup | start | status | doctor | ask "<question>" | pair [successor]
jamot mcp | backup | export --to <dir> | import <dir|yaml> | secret set <name>
jamot password | templates | service install
```

## Build Jamot with us

Jamot is built the way it wants every company to work: **as a Jamot company.**
Its own charter and responsibilities are in
[`jamot.company.yaml`](jamot.company.yaml), and it runs on Jamot Lite. Every
responsibility has a steward and a successor, and every contribution is
recorded.

1. **[STEWARDS.md](STEWARDS.md)** — the charter on one screen, the roles, how
   we work.
2. **[docs/START_HERE.md](docs/START_HERE.md)** — join as a contributor: your
   onboarding, the code running locally, your first pull request.
3. **[AGENTS.md](AGENTS.md)** — the map of the code and its rules. Your AI
   reads it too.

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm jamot --help        # the CLI, from source
```

## Licence

[MIT](LICENSE). Free to use, run, change, share and build on — commercially
too. Your company's data is yours, whatever you build.

<div align="center">

**Write your mission. The rest is Just A Matter Of Time.**

</div>
