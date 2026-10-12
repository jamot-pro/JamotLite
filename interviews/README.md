# Interviews

How Jamot learns what it needs from a person: by talking with them
(RUNTIME §8d, D61). One engine, several interviews:

| File | Who | What it's for |
|---|---|---|
| `charter.yaml` | The founder, at setup | Their business, new or running, becomes the company's charter and first plan |
| `newcomer.yaml` | Someone who just joined | What they're good at, want, have time for; how to work with them |

## Changing an interview — no code

Edit the YAML:

- `goal` — what the conversation is for. The model reads it every turn.
- `opening` — Jamot's first message. `{name}` and `{company}` are filled in.
- `fields` — the facts to gather: `id`, `label`, `required`, `hint`,
  `kind: lines` for one item per line. Add a field and it's gathered; for the
  charter, every fact also reaches the drafter.
- `skills` — the `SKILL.md` files to follow, from `skills/<name>/`.
- `maxTurns` — how many model turns at most; after that, plain questions.

Edit or add a skill in `skills/<name>/SKILL.md` (front matter `name` and
`description`, then the rules in plain words).

## Overriding them

The first folder that has the file wins:

1. For a company's interviews (the newcomer): `interviews/` in the company's
   own folder.
2. For a deploy: the folder in `JAMOT_INTERVIEWS`.
3. These built-in ones.

A definition that doesn't hold together (a missing skill, a field twice) is
refused when it's loaded, and the setup falls back to its questions.
