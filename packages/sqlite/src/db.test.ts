import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
});
