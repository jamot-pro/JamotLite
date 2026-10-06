# Contribution ledger

**Private and internal while Jamot is private.** Visible to every steward,
never rewritten: lines are only added. A mistake is fixed by a new line that
says which line it corrects. Why this exists and how it becomes ownership:
[PURPOSE.md](PURPOSE.md) §5–§6. How to add your line: [STEWARDS.md](STEWARDS.md#the-ledger).

**What earns a line** (PURPOSE.md §5): an outcome, not activity — a merged pull
request, a responsibility kept healthy for a month, a skill approved, a company
helped onto Jamot, a problem solved for a steward. Your agent's work is your
work. Lines of code, messages and hours don't count.

**Kinds:** `build` (something new shipped) · `keep` (a responsibility kept
alive) · `help` (a company, a steward or a user helped) · `founding` (work
before this ledger existed).

The quarterly allocation is proposed from this file by Jamot Keeper and
approved by the stewards. Credits have no monetary value until the ownership
plan is approved by legal counsel.

| # | Date | Contributor | Responsibility | Kind | Delivered | Evidence | Recorded by |
|---|---|---|---|---|---|---|---|
| 1 | 2026-09-30 | @electrichains | Stewardship and the ledger | founding | The Jamot vision, the steward-ownership plan (PURPOSE.md) and the strategy behind Jamot Lite | PURPOSE.md, docs/RUNTIME.md | @electrichains |
| 2 | 2026-09-30 | @electrichains | Hub and network | founding | J-Nesys, the Jamot platform and hub: 208 commits from 2026-09-09 to 2026-09-30, all the founder's (authored as electrichains and v@rriale.com, with Claude as co-author) — org graph, readiness, memory, channels, MCP surface, governance, treasury, console | jamot-pro/J-Nesys `main` | @electrichains |
| 3 | 2026-10-01 | @electrichains | Templates and first companies | founding | The seven company templates (Bali café, Montessori school, electrical, plumbing, restaurant, organic farm, online shop) | templates/ | @electrichains |
| 4 | 2026-10-01 | @electrichains | Runtime and brain | founding | Jamot Lite v0.1, milestones M0–M6: the runtime, pi brain, Telegram, heartbeats, survival, MCP, console, installer | [#1](https://github.com/jamot-pro/JamotLite/pull/1) | @electrichains |
| 5 | 2026-10-02 | @electrichains | Stewardship and the ledger | founding | Jamot as a Jamot company: jamot.company.yaml, STEWARDS.md, this ledger, the steward onboarding | [#2](https://github.com/jamot-pro/JamotLite/pull/2) | @electrichains |
| 6 | 2026-10-03 | @electrichains | Quality and releases | code | Jamot runs on Render: one-hop proxy trust, Secure cookie, first-boot setup in `jamot start`, render.yaml and the recipe | [#19](https://github.com/jamot-pro/JamotLite/pull/19) | @electrichains |
| 7 | 2026-10-03 | @electrichains | Telegram and channels | code | Telegram works from the bundle: keepNames, a CI smoke test that reaches Telegram, and a failed start that exits (D38) | [#23](https://github.com/jamot-pro/JamotLite/pull/23) | @electrichains |
| 8 | 2026-10-03 | @electrichains | Fleet and isolation | code | Backups on by default: a daily snapshot, the last 7 kept, `jamot restore` staged for the next start (S4, part 1) | [#22](https://github.com/jamot-pro/JamotLite/pull/22) | @electrichains |
| 9 | 2026-10-03 | @electrichains | Telegram and channels | code | The web chat: customers talk to the company at /chat, with limits, a daily cost cap and forget me (S5) | [#24](https://github.com/jamot-pro/JamotLite/pull/24) | @electrichains |
| 10 | 2026-10-03 | @electrichains | Quality and releases | code | One folder per company: `jamot import` and `setup` name it after the company id, `--as` renames, `--company` says which exist (S3) | [#25](https://github.com/jamot-pro/JamotLite/pull/25) | @electrichains |
| 11 | 2026-10-03 | @electrichains | Runtime and brain | code | Bring your own agent: MCP connections per agent or person, every call recorded, `propose` becomes an approval (S8) | [#26](https://github.com/jamot-pro/JamotLite/pull/26) | @electrichains |
| 12 | 2026-10-03 | @electrichains | Templates and first companies | code | `jamot demo`: one command, no keys, a company answering in the browser on a labelled demo model (S6) | [#27](https://github.com/jamot-pro/JamotLite/pull/27) | @electrichains |
| 13 | 2026-10-03 | @electrichains | Fleet and isolation | code | Two companies, one machine: one start per folder, the isolation check in CI, the recipe, and the fleet control plane designed (S7) | [#28](https://github.com/jamot-pro/JamotLite/pull/28) | @electrichains |
| 14 | 2026-10-03 | @electrichains | Stewardship and the ledger | docs | The README and AGENTS.md say what Jamot is next to Hermes, OpenClaw and Paperclip, and what's built today (S1) | [#29](https://github.com/jamot-pro/JamotLite/pull/29) | @electrichains |
| 15 | 2026-10-03 | @electrichains | Console and onboarding | code | The charter everywhere: setup asks for vision, mission, values and goals; the Overview, API, MCP and agents speak charter; every template has a vision; Believers became Stewards and Backers (S2) | [#30](https://github.com/jamot-pro/JamotLite/pull/30) | @electrichains |
| 16 | 2026-10-03 | @electrichains | Fleet and isolation | code | Continuous off-site copies: `jamot replicate` with Litestream, keys in the secret store, a verified binary in the image, restore from the replica (S4, part 2) | [#31](https://github.com/jamot-pro/JamotLite/pull/31) | @electrichains |
| 17 | 2026-10-05 | @electrichains | Runtime and brain | code | MCP sign-in with OAuth (CIMD, registration, consent page, rotating tokens) so claude.ai can connect, and the company dashboard shown inside Claude as an MCP App | [#34](https://github.com/jamot-pro/JamotLite/pull/34) | @electrichains |
| 18 | 2026-10-05 | @electrichains | Console and onboarding | code | The console as tokens, components and screens, with shared API contracts, `pnpm ui-check`, a seeded dev company, `/dev/ui`, and a Claude Code setup (preview, hook, skills) to build it | [#35](https://github.com/jamot-pro/JamotLite/pull/35) | @electrichains |
| 19 | 2026-10-05 | @electrichains | Console and onboarding | code | The Agents page: see, edit, equip, add and retire agents from the console, owner only, every change on the record | [#36](https://github.com/jamot-pro/JamotLite/pull/36) | @electrichains |
| 20 | 2026-10-05 | @electrichains | Stewardship and the ledger | docs | Ready for the first stewards: every first issue real (#37, #38 replace finished ones), START_HERE with the dev tools and a fresh-clone dry run, stale issues closed | [#39](https://github.com/jamot-pro/JamotLite/pull/39) | @electrichains |
| 21 | 2026-10-05 | @electrichains | Console and onboarding | code | Stewards in the console (add, own, retire, link their Telegram) and the stewards' Telegram group, with heartbeat issues scoped so money and customers stay with the owner | [#40](https://github.com/jamot-pro/JamotLite/pull/40) | @electrichains |
| 24 | 2026-10-05 | @electrichains | Console and onboarding | code | Open roles filled by invitation: a one-time code from the console, /join on Telegram, the founder says yes, the newcomer is linked and welcomed (C2, D52) | [#43](https://github.com/jamot-pro/JamotLite/pull/43) | @electrichains |
| 25 | 2026-10-05 | @electrichains | Survival and succession | code | Noticing a dropped role: a kind check-in for quiet stewards (still on it, hand it over, pause), roles open again with no answer, the founder told who could take them (C3, D53) | [#44](https://github.com/jamot-pro/JamotLite/pull/44) | @electrichains |
| 26 | 2026-10-06 | @electrichains | Stewardship and the ledger | code | The contribution record in the runtime: /did confirmed by the founder, rewards as notes, /ledger, and the experiment's numbers on a Contributions page (C4, D54) | [#45](https://github.com/jamot-pro/JamotLite/pull/45) | @electrichains |
