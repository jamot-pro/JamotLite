# Stewards — how Jamot works

You're joining Jamot as one of its first stewards. Jamot builds a runtime for
companies that don't die when people leave — and Jamot itself is run that way,
on its own runtime. Everything here is the same model any company on Jamot
uses, applied to us.

Three files explain all of it:

| File | What it tells you |
|---|---|
| [PURPOSE.md](PURPOSE.md) | Why Jamot exists, who owns it, how contribution becomes ownership |
| [jamot.company.yaml](jamot.company.yaml) | Jamot's charter and company map, in the format every Jamot company uses |
| **This file** | How we work day to day, and your first step |

Then [docs/START_HERE.md](docs/START_HERE.md) takes you through your
onboarding and gets the code running, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
is the two-minute map of the code, and [CONTRIBUTING.md](CONTRIBUTING.md) is
the git workflow on one screen. The founder runs onboarding calls with
[docs/ONBOARDING_CALL.md](docs/ONBOARDING_CALL.md) until Jamot Keeper does.

> **Private.** This repository, PURPOSE.md and the ledger are internal. Don't
> share them or post about Jamot's ownership until the legal review is done and
> we go public together.

## Launch — when developers can join and build

Jamot launches when a developer can join and build the product, not on a date
or a customer count (decision D33). The gate:

