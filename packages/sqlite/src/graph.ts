import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { OrgEdgeRelation, OrgNodeKind } from "@jamot/contracts";
import type {
	GraphImport,
	GraphStore,
	StoredEdge,
	StoredNode,
} from "@jamot/ports";
import { all, json, nowIso, one, type Row, run, type Sync } from "./sync.js";

export function graphOps(db: DatabaseSync): Sync<GraphStore> {
	return {
		getCompany() {
			const row = one(
				db,
				"SELECT id, name, summary, timezone, founder_key FROM company",
			);
			if (!row) return null;
			return {
				id: String(row.id),
				name: String(row.name),
				summary: String(row.summary),
				timezone: String(row.timezone),
				founderKey: (row.founder_key as string | null) ?? null,
			};
		},

		listNodes() {
			return all(
				db,
				"SELECT id, key, kind, name, ref_id, config, pos_x, pos_y FROM org_nodes ORDER BY seq",
			).map(toNode);
		},

		listEdges(opts = {}) {
			const where = opts.includeEnded ? "" : "WHERE valid_to IS NULL";
			return all(
				db,
				`SELECT id, from_node_id, to_node_id, relation, valid_from, valid_to FROM org_edges ${where} ORDER BY seq`,
			).map(toEdge);
		},

		addEdge(input) {
			const id = randomUUID();
			run(
				db,
				"INSERT INTO org_edges (id, from_node_id, to_node_id, relation, valid_from) VALUES (?, ?, ?, ?, ?)",
				id,
				input.fromNodeId,
				input.toNodeId,
				input.relation,
				nowIso(),
			);
			return toEdge(
				one(
					db,
					"SELECT id, from_node_id, to_node_id, relation, valid_from, valid_to FROM org_edges WHERE id = ?",
					id,
				) as Row,
			);
		},

		endEdge(edgeId) {
			return (
				run(
					db,
					"UPDATE org_edges SET valid_to = ? WHERE id = ? AND valid_to IS NULL",
					nowIso(),
					edgeId,
				) > 0
			);
		},

		importGraph(graph: GraphImport) {
			const existing = one<{ n: number }>(
				db,
				"SELECT count(*) AS n FROM company",
			);
			if (existing && existing.n > 0)
				throw new Error("this database already holds a company");

			const now = nowIso();
			const c = graph.company;
			run(
				db,
				"INSERT INTO company (singleton, id, name, summary, timezone, founder_key, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?)",
				c.id,
				c.name,
				c.summary,
				c.timezone,
				c.founderKey,
				now,
				now,
			);
			const insertNode = db.prepare(
				"INSERT INTO org_nodes (id, key, kind, name, ref_id, config, pos_x, pos_y, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			);
			for (const n of graph.nodes) {
				insertNode.run(
					n.id,
					n.key,
					n.kind,
					n.name,
					n.refId,
					JSON.stringify(n.config),
					n.position.x,
					n.position.y,
					now,
					now,
				);
			}
			const insertEdge = db.prepare(
				"INSERT INTO org_edges (id, from_node_id, to_node_id, relation, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?)",
			);
			for (const e of graph.edges) {
				insertEdge.run(
					e.id,
					e.fromNodeId,
					e.toNodeId,
					e.relation,
					e.validFrom,
					e.validTo,
				);
			}
		},
	};
}

function toNode(row: Row): StoredNode {
	return {
		id: String(row.id),
		key: String(row.key),
		kind: row.kind as OrgNodeKind,
		name: String(row.name),
		refId: (row.ref_id as string | null) ?? null,
		config: json(row.config),
		position: { x: Number(row.pos_x), y: Number(row.pos_y) },
	};
}

function toEdge(row: Row): StoredEdge {
	return {
		id: String(row.id),
		fromNodeId: String(row.from_node_id),
		toNodeId: String(row.to_node_id),
		relation: row.relation as OrgEdgeRelation,
		validFrom: String(row.valid_from),
		validTo: (row.valid_to as string | null) ?? null,
	};
}
