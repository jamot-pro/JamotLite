---
name: restyle
description: Change how the Jamot console looks — colours, type, spacing, shapes, a whole new design — through design tokens and components only, never by editing pages. Use when asked to restyle, rebrand, redesign or "make it look like X".
---

# A new look for the console

The console's look lives in three files (see `apps/web/DESIGN.md`):
`src/ui/tokens.css`, `src/ui/components.css`, `src/ui/index.tsx`. Pages don't
change in a restyle; if one seems to need it, the component is missing
something — change the component.

## Steps

1. **Before.** Start the `console` preview (and `company` for real screens).
   Screenshot `/dev/ui` in light and dark, and the Overview, at desktop and
   phone width. These are the "before".
2. **Agree on the direction** when it's more than a tweak: describe it in a
   few lines, or mock it up first (a design artifact), and get a yes.
3. **Tokens first.** Colours (light and the two dark blocks — they must
   match), radius, fonts, widths in `tokens.css`. Many restyles end here.
4. **Then components.** Shapes, spacing and states in `components.css`; new
   structure in `index.tsx`. Keep every component's props the same, so no page
   changes. If a new component is needed, add it with an example on `/dev/ui`.
5. **After.** The same screenshots as step 1. Check contrast (text on
   surfaces, buttons, badges) in both themes, focus outlines, and phone width.
6. `pnpm ui-check && pnpm typecheck && pnpm lint`, then the `ui-review` skill.
7. The PR shows before and after side by side.

## Don't

- Don't add class names or styles to pages to "fix" one screen.
- Don't load fonts, scripts or images from other sites; the console must work
  offline on a company's own machine.
- Don't change words while restyling; that's a separate change.
