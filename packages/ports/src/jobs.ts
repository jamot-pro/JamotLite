/**
 * Jobs — durable background work: heartbeat runs, agent runs, sending
 * messages, retries. A claimed job holds a lease; if the process dies, the
 * lease runs out and the job is claimed again, so nothing is lost on restart.
 */

export type JobStatus = "queued" | "running" | "done" | "dead";

export interface Job {
	id: string;
	kind: string;
	/** Deduplication key: enqueueing the same key twice creates one job. */
	key: string | null;
	payload: Record<string, unknown>;
	status: JobStatus;
	runAt: string;
	/** Counted when a job is claimed. */
	attempts: number;
	maxAttempts: number;
	lastError: string | null;
	lockedUntil: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface NewJob {
	kind: string;
	payload?: Record<string, unknown>;
	runAt?: string;
	key?: string | null;
	maxAttempts?: number;
}

export interface JobStore {
	enqueue(input: NewJob): Promise<{ job: Job; created: boolean }>;
	/** Claims queued jobs that are due, and running jobs whose lease ran out. */
	claimDue(input: {
		now: string;
		leaseMs: number;
		limit?: number;
	}): Promise<Job[]>;
	complete(jobId: string): Promise<void>;
	/** Records a failure. Queued again at `retryAt`, or `dead` once attempts are used up. */
	fail(jobId: string, error: string, retryAt: string): Promise<Job>;
	get(jobId: string): Promise<Job | null>;
	list(filter?: {
		status?: JobStatus;
		kind?: string;
		limit?: number;
	}): Promise<Job[]>;
}
