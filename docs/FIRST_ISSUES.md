# First issues — one per responsibility

Issues 1–8 and 10 are one per responsibility; issue 9 is the stewards' own
onboarding.
Each new steward starts with the first issue of the responsibility they own
([STEWARDS.md](../STEWARDS.md)). Each is sized to ship a first pull request in
a week; the whole issue may take longer. "Done when" is the acceptance test.
They all stay inside v0.1 scope ([RUNTIME.md](RUNTIME.md) §11).

Each is also a GitHub issue (linked in its heading, labelled `first issue`
and its area): assign yourself there, and link it from your pull request.

---

## 1. Runtime and brain — agent skills · [GitHub #3](https://github.com/jamot-pro/JamotLite/issues/3)

**Goal.** A company's know-how survives people leaving: agents use skills in
the [agentskills.io](https://agentskills.io) format, and propose new ones from
experience, which a human approves (decision D12, RUNTIME.md §8b).

- **Done when:**
  - a skill folder (`SKILL.md` + files) in the company's data folder is loaded,
    and an agent uses it when relevant;
  - an agent can propose a new skill after a run; it waits as an approval and
    is saved only when the owner approves it;
  - the console lists the company's skills;
  - tests next to the code; pi stays inside `packages/brain` (AGENTS.md rule 9).
- **Start in:** `packages/brain`, `packages/core/src/agents/`.
- **Size:** L. First pull request: loading and using existing skills.

## 2. Telegram and channels — a live bot, end to end · [GitHub #4](https://github.com/jamot-pro/JamotLite/issues/4)

**Goal.** Everything Telegram does today is tested offline; prove it with a
real bot and a real model, and accept voice notes (plumbers and farmers send
voice).

- **Done when:**
  - a written test script (`docs/recipes/live-telegram-check.md`) walks through
    owner pairing, a customer message, an approval and a heartbeat notice with
    a real bot — run once, with the results in the pull request;
  - voice notes are transcribed and handled like text, through a provider the
    owner configures, with cost recorded on the run;
  - bugs found on the way are fixed or filed.
- **Start in:** `packages/telegram`, `packages/core/src/channels/`.
- **Size:** M.

## 3. Survival and heartbeats — a successor for every responsibility · [GitHub #5](https://github.com/jamot-pro/JamotLite/issues/5)

**Goal.** "Every responsibility has an owner and a successor" is a value of
Jamot; make it a rule the runtime checks, for every company.

- **Done when:**
  - a responsibility can name a successor (a human node) in the company map
    and in `company.yaml` (adding a field keeps file format 1);
  - readiness and the vital signs flag responsibilities with no successor;
  - when an owner goes quiet past the threshold, that responsibility's issues
    go to its successor;
  - `jamot.company.yaml` uses it.
- **Start in:** `packages/core/src/survival/`, `packages/core/src/readiness/`,
  `packages/contracts`.
- **Size:** M.

## 4. Console and onboarding — the charter, everywhere · [GitHub #6](https://github.com/jamot-pro/JamotLite/issues/6)

**Goal.** Jamot's words are Company and its **charter**: Vision, Mission,
Values, Goals. Lite still says "Dream" (J-Nesys has already moved; see its
`docs/SPEC.md` glossary).

- **Done when:**
  - `jamot setup` asks for the vision, mission, values and goals (with the
    template's as defaults);
  - the Overview shows the charter; the API returns `vision`;
  - "Dream" is gone from everything a user reads: console, CLI, templates,
    README, agent instructions. The code name `dream` may stay, as it did in
    J-Nesys;
  - the seven templates get a vision; **Believers** become **Stewards /
    Backers / Taskers** where they appear.
- **Start in:** `apps/runtime/src/cli/`, `apps/web/src/pages/Overview.tsx`,
  `templates/`, `packages/core/src/agents/spec.ts`.
- **Size:** M. Good first issue.

## 5. Templates and first companies — the Bali café, live · [GitHub #7](https://github.com/jamot-pro/JamotLite/issues/7)

**Goal.** The first real company on Jamot Lite.

- **Done when:**
  - the café's founders run `jamot setup` from the `bali-cafe` template on a
    machine they control (or a VPS you set up with them);
  - the owner and the successor are paired on Telegram;
  - a week of real heartbeats and conversations has run, and what went wrong
    is filed as issues;
  - a `help` line in the ledger for each person who helped.
- **Start in:** `templates/bali-cafe.yaml`, the README's "Start a company".
- **Size:** M, mostly not code.

## 6. Hub and network — a public company page (in J-Nesys) · [GitHub #8](https://github.com/jamot-pro/JamotLite/issues/8)

**Goal.** The thing people share: a public page per company with its
readiness and the **JAMOT** badge. The hub lives in the J-Nesys repository;
Lite's "Out" table keeps the marketplace out of Lite.

- **Done when:** J-Nesys ROADMAP WP-1.9 is done: every Marketplace company has
  a public page (vision and mission, readiness dimensions, number of Stewards
  and Backers, join button) and an embeddable SVG badge; no private data on
  either.
- **Start in:** J-Nesys `packages/api/src/routes/discover.ts`, `apps/console`.
- **Size:** M.

## 7. Quality and releases — v0.1, for real · [GitHub #9](https://github.com/jamot-pro/JamotLite/issues/9)

**Goal.** Anyone can install Jamot Lite with one command.

- **Done when:**
  - pull request #1 is merged and `v0.1.0` is tagged;
  - the release has the `jamot-lite.tgz` and the image on ghcr;
  - the installer and the Docker image are tested on a fresh Linux machine and
    a fresh Mac, with the transcripts in the pull request;
  - the installer works while the repository is private, or the README says
    how to install until it's public;
  - ~~`jamot import` names the company's folder after the file's company id~~
    — done in S3 ([#14](https://github.com/jamot-pro/JamotLite/issues/14)).
- **Start in:** `.github/workflows/release.yml`, `scripts/install.sh`,
  `apps/runtime/src/cli/commands.ts`.
- **Size:** S–M.

## 8. Stewardship and the ledger — Jamot runs on Jamot · [GitHub #10](https://github.com/jamot-pro/JamotLite/issues/10)

**Goal.** Jamot's own runtime runs `jamot.company.yaml` with the stewards'
Telegram group, and keeps the ledger honest.

- **Done when:**
  - Jamot's runtime is running (VPS or Hosted), its owner and successor paired;
  - every steward is in the group and in the company map;
  - Jamot Keeper's heartbeats post: Monday's one thing, waiting reviews, quiet
    responsibilities, the Friday update;
  - `pnpm ledger` is part of the Friday heartbeat, and the first weekly update
    is posted.
- **Start in:** `jamot.company.yaml`, `scripts/ledger.mjs`, STEWARDS.md.
- **Size:** M. Owner today: the founder.

## 9. Console and onboarding — onboarding new stewards, with Human Design and Gene Keys · [GitHub #11](https://github.com/jamot-pro/JamotLite/issues/11)

**Goal.** Everyone who joins Jamot goes through the same onboarding, run by
Jamot Keeper on Telegram ([START_HERE.md](START_HERE.md) §1), and the agents
know who they're working with from day one — including each person's Human
Design and Gene Keys, calculated from their birth details (decision D31).

- **Done when:**
  - a new person paired on Telegram is walked through the onboarding
    questions one at a time — you, your work, your role, your design — and
    every answer lands in their person profile;
  - the birth date, time and place are optional: the person can skip them or
    add them later, and is told why they're asked before they answer;
  - Human Design and Gene Keys are calculated from them with
    [`natalengine`](https://www.npmjs.com/package/natalengine) (MIT), carrying
    over J-Nesys `packages/archetype-engine` (the Gene Keys archetypes, the
    centre themes and the narrative), and stored in the person's profile;
  - the birth details and the readings are visible to that person and the
    agents working with them, never in a public page, an export of the
    company map or the ledger; the person can change or delete them;
  - agents get the reading as context when they talk with that person, and
    never use it for roles, reviews or allocations;
  - a person can add other tests' results themselves (Enneagram, Big Five…)
    through `remember`, and they show in their profile;
  - tests next to the code; the founder's manual onboarding call is retired.
- **Start in:** `packages/core/src/agents/`, `packages/telegram`, the person
  profile in `packages/ports` / `packages/sqlite`; J-Nesys
  `packages/archetype-engine` and `apps/console/src/app/p/[token]/OnboardForm.tsx`.
- **Size:** M–L. First pull request: the questions and the profile fields;
  the calculation next.

## 10. Fleet and isolation — two companies, one machine, fully independent · [GitHub #12](https://github.com/jamot-pro/JamotLite/issues/12)

**Goal.** One operator runs many companies on their own infrastructure, and no
company can cause a problem for another: separate processes, data, secrets,
bots and budgets (decision D1: "isolation by process"; D35). Prove it with two
companies before building any fleet tooling.

- **Done when:**
  - a recipe, `docs/recipes/many-companies-one-machine.md`, runs two companies
    side by side — each with its own `JAMOT_HOME`, port, Telegram bot, model
    key and spending cap — as two services (systemd or launchd), and as two
    containers with memory and CPU limits;
  - an isolation check (`scripts/isolation-check.mjs`, run in CI) starts two
    runtimes with `--no-telegram`, kills one, and shows the other still
    answers `/health` and runs its heartbeats;
  - a second runtime refuses to start on a `JAMOT_HOME` that is already in
    use, with a sentence saying which process holds it;
  - one company reaching its spending cap, or its disk filling, is shown not
    to affect the other — results in the pull request;
  - the next step, a fleet control plane (provisioning, upgrades one company
    at a time, backups, watchdog), is designed in RUNTIME.md §9 from what this
    check taught us — designed, not built.
- **Start in:** `apps/runtime/src/runtime.ts`, `apps/runtime/src/cli/`,
  `Dockerfile`, RUNTIME.md §9 ("Out — many companies, one operator").
- **Size:** M.
