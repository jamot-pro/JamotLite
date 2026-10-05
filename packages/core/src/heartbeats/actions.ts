import type { CompanyStore } from "@jamot/ports";
import { isRetired } from "../company/retired.js";

/**
 * The one-tap fixes heartbeats propose. `action` comes back from a button the
 * owner pressed; the channel has already checked it was the owner.
 * Returns what to tell them.
 */
export async function handleOwnerAction(
	store: CompanyStore,
	action: string,
	by: string,
): Promise<string> {
	const assign = /^assign:([a-z0-9-]+):([a-z0-9-]+)$/.exec(action);
	if (assign) {
		const [, responsibilityKey, ownerKey] = assign as unknown as [
			string,
			string,
			string,
		];
		const nodes = await store.graph.listNodes();
		const responsibility = nodes.find(
			(n) => n.kind === "responsibility" && n.key === responsibilityKey,
		);
		const owner = nodes.find(
			(n) =>
				n.key === ownerKey &&
				(n.kind === "human" || n.kind === "agent" || n.kind === "team") &&
				!isRetired(n),
		);
		if (!responsibility || !owner)
			return "That's no longer in the company map.";
		const edges = await store.graph.listEdges();
		const current = edges.find(
			(e) =>
				e.toNodeId === responsibility.id &&
				(e.relation === "responsible_for" || e.relation === "owns"),
		);
		if (current) {
			const holder = nodes.find((n) => n.id === current.fromNodeId);
			return `“${responsibility.name}” is already owned by ${holder?.name ?? "someone"}.`;
		}
		await store.transaction(async (tx) => {
			await tx.graph.addEdge({
				fromNodeId: owner.id,
				toNodeId: responsibility.id,
				relation: "responsible_for",
			});
			await tx.events.append({
				type: "responsibility.assigned",
				source: "owner",
				subject: responsibility.key,
				data: { owner: owner.key, by },
				idempotencyKey: `assigned:${responsibility.key}:${owner.key}:${Date.now()}`,
			});
		});
		return `Done — ${owner.name} now owns “${responsibility.name}”.`;
	}
	return "I don't know that action.";
}
