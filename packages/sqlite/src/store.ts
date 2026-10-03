import { AsyncLocalStorage } from "node:async_hooks";
import { backup, type DatabaseSync } from "node:sqlite";
import type { CompanyPorts, CompanyStore } from "@jamot/ports";
import { approvalOps, runOps, transcriptOps } from "./brain.js";
import { conversationOps } from "./conversations.js";
import { openCompanyDb } from "./db.js";
import { eventOps } from "./events.js";
import { graphOps } from "./graph.js";
import { jobOps } from "./jobs.js";
import { ledgerOps } from "./ledger.js";
import { memoryOps } from "./memory.js";
import { peopleOps } from "./people.js";
import { secretOps } from "./secrets.js";
import { settingsOps } from "./settings.js";
import type { Sync } from "./sync.js";

type SyncPorts = { [K in keyof CompanyPorts]: Sync<CompanyPorts[K]> };

/**
 * The SQLite company store.
 *
 * node:sqlite is synchronous and there is one connection, so every call is
 * queued and runs in its own transaction; `transaction()` holds the queue
 * until its work is done, which makes multi-port work atomic even though the
 * callback is async. Calling the outer store from inside a transaction would
 * wait forever, so it throws instead.
 */
export function createSqliteStore(db: DatabaseSync): CompanyStore {
	const ops: SyncPorts = {
		graph: graphOps(db),
		settings: settingsOps(db),
		people: peopleOps(db),
		conversations: conversationOps(db),
		memory: memoryOps(db),
		events: eventOps(db),
		jobs: jobOps(db),
		ledger: ledgerOps(db),
		runs: runOps(db),
		transcripts: transcriptOps(db),
		approvals: approvalOps(db),
		secrets: secretOps(db),
	};

	const insideTransaction = new AsyncLocalStorage<true>();
	let tail: Promise<unknown> = Promise.resolve();
	const queue = <T>(work: () => Promise<T> | T): Promise<T> => {
		if (insideTransaction.getStore()) {
			return Promise.reject(
				new Error("use the ports passed to transaction() inside a transaction"),
			);
		}
		const result = tail.then(work);
		tail = result.catch(() => undefined);
		return result;
	};

	const atomically = async <T>(work: () => Promise<T> | T): Promise<T> => {
		db.exec("BEGIN IMMEDIATE");
		try {
			const result = await work();
			db.exec("COMMIT");
			return result;
		} catch (err) {
			db.exec("ROLLBACK");
			throw err;
		}
	};

	// Each call made from outside a transaction: queued, atomic on its own.
	const outer = wrapAll(ops, (call) => queue(() => atomically(call)));
	// Each call made inside a transaction: runs straight away on the open transaction.
	const inner = wrapAll(ops, (call) => Promise.resolve().then(call));

	return {
		...outer,
		transaction(work) {
			return queue(() =>
				atomically(() => insideTransaction.run(true, () => work(inner))),
			);
		},
		backup(destination) {
			// Queued so no write of ours lands halfway through the copy.
			return queue(async () => {
				await backup(db, destination);
			});
		},
		close() {
			db.close();
		},
	};
}

/** Opens (and migrates) a company database and returns its store. */
export function openCompanyStore(path: string): CompanyStore {
	return createSqliteStore(openCompanyDb(path));
}

type Runner = <T>(call: () => T) => Promise<T>;

function wrapAll(ops: SyncPorts, runner: Runner): CompanyPorts {
	const wrapped: Record<string, unknown> = {};
	for (const [port, methods] of Object.entries(ops)) {
		const asyncMethods: Record<string, unknown> = {};
		for (const [name, fn] of Object.entries(
			methods as Record<string, (...a: unknown[]) => unknown>,
		)) {
			asyncMethods[name] = (...args: unknown[]) => runner(() => fn(...args));
		}
		wrapped[port] = asyncMethods;
	}
	return wrapped as unknown as CompanyPorts;
}
