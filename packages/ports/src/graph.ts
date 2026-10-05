import type {
	DreamConfig,
	OrgEdgeRelation,
	OrgNodeKind,
} from "@jamot/contracts";

/**
 * Graph storage — the company, its Dream and its org graph.
 *
 * Every port is async so a Postgres adapter can implement it later (Pro).
 * Domain code talks to ports only, never to SQLite (AGENTS.md rule 4).
 */

export interface CompanyRecord {
	id: string;
	name: string;
	summary: string;
	timezone: string;
	/** Key of the human node the company's creator became, if any. */
	founderKey: string | null;
}

export interface StoredNode {
	id: string;
	/** Stable key from the company file; "dream" for the Dream node. */
	key: string;
	kind: OrgNodeKind;
	name: string;
	/** The person, agent or tool record this node stands for, once linked. */
	refId: string | null;
	config: Record<string, unknown>;
	position: { x: number; y: number };
}

export interface StoredEdge {
	id: string;
	fromNodeId: string;
	toNodeId: string;
	relation: OrgEdgeRelation;
	validFrom: string;
	/** Set when the edge ended (someone stopped owning a responsibility). History is kept. */
	validTo: string | null;
}

/** Everything `importGraph` writes, in one go. */
export interface GraphImport {
	company: CompanyRecord;
	dream: DreamConfig;
	nodes: StoredNode[];
	edges: StoredEdge[];
}

export interface GraphStore {
	getCompany(): Promise<CompanyRecord | null>;
	/** Nodes in the order they were created, the Dream node first. */
	listNodes(): Promise<StoredNode[]>;
	/** Current edges only, unless `includeEnded` asks for history too. */
	listEdges(opts?: { includeEnded?: boolean }): Promise<StoredEdge[]>;
	/** Writes a whole company atomically. Refuses a store that already holds one. */
	importGraph(graph: GraphImport): Promise<void>;
	/** Adds an edge between two existing nodes, from now. */
	addEdge(input: {
		fromNodeId: string;
		toNodeId: string;
		relation: OrgEdgeRelation;
	}): Promise<StoredEdge>;
	/** Ends an edge (sets `validTo`), keeping it as history. */
	endEdge(edgeId: string): Promise<boolean>;
	/** Adds one node to the map. Its key must be new. */
	addNode(input: {
		key: string;
		kind: OrgNodeKind;
		name: string;
		config?: Record<string, unknown>;
	}): Promise<StoredNode>;
	/** Renames a node and/or replaces its config. Null when there's no such node. */
	updateNode(
		nodeId: string,
		change: { name?: string; config?: Record<string, unknown> },
	): Promise<StoredNode | null>;
}
