import { randomUUID } from "node:crypto";
import type { CompanyFile } from "@jamot/contracts";
import type { GraphStore, StoredEdge, StoredNode } from "@jamot/ports";

export interface ImportOptions {
	/** The person starting the company. They become the file's founder node. */
	founder?: { refId: string; name: string };
	/** Clock for `validFrom`, so tests are deterministic. */
	now?: () => Date;
}

/**
 * Turns a company file into a running company's graph: the Dream node, every
 * node and every edge, written atomically. Refuses a database that already
 * holds a company, so an import never lands on top of someone's work.
 */
export async function importCompanyFile(
	store: GraphStore,
	file: CompanyFile,
	opts: ImportOptions = {},
): Promise<void> {
	const validFrom = (opts.now?.() ?? new Date()).toISOString();

	const dream: StoredNode = {
		id: randomUUID(),
		key: "dream",
		kind: "dream",
		name: file.company.name,
		refId: null,
		config: file.dream,
		position: { x: 0, y: 0 },
	};
	const nodes: StoredNode[] = [dream];
	const ids = new Map<string, string>([["dream", dream.id]]);

	file.nodes.forEach((n, i) => {
		const founder = n.key === file.founder ? opts.founder : undefined;
		const node: StoredNode = {
			id: randomUUID(),
			key: n.key,
			kind: n.kind,
			name: founder?.name ?? n.name,
			refId: founder?.refId ?? null,
			config: n.config,
			// A plain grid; people rearrange the canvas themselves.
			position: { x: (i % 6) * 220, y: 200 + Math.floor(i / 6) * 160 },
		};
		ids.set(n.key, node.id);
		nodes.push(node);
	});

	const edges: StoredEdge[] = file.edges.map((e) => {
		const fromNodeId = ids.get(e.from);
		const toNodeId = ids.get(e.to);
		// The company file schema already rejects unknown keys; this guards callers
		// that build a CompanyFile by hand.
		if (!fromNodeId || !toNodeId)
			throw new Error(`unknown node in link "${e.from} ${e.relation} ${e.to}"`);
		return {
			id: randomUUID(),
			fromNodeId,
			toNodeId,
			relation: e.relation,
			validFrom,
			validTo: null,
		};
	});

	await store.importGraph({
		company: {
			id: file.company.id,
			name: file.company.name,
			summary: file.company.summary,
			timezone: file.company.timezone,
			founderKey: file.founder ?? null,
		},
		dream: file.dream,
		nodes,
		edges,
	});
}
