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

const at = (iso: string) => () => new Date(iso);
const file = () => join(dir, "runtime.lock");
const lockAs = (
	pid: number,
	host = hostname(),
	beatAt = "2026-10-03T07:00:00.000Z",
) =>
	writeFileSync(
		file(),
		JSON.stringify({
			pid,
			host,
			startedAt: "2026-10-03T07:00:00.000Z",
			beatAt,
		}),
	);
const held = () => JSON.parse(readFileSync(file(), "utf8"));

describe("one running company per folder", () => {
	it("refuses a second start on the same folder, and allows it after a stop", async () => {
		const lock = await acquireRunLock(dir);
		expect(held().pid).toBe(process.pid);
		await expect(acquireRunLock(dir)).rejects.toThrow(/already running/);
		lock.release();
		(await acquireRunLock(dir)).release();
	});

	it("names a live process on this machine, at once", async () => {
		lockAs(process.ppid); // the test runner's parent: alive, and not us
		const t = Date.now();
		await expect(acquireRunLock(dir, { waitMs: 60_000 })).rejects.toThrow(
			new RegExp(`process ${process.ppid}, since 2026-10-03`),
		);
		expect(Date.now() - t).toBeLessThan(2_000); // no waiting for a certainty
	});

	it("takes over a lock its process left behind on this machine", async () => {
		lockAs(2 ** 22 + 12_345); // no such process
		(await acquireRunLock(dir)).release();
		lockAs(process.pid); // our own pid: a restarted container, process 1 again
		(await acquireRunLock(dir)).release();
		writeFileSync(file(), "{"); // half-written by a process that died mid-start
		(await acquireRunLock(dir)).release();
	});

	it("refuses another machine's lock while its heartbeat is fresh, takes it once quiet", async () => {
		lockAs(1, "another-container", "2026-10-03T07:00:00.000Z");
		await expect(
			acquireRunLock(dir, { now: at("2026-10-03T07:00:20.000Z") }),
		).rejects.toThrow(/running on another-container .* last seen/);
		const lock = await acquireRunLock(dir, {
			now: at("2026-10-03T07:00:31.000Z"),
		});
		expect(held().host).toBe(hostname());
		lock.release();
	});

	it("keeps its heartbeat fresh, and never removes a lock that isn't its own", async () => {
		const lock = await acquireRunLock(dir, {
			now: at("2026-10-03T07:00:00.000Z"),
		});
		lock.beat(new Date("2026-10-03T07:00:10.000Z"));
		expect(held().beatAt).toBe("2026-10-03T07:00:10.000Z");
		// Someone else's lock now sits there: our beat and release leave it alone.
		lockAs(1, "another-container", "2026-10-03T07:00:15.000Z");
		lock.beat(new Date("2026-10-03T07:00:20.000Z"));
		lock.release();
		expect(held().host).toBe("another-container");
	});
});
