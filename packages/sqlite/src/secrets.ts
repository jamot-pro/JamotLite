import type { DatabaseSync } from "node:sqlite";
import type { SecretStore } from "@jamot/ports";
import { all, nowIso, one, run, type Sync } from "./sync.js";

export function secretOps(db: DatabaseSync): Sync<SecretStore> {
	return {
		put(ref, ciphertext) {
			run(
				db,
				"INSERT INTO secrets (ref, ciphertext, updated_at) VALUES (?, ?, ?) ON CONFLICT (ref) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at",
				ref,
				ciphertext,
				nowIso(),
			);
		},
		get(ref) {
			const row = one(db, "SELECT ciphertext FROM secrets WHERE ref = ?", ref);
			return row ? String(row.ciphertext) : null;
		},
		delete(ref) {
			return run(db, "DELETE FROM secrets WHERE ref = ?", ref) > 0;
		},
		list() {
			return all(db, "SELECT ref FROM secrets ORDER BY ref").map((r) =>
				String(r.ref),
			);
		},
	};
}
