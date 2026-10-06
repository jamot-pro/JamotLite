# Vision — the founder's operating system

> **You bring the idea and the belief. Jamot gets it done: agents do the work
> first, people from your network fill the gaps, everyone's contribution is on
> the record, and when someone drops a role, Jamot finds the next person.**

The founder chose this direction on 2026-10-05 (RUNTIME D51). It builds on
everything Lite already is: a company in one folder, a charter that runs,
responsibilities with owners, heartbeats that keep watch, and "the agent
proposes, a person decides".

## Who it's for

A founder who believes in something and wants it to happen, but can't do all
the work alone. They might have some money, or none. They have the vision and
a few people around them who might help. What they lack is the execution: the
planning, the follow-up, the onboarding, keeping people engaged, and noticing
when something has stalled.

Jamot is that execution partner. It doesn't replace the founder's judgement.
It does the work agents can do and organises the work people do.

## What Jamot does for them

1. **Turns the idea into a company.** The charter (vision, mission, values,
   goals) becomes a map of responsibilities, each with an owner, either an
   agent or a person.
2. **Agents first.** Anything an agent can do (answering, drafting,
   monitoring, research) an agent does. People are brought in for what agents
   can't do: trust, judgement, physical work, relationships.
3. **Brings people in and onboards them.** A responsibility nobody owns is an
   *open role*. The founder invites someone from their network to it. The
   candidate sees the charter and the role, says yes, and the founder approves.
   The newcomer is paired on Telegram and gets an onboarding brief: what the
   company is for, what the role is, what's open, and who's who.
4. **Keeps everyone moving.** Heartbeats tell each person what needs them. When
   someone goes quiet, Jamot checks in kindly: still on it, hand it over, or
   pause. If there's no answer, the role goes back to open and Jamot suggests
   who could take it.
5. **Records every contribution.** Approvals decided, roles taken and work done
   are recorded automatically; a person can add "I did this", and the founder
   confirms it. Everyone can see their own record.
6. **Lets the founder reward fairly.** Rewards are the founder's decision,
   recorded next to the contributions they're for. Jamot never pays anyone.

## The laws

1. **An agent proposes; a person decides.** The agent never hires, removes,
   pays or rewards anyone on its own. It invites, reminds, records and
   suggests; the founder approves.
2. **Every interaction with a person becomes memory**, and a person can ask to
   be forgotten.
3. **The company is its folder.** Export it, move it, run it without Jamot's
   servers.
4. **Newcomers see what they need, not everything.** Before they're approved a
   candidate sees the charter and their role only. Money and customers' names
   stay with the founder (D49).

## What we are not building (yet)

- **Tokens, equity or payouts.** Rewards are records. Anything with legal
  weight waits for legal advice.
- **A public marketplace of strangers.** People come from the founder's
  network, by invitation. An open market (through the hub) comes only if the
  experiment below says it's worth it.
- **An AI boss.** Jamot organises and reminds; it doesn't judge people's
  performance.

## The experiment

Option C rests on one assumption: **people will do real work in someone
else's project for a fair, visible reward.** Jamot tests it on itself: the
founder is bringing its first 4–10 developers in, with the contribution ledger
([CONTRIBUTIONS.md](../CONTRIBUTIONS.md)) already running.

From 2026-10-06 to 2026-11-30 we measure:

| Measure | Healthy |
|---|---|
| Invited people who join and finish a first piece of work within 2 weeks | ≥ 50% |
| Of those, still contributing after 6 weeks | ≥ 40% |
| People who say the record of contributions is fair (asked directly) | most |
| Share of the company's work done by agents | rising over the weeks |
| Roles dropped and picked up again by someone else | at least one, if any are dropped |

On 2026-11-30 the founder decides: build toward the open market (if it's
healthy), or keep Jamot a tool for founders and small businesses with their
own people (if it isn't). Nothing built for C is wasted either way.

## How it gets built

Each step is one pull request, in this order (BLUEPRINT, "v0.3").

| Step | What | Status |
|---|---|---|
| C1 | This vision, the decision (D51) and the plan | this PR |
| C2 | Open roles and invites over Telegram: `/join CODE`, the founder approves, the newcomer is paired and briefed | next |
| C3 | Noticing a dropped role: last activity per person, a kind check-in, caretaker mode, back to open | |
| C4 | The contribution record in the runtime: automatic and `/did` contributions, the founder's rewards, `/ledger`, and the experiment's numbers on the Overview | |
| C5 | Tasks and the orchestrator: agents first, then the owner of the responsibility | after C4 |
