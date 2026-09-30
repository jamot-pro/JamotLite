import type { CompanyStore } from "@jamot/ports";
import { Cron } from "croner";

export const HEARTBEAT_JOB = "heartbeat.run";
const PLANNED = "heartbeats.planned";

/**
 * Turns heartbeat schedules into jobs, in the company's time zone. Each due
 * run becomes one job keyed by heartbeat and minute, so planning twice never
 * runs a heartbeat twice. After downtime only the latest missed run is queued —
 * a heartbeat that missed three mornings checks once, now.
 */
export async function planHeartbeats(
	store: CompanyStore,
	now = new Date(),
): Promise<number> {
	const company = await store.graph.getCompany();
	if (!company) return 0;
	const planned =
		(await store.settings.get<Record<string, string>>(PLANNED)) ?? {};
	let queued = 0;

	for (const node of await store.graph.listNodes()) {
		if (node.kind !== "heartbeat" || node.config.enabled === false) continue;
		const schedule =
			typeof node.config.schedule === "string" ? node.config.schedule : null;
		if (!schedule) continue;

		let cron: Cron;
		try {
			cron = new Cron(schedule, { timezone: company.timezone, paused: true });
		} catch (err) {
			await store.events.append({
				type: "heartbeat.invalid",
				source: `heartbeat/${node.key}`,
				subject: node.key,
				data: {
					schedule,
					error: err instanceof Error ? err.message : String(err),
				},
				idempotencyKey: `heartbeat-invalid:${node.key}:${schedule}`,
			});
			continue;
		}

		// From the last planned run — or a minute ago on first sight, so a
		// heartbeat due this very minute still runs.
		let cursor = new Date(planned[node.key] ?? now.getTime() - 60_000);
		let due: Date | null = null;
		for (let i = 0; i < 100_000; i++) {
			const next = cron.nextRun(cursor);
			if (!next || next > now) break;
			due = next;
			cursor = next;
		}
		if (!due) continue;

		const { created } = await store.jobs.enqueue({
			kind: HEARTBEAT_JOB,
			key: `hb:${node.key}:${due.toISOString()}`,
			payload: { heartbeat: node.key, scheduledFor: due.toISOString() },
			runAt: due.toISOString(),
			maxAttempts: 3,
		});
		if (created) queued++;
		planned[node.key] = due.toISOString();
	}
	await store.settings.set(PLANNED, planned);
	return queued;
}
