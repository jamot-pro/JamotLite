/**
 * Memory — what the company knows. About a person ("gluten-free"), about the
 * company itself ("the flour supplier closes in August"), or an agent's own
 * notes. Searchable with full-text search.
 */

export type MemoryScope = "person" | "company" | "agent";

export interface Memory {
	id: string;
	scope: MemoryScope;
	/** The person id or agent key; null for company memory. */
	ownerId: string | null;
	/** What kind of memory: "interaction", "preference", "fact", "survival.tier" … */
	kind: string;
	/** The memory in plain words — this is what search looks at. */
	content: string;
	data: Record<string, unknown>;
	source: "conversation" | "agent" | "human" | "system" | "import";
	confidence: number;
	createdAt: string;
	updatedAt: string;
}

export interface NewMemory {
	scope: MemoryScope;
	ownerId?: string | null;
	kind: string;
	content: string;
	data?: Record<string, unknown>;
	source: Memory["source"];
	confidence?: number;
}

export interface MemoryFilter {
	scope?: MemoryScope;
	ownerId?: string | null;
	kind?: string;
	limit?: number;
}

export interface MemoryStore {
	store(input: NewMemory): Promise<Memory>;
	get(id: string): Promise<Memory | null>;
	/** Newest first. */
	list(filter?: MemoryFilter): Promise<Memory[]>;
	/** Best match first. Words match as prefixes: "glut" finds "gluten-free". */
	search(query: string, filter?: MemoryFilter): Promise<Memory[]>;
	update(
		id: string,
		patch: Partial<Pick<Memory, "content" | "data" | "confidence">>,
	): Promise<Memory | null>;
	forget(id: string): Promise<boolean>;
}
