import type { CompanyStore } from "@jamot/ports";
import { openCompanyStore } from "@jamot/sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorker } from "./worker.js";

let store: CompanyStore;
beforeEach(() => {
	store = openCompanyStore(":memory:");
});
afterEach(() => store.close());

const t0 = new Date("2026-10-01T08:00:00Z");
const later = (s: number) => new Date(t0.getTime() + s * 1000);

describe("job worker", () => {
	it("runs due jobs and completes them", async () => {
		const done: string[] = [];
		const worker = createWorker(store, {
			hello: async (job) => void done.push(String(job.payload.name)),
		});
		await store.jobs.enqueue({
			kind: "hello",
			payload: { name: "Lucia" },
			runAt: t0.toISOString(),
		});
		expect(await worker.tick(t0)).toBe(1);
		expect(done).toEqual(["Lucia"]);
		expect((await store.jobs.list())[0]?.status).toBe("done");
	});

	it("retries with backoff, then gives up", async () => {
		const logs: string[] = [];
		let attempts = 0;
		const worker = createWorker(
			store,
			{
				flaky: async () => {
					attempts++;
					throw new Error("429 rate limited");
				},
			},
			{ backoffMs: () => 30_000, log: (m) => logs.push(m) },
		);
		await store.jobs.enqueue({
			kind: "flaky",
			runAt: t0.toISOString(),
			maxAttempts: 2,
		});
		await worker.tick(t0);
		expect(await worker.tick(later(10))).toBe(0);
		await worker.tick(later(30));
		expect(attempts).toBe(2);
		expect((await store.jobs.list())[0]).toMatchObject({
			status: "dead",
			lastError: "429 rate limited",
		});
		expect(logs.at(-1)).toMatch(/giving up/);
	});

	it("fails jobs nobody handles instead of losing them", async () => {
		const logs: string[] = [];
		const worker = createWorker(store, {}, { log: (m) => logs.push(m) });
		await store.jobs.enqueue({
			kind: "mystery",
			runAt: t0.toISOString(),
			maxAttempts: 1,
		});
		await worker.tick(t0);
		expect((await store.jobs.list())[0]).toMatchObject({
			status: "dead",
			lastError: 'no handler for job kind "mystery"',
		});
	});
});