- [x] Every responsibility has an owner role and a first issue ([FIRST_ISSUES.md](docs/FIRST_ISSUES.md))
- [x] Onboarding, the code map and the workflow are written (START_HERE, ARCHITECTURE, CONTRIBUTING)
- [x] `main` holds v0.1 and these docs, and `v0.1.0` is tagged (pull requests #1 and #2, first issue 7)
- [ ] The first steward goes from invite to green tests in under an hour, following START_HERE alone
  (dry run 2026-10-05: a fresh clone was green in under a minute with a warm
  package cache; the company started and answered `/health` — waiting on a
  steward to do it for real)
- [ ] The first steward's first pull request is reviewed, merged and in the ledger
- [ ] Jamot runs on its own runtime, with the stewards' Telegram group (first issue 8)
  (the runtime is live on Render since 2026-10-03; the group is being built)

When the first three stewards have each merged a pull request, we've launched.

## The charter, in one screen

**Vision** — a world where any group of people can start a company that
outlives any one of them.

**Mission** — build the open-source runtime that keeps small companies alive:
run by humans and agents together, owned by the people who build it.

**Values** — the rules we never break:

1. Humans stay accountable: an agent proposes, a person decides. Agents never approve.
2. Every responsibility has an owner and a successor, so nothing depends on one person.
3. A company's data is its own: export it any time, self-host it any time.
4. Rewards follow verified contributions in the ledger, never closeness to the founder.
5. Say what's real: NOW, NEXT or FUTURE. Never sell a FUTURE feature as working.
6. Nothing about ownership is promised outside PURPOSE.md.

Several of these run in code already: approvals in the brain, the export
command, the secret scan in CI. Values that run are the point of Jamot.

**Goals — the next 12 weeks:**

| By | Goal |
|---|---|
| Week 2 | The first 4–10 stewards join, each owning one responsibility |
| Week 3 | Jamot Lite v0.1 released: installer and Docker image |
| Week 4 | Jamot runs on its own runtime, with weekly updates from its agent |
| Week 8 | The Bali café runs on Jamot Lite |
| Week 12 | Three real companies on Jamot Lite; the first quarterly allocation proposed |

## The roles

| Role | Who | In Jamot today |
|---|---|---|
| **Steward** | Owns a responsibility and is the successor on another; votes | You, after owning a responsibility for 3 months ([PURPOSE.md](PURPOSE.md) §4) — until then you own it as a contributor, with the same say in your area |
| **Backer** | Funds Jamot; capped returns, no vote | None yet |
| **Tasker** | Picks up tasks the agents hand out, and gets credit | Anyone, any time |

## The responsibilities

Each one has an **owner** (decides in that area, keeps it moving) and a
**successor** (knows enough to take over if the owner goes quiet or leaves).
You own one and are the successor on another. Until a responsibility has an
owner, the founder holds it.

| Responsibility | Team | First step | Owner | Successor |
|---|---|---|---|---|
| Runtime and brain | Core | Agent skills in the agentskills.io format, written from experience and approved by a human | *open* | *open* |
| Telegram and channels | Core | A live bot tested end to end with a real company; voice notes transcribed | *open* | *open* |
| Survival and heartbeats | Core | A successor for every responsibility, and succession tested in a real company | *open* | *open* |
| Fleet and isolation | Core | Two companies on one machine, fully independent: one crashing, filling its disk or spending its budget never touches the other | *open* | *open* |
| Console and onboarding | Companies | The setup wizard asks for the Vision, Mission, Values and Goals; the console shows them | *open* | *open* |
| Templates and first companies | Companies | The Bali café running on Jamot Lite, its founders paired on Telegram | *open* | *open* |
| Hub and network | Stewardship | A public company page with the JAMOT badge, served by the hub (J-Nesys) | *open* | *open* |
| Quality and releases | Stewardship | v0.1 tagged; installer and Docker image tested on a fresh machine | *open* | *open* |
| Stewardship and the ledger | Stewardship | Every merged pull request in the ledger; the first weekly update | founder | *open* |

The concrete first issue for each is in [docs/FIRST_ISSUES.md](docs/FIRST_ISSUES.md).
When you take a role, update this table and `jamot.company.yaml` in your first
pull request.

## Your first step — within 7 days

1. Read PURPOSE.md, this file, and skim `jamot.company.yaml`.
2. Go through your onboarding ([docs/START_HERE.md](docs/START_HERE.md) §1):
   who you are, what you're good at, and — if you choose — your birth date,
   time and place, from which Jamot calculates your Human Design and Gene Keys
   so its agents know who they're working with. In it you pick a
   responsibility to own, and a second one to be the successor for.
3. Get Jamot Lite running locally ([docs/START_HERE.md](docs/START_HERE.md) §2).
4. Join the stewards' Telegram group, and pair with Jamot's own runtime when it
   goes live (week 4).
5. Ship your role's first issue, or the first piece of it, as a pull request,
   with your ledger line.

## The weekly rhythm

Jamot Keeper, the agent in `jamot.company.yaml`, runs these heartbeats once
Jamot runs on its own runtime. Until then the founder does.

| When | Heartbeat | What you do |
|---|---|---|
| Monday | One thing each | Say in the group what your one thing is this week |
| Every day | Reviews | Pull requests get a review within 48 hours; the area's owner reviews, the successor if the owner is away |
| Thursday | Quiet responsibilities | Anything with no activity for 14 days goes to its successor, then to all stewards |
| Friday | Ledger and update | The week's merged work is in the ledger; a steward checks the weekly update before it's posted |

## How decisions are made

- **In your area, you decide.** That's what owning a responsibility means.
  Ask your successor when it's big.
- **Across areas,** open a pull request that adds the decision to the log in
  [docs/RUNTIME.md](docs/RUNTIME.md) §12. Silence for 3 working days means yes.
- **If stewards disagree,** they vote: one steward, one vote, the founder
  included.
- **Scope:** v0.1 scope is in RUNTIME.md §11. Ideas outside it go to the "Out"
  table, not into code.

## The ledger

[CONTRIBUTIONS.md](CONTRIBUTIONS.md) records what each person delivered. It
is how the 45% contributor pool will be allocated (PURPOSE.md §5–§6).

- **Every merged pull request adds a line**, in the same pull request: date,
  you, the responsibility, the kind (`build`, `keep`, `help`), what was
  delivered, and the evidence (the pull request). The reviewer checks it.
- **Keeping things alive counts.** Owning a responsibility whose heartbeats
  stayed green for a month earns a `keep` line.
- **Lines are never edited.** A mistake gets a new line that corrects it.
- `pnpm ledger` lists merged pull requests that don't have a line yet.

## Working with agents

Bring your own: Claude Code, Cursor, Codex, Hermes, anything. They read
[AGENTS.md](AGENTS.md) first. Your agent's work is your work — the credit and
the responsibility for it.

## Leaving

You can step back any time. Tell your successor, hand over what's in flight,
and update the table above. You keep every line you earned; your vote returns
when you stop contributing (PURPOSE.md §4), and you can come back.
