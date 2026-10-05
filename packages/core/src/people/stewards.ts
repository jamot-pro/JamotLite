import { randomUUID } from "node:crypto";
import type { StewardInput, StewardRow, StewardsView } from "@jamot/contracts";
import type { CompanyStore, StoredNode } from "@jamot/ports";
import { AgentError, placeInTeam } from "../agents/manage.js";
import { isRetired } from "../company/retired.js";
import { listConnections } from "../connections/connections.js";

/**
 * The people who run the company — its stewards — managed from the console
 * (RUNTIME D48): who they are, how to reach them, which team they're in and
 * which responsibilities they own. They are the `human` nodes of the company
 * map, so everything that reads the map (readiness, heartbeats, owner
 * choices, outside AIs connecting as someone) sees them at once.
 *
 * As with agents (D47), every change is one transaction and one event naming
 * who made it, and only the owner's console session reaches these.
 */

export const STEWARD_LIMITS = { name: 80, role: 160, handle: 64 };

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** What the Stewards page shows. `paired`: node keys whose Telegram is linked. */
export async function stewardsView(
	store: CompanyStore,
	opts: { paired: Set<string> },
): Promise<StewardsView> {
	const company = await store.graph.getCompany();
	const nodes = await store.graph.listNodes();
	const edges = await store.graph.listEdges();
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const live = nodes.filter((n) => !isRetired(n));
	const connections = (await listConnections(store)).filter(
		(c) => !c.revokedAt,
	);
	const ownerOf = (r: StoredNode) => {
		const e = edges.find(
			(e) =>
				e.toNodeId === r.id &&
				(e.relation === "owns" || e.relation === "responsible_for"),
		);
		const n = e ? byId.get(e.fromNodeId) : undefined;
		return n ? { key: n.key, name: n.name } : null;
	};

	const stewards: StewardRow[] = live
		.filter((n) => n.kind === "human")
		.map((n) => ({
			key: n.key,
			name: n.name,
			role: str(n.config.role),
			telegram: str(n.config.telegram),
			github: str(n.config.github),
			teams: edges
				.filter((e) => e.fromNodeId === n.id && e.relation === "member_of")
				.map((e) => byId.get(e.toNodeId))
				.filter((t): t is StoredNode => t?.kind === "team")
				.map((t) => ({ key: t.key, name: t.name })),
			owns: edges
				.filter(
					(e) =>
						e.fromNodeId === n.id &&
						(e.relation === "owns" || e.relation === "responsible_for"),
				)
				.map((e) => byId.get(e.toNodeId))
				.filter((r): r is StoredNode => r?.kind === "responsibility")
				.map((r) => ({ key: r.key, name: r.name })),
			founder: company?.founderKey === n.key,
			paired: opts.paired.has(n.key),
			connections: connections.filter((c) => c.nodeKey === n.key).length,
		}));

	return {
		stewards,
		retired: nodes
			.filter((n) => n.kind === "human" && isRetired(n))
			.map((n) => ({
				key: n.key,
				name: n.name,
				retiredAt: String(n.config.retiredAt),
			})),
		teams: live
			.filter((n) => n.kind === "team")
			.map((t) => ({ key: t.key, name: t.name })),
		responsibilities: live
			.filter((n) => n.kind === "responsibility")
			.map((r) => ({ key: r.key, name: r.name, owner: ownerOf(r) })),
	};
}

/** Checks and trims what the owner typed. */
function clean(input: StewardInput): StewardInput {
	const out: StewardInput = {};
	for (const field of ["name", "role", "telegram", "github"] as const) {
		const v = input[field];
		if (v === undefined) continue;
		if (typeof v !== "string")
			throw new AgentError(`The ${field} must be text.`);
		out[field] = v.trim();
	}
	if (out.name !== undefined) {
		if (!out.name) throw new AgentError("Give the person a name.");
		if (out.name.length > STEWARD_LIMITS.name)
			throw new AgentError(
				`A name is at most ${STEWARD_LIMITS.name} characters.`,
			);
	}
	if (out.role !== undefined && out.role.length > STEWARD_LIMITS.role)
		throw new AgentError(
			`A role is at most ${STEWARD_LIMITS.role} characters: say what they do in a line.`,
		);
	for (const handle of ["telegram", "github"] as const) {
		const v = out[handle];
		if (v === undefined) continue;
		// Handles are written without the @, and only as their services allow.
		const bare = v.replace(/^@/, "");
		if (bare && !/^[A-Za-z0-9_-]{1,64}$/.test(bare))
			throw new AgentError(
				`That ${handle === "telegram" ? "Telegram" : "GitHub"} handle doesn't look right: letters, digits, _ and - only.`,
			);
		out[handle] = bare;
	}
	if (input.teamKey !== undefined) {
		if (input.teamKey !== null && typeof input.teamKey !== "string")
			throw new AgentError("Say the team by its key.");
		out.teamKey = input.teamKey;
	}
	return out;
}

const slug = (name: string) =>
	name
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 30) || "person";

