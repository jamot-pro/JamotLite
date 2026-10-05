import { randomUUID } from "node:crypto";
import type {
	AgentInput,
	AgentRow,
	AgentsView,
	ToolRow,
} from "@jamot/contracts";
import type {
	CompanyPorts,
	CompanyStore,
	StoredEdge,
	StoredNode,
} from "@jamot/ports";
import { isRetired } from "../company/retired.js";
import { listConnections } from "../connections/connections.js";
import { pickChannelAgent } from "./spec.js";

/**
 * Agents, managed from the console (RUNTIME D47): the owner reads each agent
 * — what it does, where it works, what it may use, what it costs — changes
 * its name, role, instructions, team and tools, adds one, or retires one.
 *
 * Every change is one transaction and one event naming who made it, so the
 * company's history says "the owner changed Host's instructions". The agent
 * reads its node at every run: a change applies from its next run. Only the
 * owner's console session reaches these; an outside AI can only propose.
 */

export const AGENT_LIMITS = { name: 80, role: 160, instructions: 8_000 };

/** A sentence the owner can act on, for a refusal. */
export class AgentError extends Error {}

const TOOL_RELATIONS = new Set(["uses", "has_access_to"]);

const str = (v: unknown) => (typeof v === "string" ? v : null);

/** What the Agents page shows. `channels`: the ones this company answers on. */
export async function agentsView(
	store: CompanyStore,
	opts: { channels: { id: string; label: string }[]; now?: Date },
): Promise<AgentsView> {
	const nodes = await store.graph.listNodes();
	const edges = await store.graph.listEdges();
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const since = new Date(
		(opts.now ?? new Date()).getTime() - 30 * 86_400_000,
	).toISOString();
	const connections = (await listConnections(store)).filter(
		(c) => !c.revokedAt,
	);
	const answering = new Map(
		opts.channels.map((c) => [
			c.label,
			pickChannelAgent(nodes, edges, c.id)?.key ?? null,
		]),
	);
	const from = (id: string, relations: Set<string>) =>
		edges
			.filter((e) => e.fromNodeId === id && relations.has(e.relation))
			.map((e) => byId.get(e.toNodeId))
			.filter((n): n is StoredNode => !!n);
	const live = nodes.filter((n) => !isRetired(n));

	const agents: AgentRow[] = [];
	for (const n of live.filter((n) => n.kind === "agent")) {
		const teams = from(n.id, new Set(["member_of"])).filter(
			(t) => t.kind === "team",
		);
		const own = from(n.id, TOOL_RELATIONS).filter((t) => t.kind === "tool");
		const viaTeams = teams
			.flatMap((t) => from(t.id, TOOL_RELATIONS))
			.filter((t) => t.kind === "tool" && !own.some((o) => o.id === t.id));
		const totals = await store.runs.totals({ since, agentKey: n.key });
		const [last] = await store.runs.list({ agentKey: n.key, limit: 1 });
		agents.push({
			key: n.key,
			name: n.name,
			role: str(n.config.role),
			instructions: str(n.config.instructions) ?? "",
			teams: teams.map((t) => ({ key: t.key, name: t.name })),
			tools: own.map((t) => t.key),
			teamTools: [...new Set(viaTeams.map((t) => t.key))],
			owns: from(n.id, new Set(["owns", "responsible_for"]))
				.filter((r) => r.kind === "responsibility")
				.map((r) => r.name),
			answers: [...answering]
				.filter(([, key]) => key === n.key)
				.map(([label]) => label),
			runs30d: { runs: totals.runs, costMicroUsd: totals.costMicroUsd },
			lastRunAt: last?.startedAt ?? null,
			connections: connections.filter((c) => c.nodeKey === n.key).length,
		});
	}

	return {
		agents,
		retired: nodes
			.filter((n) => n.kind === "agent" && isRetired(n))
			.map((n) => ({
				key: n.key,
				name: n.name,
				retiredAt: String(n.config.retiredAt),
			})),
		teams: live
			.filter((n) => n.kind === "team")
			.map((t) => ({ key: t.key, name: t.name })),
		tools: live.filter((n) => n.kind === "tool").map(toolRow),
		limits: AGENT_LIMITS,
	};
}

function toolRow(t: StoredNode): ToolRow {
	const mcp = t.config.mcp as { url?: unknown; allow?: unknown } | undefined;
	const allow = Array.isArray(mcp?.allow)
		? mcp.allow.filter((a): a is string => typeof a === "string")
		: [];
	return {
		key: t.key,
		name: t.name,
		purpose: str(t.config.purpose),
		approval:
			typeof mcp?.url !== "string"
				? "Not connected to a system yet: agents can't act through it on their own."
				: allow.length === 0
					? "Every action waits for your approval."
					: `${allow.join(", ")} run straight away; everything else waits for your approval.`,
	};
}

