import type { BrainTool } from "@jamot/brain";
import type { CompanyStore } from "@jamot/ports";

/** What an agent may know and note down about the person it is talking to. */
export function memoryTools(
	store: CompanyStore,
	about: { personId: string; displayName: string },
): BrainTool[] {
	return [
		{
			name: "remember",
			description: `Note something worth remembering next time — about ${about.displayName} (a preference, an allergy, a date) or about the company. Keep it short and factual.`,
			parameters: {
				type: "object",
				properties: {
					about: { type: "string", enum: ["person", "company"] },
					note: { type: "string", minLength: 3 },
				},
				required: ["about", "note"],
			},
			async execute(args, ctx) {
				const onPerson = args.about === "person";
				await store.memory.store({
					scope: onPerson ? "person" : "company",
					ownerId: onPerson ? about.personId : null,
					kind: "fact",
					content: String(args.note),
					data: { runId: ctx.runId, agentKey: ctx.agentKey },
					source: "agent",
					confidence: 0.8,
				});
				return { text: "Noted." };
			},
		},
		{
			name: "recall",
			description: `Search what the company remembers — about ${about.displayName} and about the company itself.`,
			parameters: {
				type: "object",
				properties: { query: { type: "string", minLength: 2 } },
				required: ["query"],
			},
			async execute(args) {
				const query = String(args.query);
				const found = [
					...(await store.memory.search(query, {
						scope: "person",
						ownerId: about.personId,
						limit: 5,
					})),
					...(await store.memory.search(query, { scope: "company", limit: 5 })),
				];
				if (found.length === 0)
					return { text: "Nothing remembered about that." };
				return { text: found.map((m) => `- ${m.content}`).join("\n") };
			},
		},
	];
}
