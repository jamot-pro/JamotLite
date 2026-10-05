---
name: new-screen
description: Build a new screen (or a big change to one) in the Jamot console end to end — the server view, its contract, the API route with its access check, the page made of components, tests, a check in the live preview, and a pull request with screenshots. Use when asked to add or rebuild a page of the console (e.g. "make the Agents page").
---

# A new screen in the console

Follow this order. Each step is small; don't skip the checks. The rules are in
`apps/web/DESIGN.md` and AGENTS.md rule 13 — read them first.

## 1. Decide what it shows, on the server

- Write down, in two or three sentences, what the screen is **for** and what the
  owner can **do** there. Add it to the Screens table in `apps/web/DESIGN.md`.
- Put the logic in the runtime, not the page: a function that builds the
  screen's **view** — exactly what it shows, already decided (labels, counts,
  states, which actions are allowed). Domain rules go in `packages/core`;
  shaping for the screen can live next to the route in `apps/runtime/src/api.ts`
  (or a new `apps/runtime/src/<area>.ts` registered from `api.ts`).
- Changes the screen makes are **actions**: one route each, returning
  `ActionResult` (`{ message }`) — the sentence the owner sees.

## 2. The contract

- Add the view and any action bodies to `packages/contracts/src/console.ts`
  (`<Name>View`, `<Name>Input`). Comment what's not obvious.
- Type the route handlers with them: `async (req): Promise<NameView> => …`.

## 3. The route

- Under the owner guard in `registerApi` (`owner.get/post/put/delete`), so it
  needs the console session. Never trust an id from the client without loading
  it and checking it exists; refuse what an owner can't do with a 400 and a
  plain sentence.
- Anything that changes the company map or settings appends an **event** (who,
  what), so the change shows in history.
- Secrets never go out in a view (AGENTS.md rule 5).

## 4. Tests

- `apps/runtime/src/api.test.ts` (or a new `<area>.test.ts` beside it): the
  view's shape for the seeded restaurant, each action, a refusal for bad input,
  and **401 when signed out**.
- Domain logic gets its own test in `packages/core`.

## 5. The page

- `apps/web/src/pages/<Name>.tsx`, made **only** of components from
  `apps/web/src/ui` (see the list in `DESIGN.md`); data types from
  `@jamot/contracts`. Add it to `PAGES` in `App.tsx`.
- Missing a component? Add it to `src/ui/index.tsx` + `components.css`, and an
  example in every state to `src/dev/Gallery.tsx`.
- Empty, loading and error states are part of the screen: write them.
- Words: `DESIGN.md` → Voice.

## 6. Check it in the preview

1. `preview_start` the `company` and `console` configurations
   (`.claude/launch.json`). Sign in with the password in
   `scripts/dev-company.ts`. If the seed lacks what the screen needs, add it to
   the seed and restart with `pnpm dev:company --fresh`.
2. Screenshot the screen: desktop, phone (`resize_window` mobile), dark.
3. Try every action; read the console for errors.
4. `pnpm ui-check && pnpm typecheck && pnpm lint && pnpm test`.

## 7. Pull request

- Decision line in `docs/RUNTIME.md` if the screen settles something new.
- The PR body: what the screen is for, the actions, the checks run, and the
  screenshots (desktop, phone, dark). Run the `ui-review` skill first.
- Ledger line in `CONTRIBUTIONS.md` once the PR number is known.
