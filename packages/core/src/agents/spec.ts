import type { AgentSpec, BrainTool, ModelAccess } from "@jamot/brain";
import type { DreamConfig } from "@jamot/contracts";
import type { CompanyRecord, StoredEdge, StoredNode } from "@jamot/ports";
import { isRetired } from "../company/retired.js";

/**
 * Agents are graph nodes (RUNTIME D18). This turns one into what the brain
 * runs: its instructions, framed by the company's charter — its vision, its
 * mission, and the values it never breaks — the same for every agent.
 */
export function agentSpecFromNode(input: {
	node: StoredNode;
	company: CompanyRecord;
	dream: DreamConfig | null;
	model: ModelAccess;
	tools: BrainTool[];
}): AgentSpec {
	const { node, company, dream } = input;
	const role = typeof node.config.role === "string" ? node.config.role : null;
	const own =
		typeof node.config.instructions === "string"
			? node.config.instructions
			: "";
	const lines = [
		`You are ${node.name}${role ? ` — ${role}` : ""}, at ${company.name}.`,
	];
	// The charter, in its own words: the code name `dream` is never shown.
	if (dream?.vision) lines.push(`The company's vision: ${dream.vision}`);
	if (dream?.objective) lines.push(`Its mission: ${dream.objective}`);
	if (dream?.constraints.length) {
		lines.push(
			"Its values — rules the company never breaks:",
			...dream.constraints.map((c) => `- ${c}`),
		);
	}
	if (own) lines.push("", own);
	return {
		key: node.key,
		instructions: lines.join("\n"),
		model: input.model,
		tools: input.tools,
	};
}

/**
 * The agent that answers a channel: one that uses (or can reach) the channel's
 * tool — "host uses t-telegram" in the templates — or, failing that, one in a
 * team that can; otherwise the first agent. Null when the company has none.
 */
export function pickChannelAgent(
	nodes: StoredNode[],
	edges: StoredEdge[],
	channel: string,
): StoredNode | null {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const isChannelTool = (id: string) => {
		const n = byId.get(id);
		return (
			n?.kind === "tool" && `${n.key} ${n.name}`.toLowerCase().includes(channel)
		);
	};
	const reaches = (fromId: string) =>
		edges.some(
			(e) =>
				e.fromNodeId === fromId &&
				(e.relation === "uses" || e.relation === "has_access_to") &&
				isChannelTool(e.toNodeId),
		);
	const agents = nodes.filter((n) => n.kind === "agent" && !isRetired(n));

	const direct = agents.find((a) => reaches(a.id));
	if (direct) return direct;
	const viaTeam = agents.find((a) =>
		edges.some(
			(e) =>
				e.fromNodeId === a.id &&
				e.relation === "member_of" &&
				reaches(e.toNodeId),
		),
	);
	return viaTeam ?? agents[0] ?? null;
}
