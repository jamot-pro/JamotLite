import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** What a company database holds, read-only — for checking a backup before a restore. */
export interface DatabaseSummary {
	company: string | null;
	people: number;
	memories: number;
	lastMessageAt: string | null;
}

export function inspectCompanyDb(file: string): DatabaseSummary {
	if (!existsSync(file)) throw new Error(`no database at ${file}`);
	const db = new DatabaseSync(file, { readOnly: true });
	try {
		const check = db.prepare("PRAGMA quick_check").get() as {
			quick_check: string;
		};
		if (check.quick_check !== "ok")
			throw new Error(`${file} is damaged: ${check.quick_check}`);
		const count = (table: "people" | "memories") =>
			(db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number })
				.n;
		const company = db.prepare("SELECT name FROM company").get() as
			| { name: string }
			| undefined;
		const last = db
			.prepare("SELECT max(created_at) AS at FROM messages")
			.get() as { at: string | null };
		return {
			company: company?.name ?? null,
			people: count("people"),
			memories: count("memories"),
			lastMessageAt: last.at,
		};
	} catch (err) {
		if (err instanceof Error && /no such table/.test(err.message))
			throw new Error(`${file} isn't a Jamot company database`);
		throw err;
	} finally {
		db.close();
	}
}
