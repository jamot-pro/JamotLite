# Storage ports — design input for M1

Status: **research, 2026-09-30.** From an inventory of the J-Nesys repository
(`packages/core/src/repository/repository.ts`, `schema/index.ts` and their
callers). It says which storage the kept domain code really needs, so the Lite
ports carry only that. **Built in M1:** graph, settings, people, conversations,
memory, events, jobs, ledger — in `packages/ports`, implemented in
`packages/sqlite`. Agents are graph nodes (RUNTIME D18); tasks, agent sessions,
policies, skills, channel accounts and secrets come with the milestones that
use them.

## What the old code actually used

J-Nesys had one repository interface with **~238 methods**. Kept core code
calls only **~54** of them; most of the rest serve dropped areas or API routes.
The proposal below is **~93 methods across 14 ports**, all async (Postgres
later), none with organization or space parameters (one company per database).

## Proposed ports

| Port | Methods | Notes |
|---|---|---|
| `GraphStore` / company | getCompany, updateCompany, getSettings, setSettings, listNodes, getNode, createNode, updateNode, deleteNode, listEdges, createEdge, endEdge, importGraph | ✅ M1a: getCompany, listNodes, listEdges, importGraph. Settings include the model config |
| `PeoplePort` | createPerson, getPerson, listPeople, updatePerson, deletePerson, findPersonByEmail, findPersonByPhone, upsertIdentity, findIdentity, findPersonByIdentity, listIdentitiesForPerson, updateIdentity, removeIdentity, createMergeCandidate, listMergeCandidates, resolveMergeCandidate, **mergePeople** | Fold the old actor/person split into people + agents. `mergePeople(keep, drop)` is one transaction instead of six calls |
| `ConversationPort` | upsertConversation(channelAccountId, externalThreadId), getConversation, listConversations, appendMessage, listMessages, enqueueOutbound, listPendingOutbound, markOutboundSent, markOutboundFailed | Old `conversations`/`messages` tables were never used; redesign with thread id, direction and channel account |
| `MemoryPort` | store, get, list, update, forget | Same shape as the old `MemoryProvider`; FTS5 search added |
| `AgentPort` | create, get, list, update, delete | JSON columns for harness, heartbeat, permissions |
| `AgentSessionPort` | create, get, getByTask, setStatus, appendEntry, listEntries, getEntry | May be replaced by pi's session storage (O1) |
| `TaskPort` | create, get, list, getBySource, update | Promote `sourceEventId` / `sourceAgentId` to columns (old code filtered JSON) |
| `JobPort` (new) | upsertJob, listJobs, claimDue(now), recordRun | Replaces the in-memory scheduler and the Postgres advisory lock |
| `EventPort` | append (idempotent on key), listSince, listUndelivered, markDelivered | One port for the outbox and the event bus |
| `LedgerPort` | ensureAccount(currency), post(entries[]), listEntries, balance | Integer minor units, never floats; balance updated in the same transaction |
| `PolicyPort` | listPolicies, upsertPolicy, deletePolicy, listRoles | |
| `SkillPort` | listSkills, getSkill, upsertSkill, deleteSkill, listCapabilities, getCapability | Skills also live as `skills/*/SKILL.md` in the company file (§8b) |
| `ChannelAccountPort` | list, get, create, update, delete | Telegram only. The bot token moves to the secret store |
| `SecretPort` | put, get, delete | Ciphertext only; encryption with `secrets.key` |

## Awkward spots to design around

- **Arrays.** Postgres `uuid[]` columns (assignees, skill ids, policy ids) have
  no SQLite equivalent. Use join tables where we query by them (task
  assignees), JSON text where we only read them whole.
- **JSON lookups.** Anything we filter on becomes a real column.
- **Polymorphic `refId`** on graph nodes (person, agent or tool) has no foreign
  key. Keep it, validated in code.
- **Cross-port writes.** Channel ingest (person + identity + message + memory +
  event) and merging people need one transaction across ports — a unit of work
  on the store, not one per port.
- **Ids.** Generated in the app (UUIDs; v7 where order matters), not by the
  database.
- **Timestamps.** ISO-8601 UTC text everywhere.
- **Money.** Integer minor units (the old Postgres `numeric` came back as
  strings).
- **Deletes.** The old code hard-deleted; history that matters (who owned what)
  is kept by ending edges (`validTo`), not deleting them.
- **Plaintext secrets.** The old Telegram bot token sat in plain text on the
  organization row. In Lite every credential goes through the secret store.
