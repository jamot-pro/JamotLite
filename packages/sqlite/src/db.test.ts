import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS, migrate, openCompanyDb } from "./index.js";

const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("company database", () => {
	it("applies every migration once, and nothing on the next boot", () => {
		const dir = mkdtempSync(join(tmpdir(), "jamot-db-"));
		dirs.push(dir);
		const first = openCompanyDb(join(dir, "company.db"));
		const applied = first
			.prepare("SELECT id FROM schema_migrations ORDER BY id")
			.all() as { id: string }[];
		expect(applied.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id));
		first.close();

		const again = openCompanyDb(join(dir, "company.db"));
		expect(migrate(again)).toEqual([]);
		expect(statSync(join(dir, "company.db")).mode & 0o777).toBe(0o600);
		expect(
			(again.prepare("PRAGMA journal_mode").get() as { journal_mode: string })
				.journal_mode,
		).toBe("wal");
		again.close();
	});

	it("refuses rows the schema doesn't allow", () => {
		const db = openCompanyDb(":memory:");
		const now = new Date().toISOString();
		expect(() =>
			db
				.prepare(
					"INSERT INTO org_nodes (id, key, kind, name, created_at, updated_at) VALUES ('a', 'a', 'robot', 'R', ?, ?)",
				)
				.run(now, now),
		).toThrow(/CHECK/);
		expect(() =>
			db
				.prepare(
					"INSERT INTO org_edges (id, from_node_id, to_node_id, relation, valid_from) VALUES ('e', 'x', 'y', 'owns', ?)",
				)
				.run(now),
		).toThrow(/FOREIGN KEY/);
	});

	it("opens conversations to the web without losing a Telegram message", () => {
		// A company from before 0005: Telegram only, with a conversation and a message.
		const db = new DatabaseSync(":memory:");
		db.exec("PRAGMA foreign_keys = ON");
		db.exec(
			"CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
		);
		const now = new Date().toISOString();
		for (const m of MIGRATIONS.filter((m) => m.id < "0005")) {
			db.exec(m.sql);
			db.prepare("INSERT INTO schema_migrations VALUES (?, ?)").run(m.id, now);
		}
		db.prepare(
			"INSERT INTO conversations (id, channel, external_thread_id, created_at) VALUES ('c1', 'telegram', '100', ?)",
		).run(now);
		db.prepare(
			"INSERT INTO messages (id, conversation_id, direction, status, text, created_at) VALUES ('m1', 'c1', 'in', 'received', 'hello', ?)",
		).run(now);

		expect(migrate(db)).toEqual(["0005_web_channel", "0006_tasks"]);
		expect(db.prepare("SELECT text FROM messages").all()).toEqual([
			{ text: "hello" },
		]);
		db.prepare(
			"INSERT INTO conversations (id, channel, external_thread_id, created_at) VALUES ('c2', 'web', 'v1', ?)",
		).run(now);
		// The message still belongs to its conversation, and foreign keys are back on.
		expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({
			foreign_keys: 1,
		});
		db.exec("DELETE FROM conversations WHERE id = 'c1'");
		expect(db.prepare("SELECT count(*) AS n FROM messages").get()).toEqual({
			n: 0,
		});
		db.close();
	});
});
