import type { DatabaseSync } from "node:sqlite";
import type { SettingsStore } from "@jamot/ports";
import { nowIso, one, run, type Sync } from "./sync.js";

export function settingsOps(db: DatabaseSync): Sync<SettingsStore> {
	return {
		get<T>(key: string) {
			const row = one(db, "SELECT value FROM settings WHERE key = ?", key);
			return row ? (JSON.parse(String(row.value)) as T) : null;
		},
		set(key, value) {
			run(
				db,
				"INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
				key,
				JSON.stringify(value ?? null),
				nowIso(),
			);
		},
		delete(key) {
			return run(db, "DELETE FROM settings WHERE key = ?", key) > 0;
		},
	} as Sync<SettingsStore>;
}
