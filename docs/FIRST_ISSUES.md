# First issues — one per responsibility

Each new steward starts with the first issue of the responsibility they own
([STEWARDS.md](../STEWARDS.md)). Each is sized to ship a first pull request in
a week; the whole issue may take longer. "Done when" is the acceptance test.
They all stay inside v0.1 scope ([RUNTIME.md](RUNTIME.md) §11).

When you take one, open it as a GitHub issue (copy the section), assign
yourself, and link it from your pull request.

---

## 1. Runtime and brain — agent skills

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

## 2. Telegram and channels — a live bot, end to end

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

## 3. Survival and heartbeats — a successor for every responsibility

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

## 4. Console and onboarding — the charter, everywhere

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

## 5. Templates and first companies — the Bali café, live

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

## 6. Hub and network — a public company page (in J-Nesys)

**Goal.** The thing people share: a public page per company with its
readiness and the **JAMOT** badge. The hub lives in the J-Nesys repository;
Lite's "Out" table keeps the marketplace out of Lite.

- **Done when:** J-Nesys ROADMAP WP-1.9 is done: every Marketplace company has
  a public page (vision and mission, readiness dimensions, number of Stewards
  and Backers, join button) and an embeddable SVG badge; no private data on
  either.
- **Start in:** J-Nesys `packages/api/src/routes/discover.ts`, `apps/console`.
- **Size:** M.

## 7. Quality and releases — v0.1, for real

**Goal.** Anyone can install Jamot Lite with one command.

- **Done when:**
  - pull request #1 is merged and `v0.1.0` is tagged;
  - the release has the `jamot-lite.tgz` and the image on ghcr;
  - the installer and the Docker image are tested on a fresh Linux machine and
    a fresh Mac, with the transcripts in the pull request;
  - the installer works while the repository is private, or the README says
    how to install until it's public;
  - `jamot import` names the company's folder after the file's company id
    (today an imported `jamot.company.yaml` lands in `company/`).
- **Start in:** `.github/workflows/release.yml`, `scripts/install.sh`,
  `apps/runtime/src/cli/commands.ts`.
- **Size:** S–M.

## 8. Stewardship and the ledger — Jamot runs on Jamot

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
