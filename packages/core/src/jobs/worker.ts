import type { CompanyStore, Job } from "@jamot/ports";

/**
 * Runs background jobs from the jobs table: claims what's due, runs its
 * handler, completes it, or schedules a retry with backoff. Jobs survive
 * restarts because they live in the database, not in this loop.
 */

export type JobHandler = (job: Job) => Promise<void>;

export interface WorkerOptions {
	/** How long a claimed job is ours before another tick may take it back. */
	leaseMs?: number;
	/** Jobs per tick. */
	batch?: number;
	/** Delay before retry `attempt` (1-based). Default: 10 s, 40 s, 90 s … capped at 10 min. */
	backoffMs?: (attempt: number) => number;
	/** Where failures are reported. Default: console.error. */
	log?: (message: string) => void;
}

export interface Worker {
	/** One pass: claim due jobs and run them. Returns how many ran. */
	tick(now?: Date): Promise<number>;
	start(everyMs?: number): void;
	stop(): Promise<void>;
}

export function createWorker(
	store: CompanyStore,
	handlers: Record<string, JobHandler>,
	opts: WorkerOptions = {},
): Worker {
	const leaseMs = opts.leaseMs ?? 5 * 60_000;
	const backoff =
		opts.backoffMs ?? ((n) => Math.min(10 * 60_000, 10_000 * n * n));
	const log = opts.log ?? ((m) => console.error(m));
	let timer: NodeJS.Timeout | null = null;
	let running: Promise<number> | null = null;

	async function tick(now = new Date()): Promise<number> {
		const jobs = await store.jobs.claimDue({
			now: now.toISOString(),
			leaseMs,
			limit: opts.batch ?? 10,
		});
		await Promise.all(
			jobs.map(async (job) => {
				const handler = handlers[job.kind];
				try {
					if (!handler)
						throw new Error(`no handler for job kind "${job.kind}"`);
					await handler(job);
					await store.jobs.complete(job.id);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					const retryAt = new Date(
						now.getTime() + backoff(job.attempts),
					).toISOString();
					const after = await store.jobs.fail(job.id, message, retryAt);
					log(
						`[jobs] ${job.kind} ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts}): ${message}${after.status === "dead" ? " — giving up" : ""}`,
					);
				}
			}),
		);
		return jobs.length;
	}

	return {
		tick,
		start(everyMs = 1000) {
			if (timer) return;
			timer = setInterval(() => {
				// Never two passes at once: a slow pass just delays the next one.
				if (running) return;
				running = tick().finally(() => {
					running = null;
				});
			}, everyMs);
		},
		async stop() {
			if (timer) clearInterval(timer);
			timer = null;
			await running;
		},
	};
}
