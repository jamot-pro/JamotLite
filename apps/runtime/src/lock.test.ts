import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireRunLock } from "./lock.js";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "jamot-lock-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const lockAs = (pid: number, host = hostname()) =>
	writeFileSync(
		join(dir, "runtime.lock"),
		JSON.stringify({ pid, host, startedAt: "2026-10-03T07:00:00.000Z" }),
	);

describe("one running company per folder", () => {
	it("refuses a second start on the same folder, and allows it after a stop", () => {
		const release = acquireRunLock(dir);
		expect(
			JSON.parse(readFileSync(join(dir, "runtime.lock"), "utf8")).pid,
		).toBe(process.pid);
		expect(() => acquireRunLock(dir)).toThrow(/already running/);
		release();
		acquireRunLock(dir)();
	});

	it("names the process that holds it", () => {
		// The parent of this test process is alive and isn't us.
		lockAs(process.ppid);
		expect(() => acquireRunLock(dir)).toThrow(
			new RegExp(`process ${process.ppid}, since 2026-10-03`),
		);
	});

	it("takes over a lock its process left behind", () => {
		lockAs(2 ** 22 + 12_345); // no such process
		acquireRunLock(dir)();
		// From another host: a past instance on the same disk (Render, a volume).
		lockAs(process.ppid, "an-old-container");
		acquireRunLock(dir)();
		// With our own pid: a restarted container where we're process 1 again.
		lockAs(process.pid);
		acquireRunLock(dir)();
		// Half-written by a process that died mid-start.
		writeFileSync(join(dir, "runtime.lock"), "{");
		acquireRunLock(dir)();
	});
});
