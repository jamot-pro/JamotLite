import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	renameSync,
	rmSync,
} from "node:fs";
import { join } from "node:path";
import type { CompanyStore } from "@jamot/ports";
import { type DatabaseSummary, inspectCompanyDb } from "@jamot/sqlite";

/**
 * Backups on by default (BLUEPRINT S4, RUNTIME D37). The runtime takes a
 * consistent snapshot of `company.db` once a day into `<dataDir>/backups`
 * and keeps the last few. `secrets.key` is never copied next to them: a
 * snapshot without the key holds no readable secret.
 *
 * A restore is staged, not done in place: `jamot restore` checks the file
 * and leaves it as `restore.db`, and the next start swaps it in before the
 * database is opened — so it works from a shell beside a running company.
 */

export const LAST_BACKUP_SETTING = "runtime.lastBackupAt";
export const BACKUP_EVERY_MS = 24 * 3_600_000;
export const BACKUPS_KEPT = 7;
const PENDING_RESTORE = "restore.db";

export const backupsDir = (dataDir: string) => join(dataDir, "backups");
const stamp = (at: Date) => at.toISOString().replace(/[:.]/g, "-");

/** A snapshot into `backups/`; then only the newest `keep` stay. */
export async function takeBackup(
	store: CompanyStore,
	dataDir: string,
	opts: { to?: string; keep?: number; now?: Date } = {},
): Promise<string> {
	const now = opts.now ?? new Date();
	mkdirSync(backupsDir(dataDir), { recursive: true, mode: 0o700 });
	const target =
		opts.to ?? join(backupsDir(dataDir), `company-${stamp(now)}.db`);
	await store.backup(target);
	chmodSync(target, 0o600);
	await store.settings.set(LAST_BACKUP_SETTING, now.toISOString());
	if (!opts.to)
		for (const old of listBackups(dataDir).slice(opts.keep ?? BACKUPS_KEPT))
			rmSync(old);
	return target;
}

/** The daily snapshots in `backups/`, newest first (their names sort by time). */
export function listBackups(dataDir: string): string[] {
	const dir = backupsDir(dataDir);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => /^company-.+\.db$/.test(f))
		.sort()
		.reverse()
		.map((f) => join(dir, f));
}

/** Takes the daily snapshot when the last one is a day old, or there's none. */
export async function backupIfDue(
	store: CompanyStore,
	dataDir: string,
	now = new Date(),
): Promise<string | null> {
	const last = await store.settings.get<string>(LAST_BACKUP_SETTING);
	if (last && now.getTime() - Date.parse(last) < BACKUP_EVERY_MS) return null;
	return takeBackup(store, dataDir, { now });
}

/** Checks the snapshot and leaves it for the next start to swap in. */
export function stageRestore(dataDir: string, file: string): DatabaseSummary {
	const summary = inspectCompanyDb(file);
	const pending = join(dataDir, PENDING_RESTORE);
	copyFileSync(file, pending);
	chmodSync(pending, 0o600);
	return summary;
}

/**
 * Runs before the database is opened. The company as it was goes into
 * `backups/` first, so a restore can itself be undone.
 */
export function applyPendingRestore(
	dataDir: string,
	now = new Date(),
): string | null {
	const pending = join(dataDir, PENDING_RESTORE);
	if (!existsSync(pending)) return null;
	const current = join(dataDir, "company.db");
	let before: string | null = null;
	if (existsSync(current)) {
		mkdirSync(backupsDir(dataDir), { recursive: true, mode: 0o700 });
		before = join(backupsDir(dataDir), `before-restore-${stamp(now)}.db`);
		renameSync(current, before);
		// The write-ahead log belongs to the database we just set aside.
		for (const side of ["-wal", "-shm"])
			if (existsSync(current + side)) renameSync(current + side, before + side);
	}
	renameSync(pending, current);
	return before;
}
