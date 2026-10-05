import { randomBytes } from "node:crypto";
import type { Approval, CompanyPorts, CompanyStore } from "@jamot/ports";
import { isRetired } from "../company/retired.js";
import { handleOwnerAction } from "../heartbeats/actions.js";

/**
 * What an outside agent may propose (BLUEPRINT S8). A proposal is an approval
 * like the in-house agents' ones — the owner sees it on Telegram or in the
 * console — and nothing happens until a person approves it. Then the company
 * does it the usual way: a message goes through the outbox (so it becomes
 * memory), an owner change through the same action a heartbeat offers.
 */

export type Proposal =
	| { kind: "message_person"; personId: string; text: string }
	| { kind: "assign_owner"; responsibilityKey: string; ownerKey: string };

/** Approvals of outside agents live in sessions "mcp:<connection id>". */
export const PROPOSAL_SESSION_PREFIX = "mcp:";

export async function propose(
	store: CompanyStore,
	from: { connectionId: string; nodeKey: string; runId: string },
	proposal: Proposal,
): Promise<Approval> {
	if (proposal.kind === "message_person") {
		const person = await store.people.get(proposal.personId);
		if (!person) throw new Error(`no person ${proposal.personId}`);
		const [conversation] = await store.conversations.list({
			personId: person.id,
			limit: 1,
		});
		if (!conversation)
			throw new Error(
				`${person.displayName} has never written to the company, so there's no conversation to answer in`,
			);
	} else {
		const nodes = await store.graph.listNodes();
		if (
			!nodes.some(
				(n) =>
					n.kind === "responsibility" && n.key === proposal.responsibilityKey,
			)
		)
			throw new Error(`no responsibility ${proposal.responsibilityKey}`);
		if (
			!nodes.some(
				(n) =>
					n.key === proposal.ownerKey &&
					(n.kind === "human" || n.kind === "agent" || n.kind === "team") &&
					!isRetired(n),
			)
		)
			throw new Error(`no person, agent or team ${proposal.ownerKey}`);
	}
	const { kind, ...args } = proposal;
	return store.approvals.create({
		runId: from.runId,
		sessionId: `${PROPOSAL_SESSION_PREFIX}${from.connectionId}`,
		agentKey: from.nodeKey,
		tool: `propose.${kind}`,
		toolCallId: randomBytes(8).toString("hex"),
		args,
	});
}

/** A person decided a proposal: record it, and carry it out if approved. */
export async function decideProposal(
	store: CompanyStore,
	approval: Approval,
	decision: { approved: boolean; by: string; note?: string },
): Promise<string> {
	const args = approval.args as Record<string, string>;
	const record = (tx: CompanyPorts) =>
		// Throws if it was already decided, so it's carried out once.
		tx.approvals.decide(approval.id, {
			approved: decision.approved,
			by: decision.by,
			note: decision.note ?? null,
		});
	let result = "Declined.";
	if (!decision.approved) {
		await record(store);
	} else if (approval.tool === "propose.message_person") {
		// The decision and the queued message, together or not at all.
		await store.transaction(async (tx) => {
			const [conversation] = await tx.conversations.list({
				personId: args.personId as string,
				limit: 1,
			});
			if (!conversation) throw new Error("that conversation is gone");
			await record(tx);
			await tx.conversations.enqueue({
				conversationId: conversation.id,
				text: args.text as string,
				agentKey: approval.agentKey,
				personId: args.personId as string,
			});
		});
		result = "Sent.";
	} else if (approval.tool === "propose.assign_owner") {
		// The change first, then the decision: a crash between them leaves it
		// pending to approve again (assigning twice is harmless), never decided
		// with nothing done. It's the one-tap action a heartbeat offers.
		const current = await store.approvals.get(approval.id);
		if (current?.status !== "pending")
			throw new Error(`already ${current?.status ?? "gone"}`);
		result = await handleOwnerAction(
			store,
			`assign:${args.responsibilityKey}:${args.ownerKey}`,
			decision.by,
		);
		await record(store);
	} else {
		throw new Error(`unknown proposal ${approval.tool}`);
	}
	await store.events.append({
		type: "proposal.decided",
		source: "mcp",
		subject: approval.agentKey,
		data: {
			approvalId: approval.id,
			tool: approval.tool,
			approved: decision.approved,
		},
		idempotencyKey: `proposal-decided:${approval.id}`,
	});
	return result;
}