/** Checks and trims what the owner typed. */
function clean(input: AgentInput): AgentInput {
	const out: AgentInput = {};
	for (const field of ["name", "role", "instructions"] as const)
		if (input[field] !== undefined && typeof input[field] !== "string")
			throw new AgentError(`The ${field} must be text.`);
	if (
		input.teamKey !== undefined &&
		input.teamKey !== null &&
		typeof input.teamKey !== "string"
	)
		throw new AgentError("Say the team by its key.");
	if (input.name !== undefined) {
		const name = String(input.name).trim();
		if (!name) throw new AgentError("Give the agent a name.");
		if (name.length > AGENT_LIMITS.name)
			throw new AgentError(
				`A name is at most ${AGENT_LIMITS.name} characters.`,
			);
		out.name = name;
	}
	if (input.role !== undefined) {
		const role = String(input.role).trim();
		if (role.length > AGENT_LIMITS.role)
			throw new AgentError(
				`A role is at most ${AGENT_LIMITS.role} characters: say what it does in a line.`,
			);
		out.role = role;
	}
	if (input.instructions !== undefined) {
		const instructions = String(input.instructions).trim();
		if (instructions.length > AGENT_LIMITS.instructions)
			throw new AgentError(
				`Instructions are at most ${AGENT_LIMITS.instructions} characters.`,
			);
		out.instructions = instructions;
	}
	if (input.teamKey !== undefined)
		out.teamKey = input.teamKey === null ? null : String(input.teamKey);
	return out;
}

async function activeAgent(tx: CompanyPorts, key: string) {
	const nodes = await tx.graph.listNodes();
	const node = nodes.find(
		(n) => n.kind === "agent" && n.key === key && !isRetired(n),
	);
	if (!node) throw new AgentError(`There's no agent "${key}" any more.`);
	return { node, nodes, edges: await tx.graph.listEdges() };
}

/** Moves an agent into one team (or none), ending its other memberships. */
async function placeInTeam(
	tx: CompanyPorts,
	agent: StoredNode,
	teamKey: string | null,
	nodes: StoredNode[],
	edges: StoredEdge[],
): Promise<boolean> {
	const team = teamKey
		? nodes.find((n) => n.kind === "team" && n.key === teamKey)
		: null;
	if (teamKey && !team) throw new AgentError(`There's no team "${teamKey}".`);
	const current = edges.filter(
		(e) =>
			e.fromNodeId === agent.id &&
			e.relation === "member_of" &&
			nodes.find((n) => n.id === e.toNodeId)?.kind === "team",
	);
	if (current.length === (team ? 1 : 0) && current[0]?.toNodeId === team?.id)
		return false;
	for (const e of current) await tx.graph.endEdge(e.id);
	if (team)
		await tx.graph.addEdge({
			fromNodeId: agent.id,
			toNodeId: team.id,
			relation: "member_of",
		});
	return true;
}

/** Changes an agent's name, role, instructions or team. Returns what to tell the owner. */
export async function updateAgent(
	store: CompanyStore,
	key: string,
	input: AgentInput,
	by: string,
): Promise<string> {
	const change = clean(input);
	return store.transaction(async (tx) => {
		const { node, nodes, edges } = await activeAgent(tx, key);
		const changed: string[] = [];
		const config = { ...node.config };
		if (change.role !== undefined && change.role !== (str(config.role) ?? "")) {
			config.role = change.role;
			changed.push("role");
		}
		if (
			change.instructions !== undefined &&
			change.instructions !== (str(config.instructions) ?? "")
		) {
			config.instructions = change.instructions;
			changed.push("instructions");
		}
		const renamed = change.name !== undefined && change.name !== node.name;
		if (renamed) changed.push("name");
		if (renamed || changed.length > 0)
			await tx.graph.updateNode(node.id, {
				...(renamed ? { name: change.name } : {}),
				config,
			});
		if (
			change.teamKey !== undefined &&
			(await placeInTeam(tx, node, change.teamKey, nodes, edges))
		)
			changed.push("team");
		if (changed.length === 0) return "Nothing changed.";
		await tx.events.append({
			type: "agent.updated",
			source: "console",
			idempotencyKey: `console:${randomUUID()}`,
			subject: node.key,
			data: { by, changed },
		});
		const name = change.name ?? node.name;
		return changed.includes("instructions")
			? `Saved ${name}. It works with the new instructions from its next run.`
			: `Saved ${name}.`;
	});
}

