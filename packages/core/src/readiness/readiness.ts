import type { StoredEdge, StoredNode } from "@jamot/ports";
import { isRetired } from "../company/retired.js";

/**
 * Readiness: how ready the company is to keep going, derived from its map —
 * never stored, never hand-set. Every gap names the node it is about, so a
 * heartbeat can act on it and a screen can link to it.
 */

export interface Gap {
	/** Node key the gap is about, when there is one. */
	key: string | null;
	name: string;
}

export interface ReadinessDimension {
	key:
		| "dream"
		| "responsibilities"
		| "people"
		| "teams"
		| "tools"
		| "heartbeats"
		| "recovery";
	label: string;
	score: number;
	missing: Gap[];
}

export interface Readiness {
	dimensions: ReadinessDimension[];
	/** 0–1, the average of the dimensions. */
	overall: number;
	/** Every responsibility owned, every team watched — the JAMOT badge. */
	covered: boolean;
}

const OWNER_RELATIONS = new Set(["responsible_for", "owns"]);
const OWNER_KINDS = new Set(["human", "agent", "team"]);

export function computeReadiness(graph: {
	nodes: StoredNode[];
	edges: StoredEdge[];
}): Readiness {
	const { nodes, edges } = graph;
	const byId = new Map(nodes.map((n) => [n.id, n]));
	// A retired agent is history, not someone on it.
	const ofKind = (kind: StoredNode["kind"]) =>
		nodes.filter((n) => n.kind === kind && !isRetired(n));
	const gap = (n: StoredNode): Gap => ({ key: n.key, name: n.name });
	const dimensions: ReadinessDimension[] = [];
	const presence = (
		key: ReadinessDimension["key"],
		label: string,
		ok: boolean,
		missing: string,
	) =>
		dimensions.push({
			key,
			label,
			score: ok ? 1 : 0,
			missing: ok ? [] : [{ key: null, name: missing }],
		});

	const dream = ofKind("dream")[0];
	const objective =
		typeof dream?.config.objective === "string"
			? dream.config.objective.trim()
			: "";
	presence(
		"dream",
		"The charter is written",
		objective.length > 0,
		"Write the charter's mission",
	);

	const owners = (responsibilityId: string) =>
		edges.filter(
			(e) =>
				e.toNodeId === responsibilityId &&
				OWNER_RELATIONS.has(e.relation) &&
				OWNER_KINDS.has(byId.get(e.fromNodeId)?.kind ?? ""),
		);
	const responsibilities = ofKind("responsibility");
	const unowned = responsibilities.filter((r) => owners(r.id).length === 0);
	dimensions.push({
		key: "responsibilities",
		label: "Every responsibility has an owner",
		score: fraction(
			responsibilities.length - unowned.length,
			responsibilities.length,
		),
		missing: unowned.map(gap),
	});

	presence(
		"people",
		"People or agents are on it",
		ofKind("human").length + ofKind("agent").length > 0,
		"Add a person or an agent",
	);
	presence(
		"teams",
		"There is at least one team",
		ofKind("team").length > 0,
		"Add a team",
	);
	presence(
		"tools",
		"There is at least one tool",
		ofKind("tool").length > 0,
		"Add a tool",
	);

	const monitored = new Set(
		edges
			.filter(
				(e) =>
					e.relation === "monitors" &&
					byId.get(e.fromNodeId)?.kind === "heartbeat",
			)
			.map((e) => e.toNodeId),
	);
	const watchable = [...ofKind("team"), ...(dream ? [dream] : [])];
	const unwatched = watchable.filter((n) => !monitored.has(n.id));
	dimensions.push({
		key: "heartbeats",
		label: "Every team and the charter have a heartbeat",
		score: fraction(watchable.length - unwatched.length, watchable.length),
		missing: unwatched.map(gap),
	});

	// Recoverable: an owned responsibility whose owner — or the owner's team — is watched.
	const teamsOf = (nodeId: string) =>
		edges
			.filter((e) => e.fromNodeId === nodeId && e.relation === "member_of")
			.map((e) => e.toNodeId);
	const unrecoverable = responsibilities.filter((r) => {
		const ownerIds = owners(r.id).map((e) => e.fromNodeId);
		if (ownerIds.length === 0) return false; // already counted as unowned
		return !ownerIds.some(
			(id) =>
				monitored.has(id) ||
				monitored.has(r.id) ||
				teamsOf(id).some((t) => monitored.has(t)),
		);
	});
	dimensions.push({
		key: "recovery",
		label: "If an owner goes quiet, a heartbeat notices",
		score: unrecoverable.length === 0 ? 1 : 0,
		missing: unrecoverable.map(gap),
	});

	const overall =
		dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length;
	return {
		dimensions,
		overall,
		covered: dimensions.every((d) => d.score === 1),
	};
}

function fraction(done: number, total: number): number {
	return total === 0 ? 1 : done / total;
}

/** Responsibilities nobody owns, with the owners a person could pick from. */
export function unownedResponsibilities(graph: {
	nodes: StoredNode[];
	edges: StoredEdge[];
}): StoredNode[] {
	const keys = new Set(
		computeReadiness(graph)
			.dimensions.find((d) => d.key === "responsibilities")
			?.missing.map((g) => g.key) ?? [],
	);
	return graph.nodes.filter(
		(n) => n.kind === "responsibility" && keys.has(n.key),
	);
}
