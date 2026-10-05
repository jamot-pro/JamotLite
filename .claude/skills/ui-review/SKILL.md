---
name: ui-review
description: Review a change to the Jamot console before its pull request — the UI rules, accessibility, React correctness, states, words, and screenshots at desktop, phone and dark. Use after building or restyling a screen, before opening the PR.
---

# Review a console change

1. **Rules:** `pnpm ui-check`. Then read the diff of `apps/web/src/pages` for
   logic that belongs on the server (deciding what to show, filtering,
   counting) — move it.
2. **Contracts:** every shape a page reads comes from `@jamot/contracts`, and
   the route returning it is typed with the same type.
3. **Reviewers, in parallel:** the ECC `react-reviewer` (hooks, effects,
   keys, re-renders) and `a11y-architect` (labels, focus, contrast, keyboard)
   on the changed files under `apps/web/src`. If the change adds or changes a
   route, the ECC `security-reviewer` on it too (owner guard, input checks,
   nothing secret in the view).
4. **States:** loading, empty, error, long text, many items — each one seen in
   the preview or on `/dev/ui`.
5. **Words:** `apps/web/DESIGN.md` → Voice. No "Dream", no jargon.
6. **Screenshots:** desktop, phone (375 px), dark, for every changed screen;
   `/dev/ui` before and after for a restyle. They go in the PR.
7. Fix what's found, then run the checks again:
   `pnpm ui-check && pnpm typecheck && pnpm lint && pnpm test`.
