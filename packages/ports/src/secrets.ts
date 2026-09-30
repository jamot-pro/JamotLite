/**
 * Secret storage — ciphertext only. Encryption happens before a secret reaches
 * the store (core's secret box, keyed by `secrets.key`), so the database,
 * backups and exports never hold a secret in the clear (AGENTS.md rule 5).
 */
export interface SecretStore {
	put(ref: string, ciphertext: string): Promise<void>;
	get(ref: string): Promise<string | null>;
	delete(ref: string): Promise<boolean>;
	/** Refs only, never values: what is configured. */
	list(): Promise<string[]>;
}