const slug = (name: string) =>
	name
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 30) || "agent";

/** A new agent in the map. Returns its key and what to tell the owner. */
export async function addAgent(
	store: CompanyStore,
	input: AgentInput,
	by: string,
): Promise<{ key: string; message: string }> {
	const change = clean(input);
	if (!change.name) throw new AgentError("Give the agent a name.");
	return store.transaction(async (tx) => {
		const nodes = await tx.graph.listNodes();
		const taken = new Set(nodes.map((n) => n.key));
		const base = slug(change.name as string);
		let key = base === "dream" ? "dream-agent" : base;
		for (let i = 2; taken.has(key); i++) key = `${base}-${i}`;
		const node = await tx.graph.addNode({
			key,
			kind: "agent",
			name: change.name as string,
			config: {
				role: change.role ?? "",
				instructions: change.instructions ?? "",
			},
		});
		if (change.teamKey) await placeInTeam(tx, node, change.teamKey, nodes, []);
		await tx.events.append({
			type: "agent.added",
			source: "console",
			idempotencyKey: `console:${randomUUID()}`,
			subject: key,
			data: { by },
		});
		return {
			key,
			message: `Added ${node.name}. Give it tools and a responsibility to put it to work.`,
		};
	});
}

/** Sets the tools an agent uses itself (team tools stay as they are). */
export async function setAgentTools(
	store: CompanyStore,
	key: string,
	toolKeys: string[],
	by: string,
): Promise<string> {
	return store.transaction(async (tx) => {
		const { node, nodes, edges } = await activeAgent(tx, key);
		const tools = nodes.filter((n) => n.kind === "tool" && !isRetired(n));
		const wanted = new Set(toolKeys);
		for (const k of wanted)
			if (!tools.some((t) => t.key === k))
				throw new AgentError(`There's no tool "${k}".`);
		const current = edges.filter(
			(e) =>
				e.fromNodeId === node.id &&
				TOOL_RELATIONS.has(e.relation) &&
				tools.some((t) => t.id === e.toNodeId),
		);
		const keyOf = (id: string) => tools.find((t) => t.id === id)?.key;
		const removed: string[] = [];
		for (const e of current) {
			const k = keyOf(e.toNodeId) as string;
			if (!wanted.has(k)) {
				await tx.graph.endEdge(e.id);
				removed.push(k);
			}
		}
		const have = new Set(current.map((e) => keyOf(e.toNodeId)));
		const added: string[] = [];
		for (const t of tools)
			if (wanted.has(t.key) && !have.has(t.key)) {
				await tx.graph.addEdge({
					fromNodeId: node.id,
					toNodeId: t.id,
					relation: "uses",
				});
				added.push(t.key);
			}
		if (added.length === 0 && removed.length === 0) return "Nothing changed.";
		await tx.events.append({
			type: "agent.tools_changed",
			source: "console",
			idempotencyKey: `console:${randomUUID()}`,
			subject: node.key,
			data: { by, added, removed },
		});
		return `Saved ${node.name}'s tools.`;
	});
}

/**
 * Retires an agent: it stops answering, owning and being reachable, and its
 * history stays. A company keeps at least one agent.
 */
export async function retireAgent(
	store: CompanyStore,
	key: string,
	by: string,
	now = new Date(),
): Promise<string> {
	return store.transaction(async (tx) => {
		const { node, nodes, edges } = await activeAgent(tx, key);
		const others = nodes.filter(
			(n) => n.kind === "agent" && n.id !== node.id && !isRetired(n),
		);
		if (others.length === 0)
			throw new AgentError(
				`${node.name} is the company's only agent: add another before retiring it.`,
			);
		const owned = edges
			.filter(
				(e) =>
					e.fromNodeId === node.id &&
					(e.relation === "owns" || e.relation === "responsible_for"),
			)
			.map((e) => nodes.find((n) => n.id === e.toNodeId)?.name)
			.filter((n): n is string => !!n);
		for (const e of edges)
			if (e.fromNodeId === node.id || e.toNodeId === node.id)
				await tx.graph.endEdge(e.id);
		await tx.graph.updateNode(node.id, {
			config: { ...node.config, retiredAt: now.toISOString() },
		});
		await tx.events.append({
			type: "agent.retired",
			source: "console",
			idempotencyKey: `console:${randomUUID()}`,
			subject: node.key,
			data: { by, owned },
		});
		return owned.length
			? `Retired ${node.name}. ${owned.join(", ")} now ${owned.length === 1 ? "has" : "have"} no owner.`
			: `Retired ${node.name}.`;
	});
}
