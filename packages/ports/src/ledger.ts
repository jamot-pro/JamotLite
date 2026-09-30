/**
 * The ledger — every amount in and out, in integer minor units (cents,
 * rupiah) so sums are exact. Entries are never edited; a mistake is fixed with
 * a correcting entry. Survival reads the balance from here.
 */

export interface LedgerEntry {
	id: string;
	/** ISO 4217, e.g. "EUR", "IDR". */
	currency: string;
	/** Positive in, negative out, in minor units. */
	amountMinor: number;
	description: string;
	/** What it relates to: an invoice, a run's LLM cost, a pledge. */
	ref: string | null;
	occurredAt: string;
	createdAt: string;
}

export interface NewLedgerEntry {
	currency: string;
	amountMinor: number;
	description: string;
	ref?: string | null;
	occurredAt?: string;
}

export interface LedgerStore {
	/** Posts entries atomically: all or none. */
	post(entries: NewLedgerEntry[]): Promise<LedgerEntry[]>;
	balance(currency: string): Promise<number>;
	/** Money in and out (both ≥ 0, minor units) for entries that occurred at or after `since`. */
	flow(
		currency: string,
		since: string,
	): Promise<{ in: number; out: number; entries: number }>;
	/** Currencies with any entries, most used first. */
	currencies(): Promise<string[]>;
	/** Newest first. */
	list(filter?: { currency?: string; limit?: number }): Promise<LedgerEntry[]>;
}
