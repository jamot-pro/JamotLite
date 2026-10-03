import {
	closeSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

/**
 * One running company per folder (BLUEPRINT S7, RUNTIME D42). `jamot start`
 * takes `runtime.lock` in the company's folder before anything else and
 * keeps it fresh with a heartbeat; a second start is refused with a sentence
 * saying which process holds it. Short commands beside a running company —
 * `jamot backup`, `restore`, `webchat` — don't take it.
 *
 * When is a lock left behind, so it can be taken over?
 * - On this machine: when its process is gone, or carries our own pid (a
 *   restarted container where the runtime is process 1 again).
 * - From another machine (two containers on one volume, a past Render
 *   instance): process ids mean nothing here, so only when its heartbeat has
 *   stopped for `staleMs`. A start waits that long before giving up, so the
 *   instance that replaces a crashed one still comes up on its own.
 */

const LOCK_FILE = "runtime.lock";
export const LOCK_BEAT_MS = 10_000;
export const LOCK_STALE_MS = 30_000;

/** Folders this process runs right now (a pid can't tell them apart). */
const heldHere = new Set<string>();

interface LockInfo {
	pid: number;
	host: string;
	startedAt: string;
	beatAt: string;
}

export interface RunLock {
	/** Keeps the lock fresh; the runtime calls it every LOCK_BEAT_MS. */
	beat(now?: Date): void;
	/** Gives it up — only if it's still ours. */
	release(): void;
}

const alive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		// EPERM: it exists, it's just not ours to signal.
		return (err as NodeJS.ErrnoException).code === "EPERM";
	}
};

const read = (path: string): LockInfo | null => {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as LockInfo;
	} catch {
		return null; // gone, or half-written by a process that died mid-start
	}
};

const same = (a: LockInfo | null, b: LockInfo) =>
	a?.pid === b.pid && a.host === b.host && a.startedAt === b.startedAt;

/** Who holds the folder, as a sentence; null when the lock was left behind. */
function holder(
	held: LockInfo | null,
	path: string,
	staleMs: number,
	now: Date,
): string | null {
	if (!held) return null;
	if (held.host === hostname()) {
		if (held.pid === process.pid && !heldHere.has(path)) return null;
		return alive(held.pid)
			? `this company is already running (process ${held.pid}, since ${held.startedAt}) — stop it first, or pick another company with --company`
			: null;
	}
	const beat = Date.parse(held.beatAt ?? held.startedAt);
	return now.getTime() - beat < staleMs
		? `this company is running on ${held.host} (process ${held.pid}, last seen ${held.beatAt}) — one company runs in one place`
		: null;
}

/**
 * Takes the folder's lock, or throws saying who has it. A lock from another
 * machine may still be fresh; it's checked again until `waitMs` has passed.
 */
export async function acquireRunLock(
	dataDir: string,
	opts: { waitMs?: number; staleMs?: number; now?: () => Date } = {},
): Promise<RunLock> {
	const path = join(dataDir, LOCK_FILE);
	const now = opts.now ?? (() => new Date());
	const staleMs = opts.staleMs ?? LOCK_STALE_MS;
	if (heldHere.has(path))
		throw new Error(
			"this company is already running in this process — stop it first",
		);
	const started = now();
	const mine: LockInfo = {
		pid: process.pid,
		host: hostname(),
		startedAt: started.toISOString(),
		beatAt: started.toISOString(),
	};
	const deadline = started.getTime() + (opts.waitMs ?? 0);
	for (;;) {
		try {
			const fd = openSync(path, "wx", 0o600); // fails if it exists
			writeSync(fd, JSON.stringify(mine));
			closeSync(fd);
			heldHere.add(path);
			return {
				beat(at = now()) {
					if (!same(read(path), mine)) return; // not ours any more
					mine.beatAt = at.toISOString();
					writeFileSync(path, JSON.stringify(mine), { mode: 0o600 });
				},
				release() {
					heldHere.delete(path);
					if (same(read(path), mine)) rmSync(path, { force: true });
				},
			};
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
		}
		const held = read(path);
		const who = holder(held, path, staleMs, now());
		if (!who) {
			// Left behind: remove that one (not one another start just wrote).
			if (!held || same(read(path), held)) rmSync(path, { force: true });
			continue;
		}
		// A live process here is certain; only another machine's lock may still
		// go quiet, so only that one is worth waiting for.
		if (held?.host === hostname() || now().getTime() >= deadline)
			throw new Error(who);
		await new Promise((r) => setTimeout(r, 1_000));
	}
}
