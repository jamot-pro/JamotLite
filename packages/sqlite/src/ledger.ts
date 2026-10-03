import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { LedgerEntry, LedgerStore } from "@jamot/ports";
import { all, nowIso, one, type Row, run, type Sync } from "./sync.js";

const COLUMNS =
	"id, currency, amount_minor, description, ref, occurred_at, created_at";

export function ledgerOps(db: DatabaseSync): Sync<LedgerStore> {
	return {
		post(entries) {
			// Validate everything first, so a bad entry never leaves half a posting.
			for (const e of entries) {
				if (!Number.isSafeInteger(e.amountMinor)) {
					throw new Error(
						`amountMinor must be a whole number of minor units, got ${e.amountMinor}`,
					);
				}
				if (!/^[A-Z]{3}$/.test(e.currency))
					throw new Error(
						`currency must be an ISO 4217 code, got "${e.currency}"`,
					);
			}
			const now = nowIso();
			const ids = entries.map((e) => {
				const id = randomUUID();
				run(
					db,
					"INSERT INTO ledger_entries (id, currency, amount_minor, description, ref, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
					id,
					e.currency,
					e.amountMinor,
					e.description,
					e.ref ?? null,
					e.occurredAt ?? now,
					now,
				);
				return id;
			});
			return ids.map((id) =>
				toEntry(
					one(
						db,
						`SELECT ${COLUMNS} FROM ledger_entries WHERE id = ?`,
						id,
					) as Row,
				),
			);
		},

		balance(currency) {
			const row = one<{ total: number | null }>(
				db,
				"SELECT sum(amount_minor) AS total FROM ledger_entries WHERE currency = ?",
				currency,
			);
			return Number(row?.total ?? 0);
		},

		flow(currency, since) {
			const row = one(
				db,
				`SELECT coalesce(sum(CASE WHEN amount_minor > 0 THEN amount_minor END), 0) AS i,
				 coalesce(-sum(CASE WHEN amount_minor < 0 THEN amount_minor END), 0) AS o, count(*) AS n
				 FROM ledger_entries WHERE currency = ? AND occurred_at >= ?`,
				currency,
				since,
			) as Row;
			return { in: Number(row.i), out: Number(row.o), entries: Number(row.n) };
		},

		currencies() {
			return all(
				db,
				"SELECT currency FROM ledger_entries GROUP BY currency ORDER BY count(*) DESC, currency",
			).map((r) => String(r.currency));
		},

		list(filter = {}) {
			const rows = filter.currency
				? all(
						db,
						`SELECT ${COLUMNS} FROM ledger_entries WHERE currency = ? ORDER BY seq DESC LIMIT ?`,
						filter.currency,
						filter.limit ?? 100,
					)
				: all(
						db,
						`SELECT ${COLUMNS} FROM ledger_entries ORDER BY seq DESC LIMIT ?`,
						filter.limit ?? 100,
					);
			return rows.map(toEntry);
		},
	};
}

function toEntry(row: Row): LedgerEntry {
	return {
		id: String(row.id),
		currency: String(row.currency),
		amountMinor: Number(row.amount_minor),
		description: String(row.description),
		ref: (row.ref as string | null) ?? null,
		occurredAt: String(row.occurred_at),
		createdAt: String(row.created_at),
	};
}
