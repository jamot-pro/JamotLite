import type { ApprovalStore, RunStore, TranscriptStore } from "./brain.js";
import type { ConversationStore } from "./conversations.js";
import type { EventStore } from "./events.js";
import type { GraphStore } from "./graph.js";
import type { JobStore } from "./jobs.js";
import type { LedgerStore } from "./ledger.js";
import type { MemoryStore } from "./memory.js";
import type { PeopleStore } from "./people.js";
import type { SecretStore } from "./secrets.js";
import type { SettingsStore } from "./settings.js";
import type { TaskStore } from "./tasks.js";

/** Every port of one company's storage. */
export interface CompanyPorts {
	graph: GraphStore;
	settings: SettingsStore;
	people: PeopleStore;
	conversations: ConversationStore;
	memory: MemoryStore;
	events: EventStore;
	jobs: JobStore;
	ledger: LedgerStore;
	runs: RunStore;
	transcripts: TranscriptStore;
	approvals: ApprovalStore;
	secrets: SecretStore;
	tasks: TaskStore;
}

/**
 * A company's storage. Every single call is atomic on its own. Work that
 * spans ports — a message arrives: person, conversation, message, memory,
 * event — goes in `transaction`, using the ports it is given (not the outer
 * ones, which wait until the transaction ends).
 */
export interface CompanyStore extends CompanyPorts {
	transaction<T>(work: (tx: CompanyPorts) => Promise<T>): Promise<T>;
	/** A consistent copy of all the company's data, taken while it keeps running —
	 *  what `jamot export` and `jamot backup` write next to `company.yaml`. */
	backup(destination: string): Promise<void>;
	close(): void;
}
