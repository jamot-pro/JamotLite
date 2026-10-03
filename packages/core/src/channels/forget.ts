import type { CompanyStore } from "@jamot/ports";

/**
 * A person asked to be forgotten (the web chat's "forget me"): their
 * memories, their conversations with every message, the agents' transcripts
 * of those conversations and the words of their runs, and the person with
 * their identities — in one transaction. Run costs stay, with no words in
 * them; events and jobs only ever held ids.
 */
export async function forgetPerson(
	store: CompanyStore,
	personId: string,
): Promise<void> {
	await store.transaction(async (tx) => {
		for (;;) {
			const memories = await tx.memory.list({ ownerId: personId, limit: 200 });
			if (memories.length === 0) break;
			for (const m of memories) await tx.memory.forget(m.id);
		}
		for (;;) {
			const conversations = await tx.conversations.list({
				personId,
				limit: 200,
			});
			if (conversations.length === 0) break;
			for (const c of conversations) {
				const sessions = `${c.channel}:${c.externalThreadId}:`;
				await tx.transcripts.erase(sessions);
				await tx.runs.eraseText(sessions);
				await tx.conversations.erase(c.id);
			}
		}
		await tx.people.delete(personId);
	});
}
