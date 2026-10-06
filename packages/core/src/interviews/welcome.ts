import type { CompanyStore } from "@jamot/ports";
import type { Notifier } from "../heartbeats/notify.js";
import {
	factsText,
	type Interview,
	type InterviewDeps,
	InterviewError,
	type InterviewState,
	interviewTurn,
	startInterview,
} from "./interviews.js";

/**
 * Welcoming someone who just joined (D61): the same interview engine as the
 * founder's charter, with the `newcomer` definition. It starts when a person
 * is linked on Telegram — an invitation the founder approved, or a pairing
 * code — and while it's open their messages go to the interview, not to the
 * agents. When it's complete, what they said becomes their memory (so the
 * agents work with them well) and the founder gets a short summary.
 */

export const welcomeKey = (personId: string) => `interview.welcome.${personId}`;

interface OpenWelcome {
	nodeKey: string;
	name: string;
	state: InterviewState;
}

/** Starts a welcome; returns the opening to send them. */
export async function startWelcome(
	store: CompanyStore,
	interview: Interview,
	who: { personId: string; nodeKey: string; name: string },
): Promise<string> {
	const company = (await store.graph.getCompany())?.name ?? "the company";
	const state = startInterview(interview, {
		context: { company, name: who.name.split(" ")[0] ?? who.name },
	});
	await store.transaction(async (tx) => {
		await tx.settings.set(welcomeKey(who.personId), {
			nodeKey: who.nodeKey,
			name: who.name,
			state,
		} satisfies OpenWelcome);
		await tx.events.append({
			type: "interview.started",
			source: "interviews",
			subject: who.nodeKey,
			data: { interview: interview.definition.id },
			idempotencyKey: `interview-started:${who.personId}:${state.messages[0]?.at}`,
		});
	});
	return state.messages[0]?.text ?? "";
}

// One turn at a time per person: two quick messages never overwrite each other.
const turns = new Map<string, Promise<unknown>>();

/**
 * A message from someone: if their welcome is open, one turn of it, and the
 * reply to send; null when they have no welcome open (the agents answer).
 */
export async function continueWelcome(
	deps: InterviewDeps & { store: CompanyStore; notifier: Notifier },
	interview: () => Interview,
	personId: string,
	text: string,
): Promise<string | null> {
	const { store } = deps;
	if (!(await store.settings.get(welcomeKey(personId)))) return null;
	const before = turns.get(personId) ?? Promise.resolve();
	const mine = before.then(() => turn(deps, interview, personId, text));
	turns.set(
		personId,
		mine.catch(() => undefined),
	);
	try {
		return await mine;
	} finally {
		if (turns.get(personId) === mine) turns.delete(personId);
	}
}

async function turn(
	deps: InterviewDeps & { store: CompanyStore; notifier: Notifier },
	interview: () => Interview,
	personId: string,
	text: string,
): Promise<string | null> {
	const { store } = deps;
	const open = await store.settings.get<OpenWelcome>(welcomeKey(personId));
	if (!open) return null;
	const def = interview();
	let next: Awaited<ReturnType<typeof interviewTurn>>;
	try {
		next = await interviewTurn(deps, def, open.state, text);
	} catch (err) {
		if (err instanceof InterviewError) return err.message;
		throw err;
	}
	if (next.state.status !== "complete") {
		await store.settings.set(welcomeKey(personId), {
			...open,
			state: next.state,
		} satisfies OpenWelcome);
		return next.reply;
	}

	// Complete: what they said becomes their memory; the founder is told.
	const summary = factsText(def, next.state);
	await store.transaction(async (tx) => {
		for (const f of def.definition.fields) {
			const value = next.state.facts[f.id];
			if (!value) continue;
			await tx.memory.store({
				scope: "person",
				ownerId: personId,
				kind: "profile",
				content: `${f.label}: ${value}`,
				data: { interview: def.definition.id, field: f.id },
				source: "human",
				confidence: 1,
			});
		}
		await tx.settings.delete(welcomeKey(personId));
		await tx.events.append({
			type: "interview.completed",
			source: "interviews",
			subject: open.nodeKey,
			data: {
				interview: def.definition.id,
				fields: Object.keys(next.state.facts),
			},
			idempotencyKey: `interview-completed:${personId}:${next.state.messages.at(-1)?.at}`,
		});
	});
	await deps.notifier.toOwner({
		text: `👋 ${open.name} finished their welcome:\n\n${summary}`,
	});
	return next.reply;
}
