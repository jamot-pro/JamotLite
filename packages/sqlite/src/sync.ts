import type { DatabaseSync } from "node:sqlite";

/** The synchronous twin of an async port: what a SQLite adapter implements. */
export type Sync<P> = {
	[K in keyof P]: P[K] extends (...args: infer A) => Promise<infer R>
		? (...args: A) => R
		: never;
};

export type Row = Record<string, unknown>;

export const nowIso = (): string => new Date().toISOString();

export function json(text: unknown): Record<string, unknown> {
	return typeof text === "string"
		? (JSON.parse(text) as Record<string, unknown>)
		: {};
}

export function one<T extends Row>(
	db: DatabaseSync,
	sql: string,
	...params: SqlValue[]
): T | undefined {
	return db.prepare(sql).get(...params) as T | undefined;
}

export function all<T extends Row>(
	db: DatabaseSync,
	sql: string,
	...params: SqlValue[]
): T[] {
	return db.prepare(sql).all(...params) as T[];
}

export function run(
	db: DatabaseSync,
	sql: string,
	...params: SqlValue[]
): number {
	return Number(db.prepare(sql).run(...params).changes);
}

export type SqlValue = string | number | bigint | null | Uint8Array;
