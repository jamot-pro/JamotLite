# The console's design

How the web console is built, so its look can change without rewriting it.
Read this before touching anything in `apps/web` (AGENTS.md rule 13, RUNTIME
D46).

## Three layers

| Layer | Where | What changes it |
|---|---|---|
| **Tokens** | `src/ui/tokens.css` | Colours, radius, fonts, widths — light and dark. A new look starts here. |
| **Components** | `src/ui/index.tsx` + `src/ui/components.css` | How a card, a tile, a list or a button looks and behaves. The only place with class names. |
| **Screens** | `src/pages/*.tsx` | What a screen shows and in which order, made only of components. |

Data comes from **`@jamot/contracts`** (`packages/contracts/src/console.ts`):
the runtime's routes are typed with it and screens import it, so a shape that
changes on the server fails the build here. **What a screen shows is decided on
the server** — counts, labels, what needs the owner, which actions are allowed.
A screen lays it out; it doesn't work it out. (Older screens still compute a
little; move it to the server when you touch them.)

## Rules (`pnpm ui-check`)

A file in `src/pages` (and `src/dev`):

- has **no `className`**, **no `style={…}`**, imports **no `.css`**;
- uses **no raw layout tags** (`div`, `section`, `ul`, `li`, `table`, `button`,
  `input`, `form`…) — the components cover them. Plain text tags are fine:
  `p`, `span`, `strong`, `em`, `code`, `br`, `h1` inside a form card;
- declares **no interface or object type** for API data — import it from
  `@jamot/contracts`.

Need something the components don't have? Add a component (to `index.tsx`,
its style to `components.css`, and an example to `/dev/ui`), then use it.

## The components

Shown in every state on **`/dev/ui`** (development only; `pnpm dev:web`).

- **Frame:** `Shell`, `Brand`, `NavLink`, `SignOut`, `Page` (title, subtitle,
  actions), `Banner`, `Center`
- **Content:** `Card` (`title`, `tone="warn"`, `muted`), `Label`, `Tiles` +
  `Tile` (`label`, `value`, `hint`, `tone`, `onClick`), `Grid`, `Split`
- **Lists:** `List` + `Item` (`selectable`, `selected`), `Bullets` + `Bullet`,
  `Table` + `Row` + `Cell` (`numeric`, `small`)
- **Text:** `Muted` (`small`, `block`), `Small`, `ErrorText`, `Notice`,
  `Badge` (`tone="ok" | "bad"`), `Pre`, `Secret`, `Loading`
- **Actions:** `Button` (`variant="primary" | "secondary" | "link"`,
  `size="small"`), `ButtonLink`, `PageLink`, `Actions`
- **Forms:** `Form` (`layout="stack" | "row"`, `card`), `Field` (`label`,
  `hint`), `Input` (`search`), `Select`, `TextArea`, `Checkbox` (`label`,
  `hint`, `checked`, `disabled`)
- **Conversations:** `Chat`, `Bubble` (`direction`, `meta`)

## Voice

Plain words, short sentences, the owner's point of view. Say what happened and
what to do next ("Nobody owns **Bar**" — *I'll take it*). No jargon, no
"successfully", no exclamation marks. Never "Dream" in anything a person
reads; it's the **charter** (AGENTS.md, Words).

## Checking a change

1. Start the preview: `pnpm dev:company` and `pnpm dev:web` (in Claude Code,
   the `company` and `console` launch configurations). Sign in with the
   development password in `scripts/dev-company.ts`.
2. Look at the screen at desktop width, at phone width (375 px) and in dark.
3. For a change to tokens or components, look at `/dev/ui` before and after.
4. No console errors; `pnpm ui-check`, `pnpm typecheck` and `pnpm lint` pass.
5. Put the screenshots in the pull request.

## Screens

| Screen | Path | For |
|---|---|---|
| Overview | `/` | How the company is doing and what needs the owner now |
| Company map | `/map` | Teams, who's in them, who owns what, heartbeats, tools |
| Stewards | `/stewards` | The people who run the company: handles, team, what they own, Telegram pairing, retire (D48); open roles, invitations and who's waiting for an answer (D52) |
| Agents | `/agents` | Each agent: what it does, where, with what, at what cost; edit, tools, add, retire (D47) |
| People | `/people` | Everyone the company talks to, and what it remembers |
| Approvals | `/approvals` | What agents wait for a person to decide |
| Agent runs | `/runs` | What the agents did, and what it cost |
| Settings | `/settings` | Model, Telegram, outside AIs, the company file |

The company dashboard shown inside Claude (`packages/mcp/src/dashboard.ts`,
D45) is a separate page for now; it moves onto these components later.