/** A new person in the company map. Returns their key and what to tell the owner. */
export async function addSteward(
	store: CompanyStore,
	input: StewardInput,
	by: string,
): Promise<{ key: string; message: string }> {
	const change = clean(input);
	if (!change.name) throw new AgentError("Give the person a name.");
	return store.transaction(async (tx) => {
		const nodes = await tx.graph.listNodes();
		const taken = new Set(nodes.map((n) => n.key));
		const base = slug(change.name as string);
		let key = base === "dream" ? "dream-person" : base;
		for (let i = 2; taken.has(key); i++) key = `${base}-${i}`;
		const node = await tx.graph.addNode({
			key,
			kind: "human",
			name: change.name as string,
			config: {
				role: change.role ?? "",
				...(change.telegram ? { telegram: change.telegram } : {}),
				...(change.github ? { github: change.github } : {}),
			},
		});
		if (change.teamKey) await placeInTeam(tx, node, change.teamKey, nodes, []);
		await tx.events.append({
			type: "steward.added",
			source: "console",
			idempotencyKey: `console:${randomUUID()}`,
			subject: key,
			data: { by },
		});
		return {
			key,
			message: `Added ${node.name}. Give them a responsibility, then a pairing code for their Telegram.`,
		};
	});
}

/** Changes a person's name, role, handles or team. */
export async function updateSteward(
	store: CompanyStore,
	key: string,
	input: StewardInput,
	by: string,
): Promise<string> {
	const change = clean(input);
	return store.transaction(async (tx) => {
		const nodes = await tx.graph.listNodes();
		const node = nodes.find(
			(n) => n.kind === "human" && n.key === key && !isRetired(n),
		);
		if (!node) throw new AgentError(`There's no one "${key}" any more.`);
		const config = { ...node.config };
		const changed: string[] = [];
		for (const field of ["role", "telegram", "github"] as const) {
			const v = change[field];
			if (v === undefined || v === (str(config[field]) ?? "")) continue;
			if (v) config[field] = v;
			else delete config[field];
			changed.push(field);
		}
		const renamed = change.name !== undefined && change.name !== node.name;
		if (renamed) changed.push("name");
		if (changed.length)
			await tx.graph.updateNode(node.id, {
				...(renamed ? { name: change.name } : {}),
				config,
			});
		if (
			change.teamKey !== undefined &&
			(await placeInTeam(
				tx,
				node,
				change.teamKey,
				nodes,
				await tx.graph.listEdges(),
			))
		)
			changed.push("team");
		if (changed.length === 0) return "Nothing changed.";
		await tx.events.append({
			type: "steward.updated",
			source: "console",
			idempotencyKey: `console:${randomUUID()}`,
			subject: node.key,
			data: { by, changed },
		});
		return `Saved ${change.name ?? node.name}.`;
	});
}

/**
 * Sets what a person owns — the whole list. A responsibility someone else
 * owns moves to them; one they let go of is left without an owner, which the
 * Overview and the heartbeats then show.
 */
export async function setStewardResponsibilities(
	store: CompanyStore,
	key: string,
	responsibilityKeys: string[],
	by: string,
): Promise<string> {
	return store.transaction(async (tx) => {
		const nodes = await tx.graph.listNodes();
		const node = nodes.find(
			(n) => n.kind === "human" && n.key === key && !isRetired(n),
		);
		if (!node) throw new AgentError(`There's no one "${key}" any more.`);
		const responsibilities = nodes.filter(
			(n) => n.kind === "responsibility" && !isRetired(n),
		);
		const wanted = new Set(responsibilityKeys);
		for (const k of wanted)
			if (!responsibilities.some((r) => r.key === k))
				throw new AgentError(`There's no responsibility "${k}".`);
		const edges = await tx.graph.listEdges();
		const owning = (e: { relation: string }) =>
			e.relation === "owns" || e.relation === "responsible_for";
		const taken: string[] = [];
		const released: string[] = [];
		for (const r of responsibilities) {
			const current = edges.filter((e) => e.toNodeId === r.id && owning(e));
			const mine = current.some((e) => e.fromNodeId === node.id);
			if (wanted.has(r.key) && !mine) {
				for (const e of current) await tx.graph.endEdge(e.id);
				await tx.graph.addEdge({
					fromNodeId: node.id,
					toNodeId: r.id,
					relation: "responsible_for",
				});
				taken.push(r.name);
			} else if (!wanted.has(r.key) && mine) {
				for (const e of current)
					if (e.fromNodeId === node.id) await tx.graph.endEdge(e.id);
				released.push(r.name);
			}
		}
		if (taken.length + released.length === 0) return "Nothing changed.";
		await tx.events.append({
			type: "steward.responsibilities_changed",
			source: "console",
			idempotencyKey: `console:${randomUUID()}`,
			subject: node.key,
			data: { by, taken, released },
		});
		const parts = [
			taken.length ? `${node.name} now owns ${taken.join(", ")}.` : "",
			released.length
				? `${released.join(", ")} now ${released.length === 1 ? "has" : "have"} no owner.`
				: "",
		];
		return parts.filter(Boolean).join(" ");
	});
}
