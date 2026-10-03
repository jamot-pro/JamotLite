# Contributing to Jamot

Jamot is built by its stewards, as a Jamot company. While the repository is
private, contributing is by invitation.

**New here?** Start with [docs/START_HERE.md](docs/START_HERE.md): your
onboarding, the code running locally, and your first pull request.
[STEWARDS.md](STEWARDS.md) is how we work; [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
is the map of the code; [AGENTS.md](AGENTS.md) holds the rules your AI follows too.

## The short version

1. **Take an issue.** Your responsibility's first issue, or anything labelled
   with your area. Assign yourself so nobody doubles up.
2. **Branch** from `main`: `<area>/<short-name>` (e.g. `survival/successors`).
3. **Build it with tests next to the code.** Run `pnpm lint && pnpm typecheck
   && pnpm test` before you push.
4. **Open a pull request** with the template filled in, and **add your line to
   [CONTRIBUTIONS.md](CONTRIBUTIONS.md)** in the same pull request.
5. **Review:** the area's owner (see [.github/CODEOWNERS](.github/CODEOWNERS))
   is asked automatically and reviews within 48 hours; the successor if the
   owner is away.
6. **Merge:** squash-merge once CI is green and the owner approved. One pull
   request, one commit, one ledger line.

## Rules that are easy to miss

- Stay inside v0.1 scope ([docs/RUNTIME.md](docs/RUNTIME.md) §11). Ideas
  outside it go to the "Out" table, not into code.
- A change that settles a question adds a line to the decision log in the
  same pull request.
- Never edit an existing migration or an existing ledger line; add a new one.
- Personal data (birth details, readings, test results) never goes into the
  repository, logs or tests — use made-up values (AGENTS.md rule 12).
- Bring any AI you like; its work is your work, the credit and the
  responsibility.

## Private, for now

This repository, [PURPOSE.md](PURPOSE.md) and the ledger are internal. Don't
share them or post about Jamot's ownership until we go public together.
