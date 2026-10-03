import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

/**
 * One running company per folder (BLUEPRINT S7, RUNTIME D42). `jamot start`
 * takes `runtime.lock` in the company's folder before anything else; a
 * second start on the same folder is refused with a sentence saying which
 * process holds it. A lock left by a process that died (a crash, a killed
 * container), by another host (a past instance on the same disk) or with
 * our own pid (a restarted container) is taken over. Short commands beside
 * a running company — `jamot backup`, `restore`, `webchat` — don't take it.
 */

const LOCK_FILE = "runtime.lock";
/** Folders this process runs right now (a pid can't tell them apart). */
const heldHere = new Set<string>();

interface LockInfo {
	pid: number;
	host: string;
	startedAt: string;
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

/** Takes the folder's lock, or throws saying who has it. Returns the release. */
export function acquireRunLock(dataDir: string, now = new Date()): () => void {
	const path = join(dataDir, LOCK_FILE);
	const mine: LockInfo = {
		pid: process.pid,
		host: hostname(),
		startedAt: now.toISOString(),
	};
	if (heldHere.has(path))
		throw new Error(
			"this company is already running in this process — stop it first",
		);
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const fd = openSync(path, "wx", 0o600); // fails if it exists
			writeSync(fd, JSON.stringify(mine));
			closeSync(fd);
			heldHere.add(path);
			return () => {
				heldHere.delete(path);
				rmSync(path, { force: true });
			};
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
		}
		let held: LockInfo | null = null;
		try {
			held = JSON.parse(readFileSync(path, "utf8")) as LockInfo;
		} catch {
			// Unreadable: half-written by a process that died mid-start.
		}
		// Only a live process on this machine, other than this one, holds it.
		// Another host is a past container or instance on the same disk (its
		// process ids mean nothing here), and our own pid is a restarted
		// container where the runtime is process 1 again.
		if (
			held &&
			held.host === mine.host &&
			held.pid !== process.pid &&
			alive(held.pid)
		)
			throw new Error(
				`this company is already running (process ${held.pid}, since ${held.startedAt}) — stop it first, or pick another company with --company`,
			);
		rmSync(path, { force: true }); // stale: its process is gone
	}
	throw new Error(`couldn't take ${path}; is another start racing this one?`);
}
