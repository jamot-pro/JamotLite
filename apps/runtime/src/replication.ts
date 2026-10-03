import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { accessSync, constants, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { Secrets } from "@jamot/core";
import type { CompanyStore } from "@jamot/ports";
import type { DatabaseSummary } from "@jamot/sqlite";
import { stageRestore } from "./backups.js";

/**
 * Continuous off-site copies (BLUEPRINT S4, part 2; RUNTIME D43). The daily
 * snapshots stay on the company's own disk; Litestream streams every change
 * of `company.db` to S3-compatible storage, so losing the disk doesn't lose
 * the company. It's optional: `jamot replicate set s3://bucket/path`.
 *
 * The runtime runs `litestream replicate <company.db> <url>` beside itself
 * and restarts it if it stops. The credentials live in the secret store and
 * reach Litestream only as environment variables of that one process — never
 * in a file, a log or the URL. `secrets.key` is never replicated: a copy of
 * the database without it holds no readable secret.
 */

export const REPLICATION_SETTING = "replication";
export const REPLICA_KEY_ID_SECRET = "replication.accessKeyId";
export const REPLICA_SECRET_KEY_SECRET = "replication.secretAccessKey";

export interface ReplicationSettings {
	/** s3://bucket/path, with ?endpoint=…&region=… for S3-compatible stores. */
	url: string;
}

/** An s3:// URL Litestream understands, with no credentials written in it. */
export function checkReplicaUrl(url: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`"${url}" isn't a URL — use s3://bucket/path`);
	}
	if (parsed.protocol !== "s3:")
		throw new Error("replicate to S3-compatible storage: s3://bucket/path");
	if (!parsed.hostname) throw new Error("say which bucket: s3://bucket/path");
	if (parsed.username || parsed.password)
		throw new Error(
			"don't put credentials in the URL — they're asked for and kept in the secret store",
		);
	if (url.length > 500) throw new Error("that URL is too long");
	return url;
}

/** The Litestream binary: JAMOT_LITESTREAM, or `litestream` on the PATH. */
export function findLitestream(env = process.env): string | null {
	const candidates = env.JAMOT_LITESTREAM
		? [env.JAMOT_LITESTREAM]
		: (env.PATH ?? "")
				.split(delimiter)
				.filter(Boolean)
				.map((dir) => join(dir, "litestream"));
	for (const path of candidates) {
		try {
			accessSync(path, constants.X_OK);
			return path;
		} catch {
			// not here
		}
	}
	return null;
}

/** Only what Litestream needs: never the runtime's other variables. */
async function litestreamEnv(secrets: Secrets): Promise<NodeJS.ProcessEnv> {
	const id = await secrets.get(REPLICA_KEY_ID_SECRET);
	const key = await secrets.get(REPLICA_SECRET_KEY_SECRET);
	return {
		PATH: process.env.PATH ?? "",
		...(process.env.HOME ? { HOME: process.env.HOME } : {}),
		...(id ? { LITESTREAM_ACCESS_KEY_ID: id } : {}),
		...(key ? { LITESTREAM_SECRET_ACCESS_KEY: key } : {}),
	};
}

/** The URL without its query, which may name an endpoint or region. */
const redact = (url: string) => url.split("?")[0] as string;

export interface Replication {
	stop(): void;
}

/**
 * Starts replicating when it's configured; restarts Litestream when it stops,
 * waiting longer each time (2 s up to a minute). Null when it isn't set up.
 */
export async function startReplication(deps: {
	dataDir: string;
	store: CompanyStore;
	secrets: Secrets;
	log: (message: string) => void;
	binary?: string | null;
}): Promise<Replication | null> {
	const settings =
		await deps.store.settings.get<ReplicationSettings>(REPLICATION_SETTING);
	if (!settings?.url) return null;
	const binary = deps.binary === undefined ? findLitestream() : deps.binary;
	if (!binary) {
		deps.log(
			"[replication] set up, but litestream isn't installed here — the only copies are the daily ones on this disk",
		);
		return null;
	}
	const env = await litestreamEnv(deps.secrets);
	const db = join(deps.dataDir, "company.db");
	let child: ChildProcess | null = null;
	let stopped = false;
	let wait = 2_000;
	let timer: NodeJS.Timeout | null = null;
	const relay = (data: Buffer) => {
		for (const line of data.toString().split("\n"))
			if (line.trim()) deps.log(`[replication] ${line.trim()}`);
	};
	const run = () => {
		const started = Date.now();
		const current = spawn(binary, ["replicate", db, settings.url], {
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		child = current;
		current.stdout?.on("data", relay);
		current.stderr?.on("data", relay);
		current.on("error", (err) =>
			deps.log(`[replication] couldn't run litestream: ${err.message}`),
		);
		current.on("exit", (code, signal) => {
			child = null;
			if (stopped) return;
			// A run that lasted a while was healthy: start the wait over.
			if (Date.now() - started > 60_000) wait = 2_000;
			deps.log(
				`[replication] litestream stopped (${signal ?? `exit ${code}`}); starting it again in ${wait / 1000}s`,
			);
			timer = setTimeout(run, wait);
			wait = Math.min(wait * 2, 60_000);
		});
	};
	run();
	deps.log(`[replication] copying company.db to ${redact(settings.url)}`);
	return {
		stop() {
			stopped = true;
			if (timer) clearTimeout(timer);
			child?.kill("SIGTERM");
		},
	};
}

/**
 * Pulls the latest copy from the replica and stages it like any backup: the
 * next start puts it back, setting the current company aside.
 */
export async function restoreFromReplica(deps: {
	dataDir: string;
	store: CompanyStore;
	secrets: Secrets;
	binary?: string | null;
}): Promise<{ summary: DatabaseSummary }> {
	const settings =
		await deps.store.settings.get<ReplicationSettings>(REPLICATION_SETTING);
	if (!settings?.url)
		throw new Error("replication isn't set up: jamot replicate set <s3 url>");
	const binary = deps.binary === undefined ? findLitestream() : deps.binary;
	if (!binary) throw new Error("litestream isn't installed here");
	const dir = mkdtempSync(join(tmpdir(), "jamot-replica-"));
	const out = join(dir, "company.db");
	try {
		const result = spawnSync(binary, ["restore", "-o", out, settings.url], {
			env: await litestreamEnv(deps.secrets),
			encoding: "utf8",
			timeout: 10 * 60_000,
		});
		if (result.status !== 0)
			throw new Error(
				`litestream couldn't restore: ${(result.stderr || result.stdout || String(result.error ?? "")).trim()}`,
			);
		return { summary: stageRestore(deps.dataDir, out) };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
