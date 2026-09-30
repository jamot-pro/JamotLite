import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "./migrations.js";

/**
 * Opens a company database (`company.db`, or ":memory:" in tests) and brings
 * its schema up to date. Uses Node's built-in `node:sqlite`, so there is no
 * native module to build.
 */
export function openCompanyDb(path: string): DatabaseSync {
	const db = new DatabaseSync(path);
	db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
	if (path !== ":memory:") {
		// Customer data: readable by the owner only. SQLite gives its -wal and
		// -shm files the database file's permissions.
		chmodSync(path, 0o600);
		db.exec("PRAGMA journal_mode = WAL;");
	}
	migrate(db);
	return db;
}

export function migrate(db: DatabaseSync): string[] {
	db.exec(
		"CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
	);
	const done = new Set(
		(
			db.prepare("SELECT id FROM schema_migrations").all() as { id: string }[]
		).map((r) => r.id),
	);
	const applied: string[] = [];
	for (const m of MIGRATIONS) {
		if (done.has(m.id)) continue;
		inTransaction(db, () => {
			db.exec(m.sql);
			db.prepare(
				"INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
			).run(m.id, new Date().toISOString());
		});
		applied.push(m.id);
	}
	return applied;
}

/** Runs synchronous work in one transaction. Callers must not await inside it. */
export function inTransaction<T>(db: DatabaseSync, work: () => T): T {
	db.exec("BEGIN IMMEDIATE");
	try {
		const result = work();
		db.exec("COMMIT");
		return result;
	} catch (err) {
		db.exec("ROLLBACK");
		throw err;
	}
}
