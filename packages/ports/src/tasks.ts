/**
 * Tasks — work someone asked the company to do (RUNTIME D58). A task is the
 * record: what, for whom, who has it, where it stands. The jobs queue is what
 * moves it; a task lives for days and stays on the record when it's done.
 */

export type TaskStatus =
	/** Asked by someone who isn't the founder: waits for the founder's yes. */
	| "proposed"
	/** Accepted: waits for the selector to pick who does it. */
	| "open"
	/** An agent or a person has it. */
	| "working"
	/** A person says it's done: the founder confirms. */
	| "review"
	/** Waits for the founder: a question, a "can't", nobody to do it. */
	| "blocked"
	| "done"
	| "cancelled";

export type TaskRequesterKind = "founder" | "member" | "agent" | "customer";

export interface Task {
	id: string;
	/** Short, for people: "#12". */
	number: number;
	title: string;
	details: string | null;
	status: TaskStatus;
	/** The responsibility it belongs to, once the selector knows. */
	responsibilityKey: string | null;
	assigneeKind: "agent" | "human" | null;
	assigneeKey: string | null;
	requesterKind: TaskRequesterKind;
	/** A node key (founder, member, agent) or a person id (customer). */
	requesterKey: string | null;
	requesterName: string;
	/** What came of it, when done. */
	result: string | null;
	/** Why it waits: a question for the founder, a "can't". */
	note: string | null;
	dueAt: string | null;
	/** When the assignee was last reminded. */
	nudgedAt: string | null;
	createdAt: string;
	updatedAt: string;
	doneAt: string | null;
}

export interface NewTask {
	title: string;
	details?: string | null;
	status: "proposed" | "open";
	responsibilityKey?: string | null;
	requesterKind: TaskRequesterKind;
	requesterKey?: string | null;
	requesterName: string;
	dueAt?: string | null;
}

export type TaskPatch = Partial<
	Pick<
		Task,
		| "status"
		| "responsibilityKey"
		| "assigneeKind"
		| "assigneeKey"
		| "result"
		| "note"
		| "details"
		| "nudgedAt"
	>
>;

export interface TaskStore {
	create(input: NewTask): Promise<Task>;
	get(id: string): Promise<Task | null>;
	byNumber(number: number): Promise<Task | null>;
	/**
	 * Changes a task only while its status is one of `from` — two presses of
	 * the same button, or a button and a job, never both win. Null when it
	 * wasn't in `from` (or doesn't exist).
	 */
	update(
		id: string,
		from: TaskStatus[],
		patch: TaskPatch,
	): Promise<Task | null>;
	/** Newest first. */
	list(filter?: {
		status?: TaskStatus[];
		assigneeKey?: string;
		requesterKey?: string;
		limit?: number;
	}): Promise<Task[]>;
}
