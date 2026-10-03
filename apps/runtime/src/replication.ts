import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
	accessSync,
	constants,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeUrl, type Secrets } from "@jamot/core";
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
	/** A storage server on the owner's own network (MinIO on the LAN). */
	allowPrivateNetwork?: boolean;
}

/** Litestream's pid, so a start after a crash can end the one left running. */
const PID_FILE = "litestream.pid";

/**
 * An s3:// URL Litestream understands, with no credentials written in it,
 * whose `endpoint` (an S3-compatible store) passes the outbound URL check —
 * no loopback, link-local or cloud metadata address, and no private network
 * unless the owner says so (AGENTS.md rule 5). Litestream sends the whole
 * database and the keys there, so this matters more than for any fetch.
 */
export async function checkReplicaUrl(
	url: string,
	opts: { allowPrivateNetwork?: boolean } = {},
): Promise<string> {
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
	const endpoint = parsed.searchParams.get("endpoint");
	if (endpoint) {
		const asUrl = /^[a-z]+:\/\//i.test(endpoint)
			? endpoint
			: `https://${endpoint}`;
		await assertSafeUrl(asUrl, {
			allowPrivateNetwork: opts.allowPrivateNetwork === true,
		}).catch((err: Error) => {
			throw new Error(
				`the storage endpoint isn't safe to send the company to: ${err.message}${opts.allowPrivateNetwork ? "" : " (a server on your own network: add --private-network)"}`,
			);
		});
	}
	return url;
}

/**
 * The Litestream binary: JAMOT_LITESTREAM, or a system install (the image puts
 * it in /usr/local/bin). Not a search of PATH: a `litestream` planted in a
 * writable directory there would be handed the bucket keys.
 */
const SYSTEM_LITESTREAM = [
	"/usr/local/bin/litestream",
	"/usr/bin/litestream",
	"/opt/homebrew/bin/litestream",
];
export function findLitestream(env = process.env): string | null {
	const candidates = env.JAMOT_LITESTREAM
		? [env.JAMOT_LITESTREAM]
		: SYSTEM_LITESTREAM;
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
	/** Resolves once Litestream has exited (TERM, then KILL after 5 s). */
	stop(): Promise<void>;
}

/** Is this pid a running litestream? Only then is it ours to end. */
function isLitestream(pid: number): boolean {
	try {
		process.kill(pid, 0);
	} catch {
		return false;
	}
	try {
		return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("litestream");
	} catch {
		const ps = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
			encoding: "utf8",
		});
		return ps.status === 0 && ps.stdout.includes("litestream");
	}
}

/** A litestream left running by a runtime that crashed: end it first. */
async function endLeftover(dataDir: string, log: (m: string) => void) {
	const file = join(dataDir, PID_FILE);
	if (!existsSync(file)) return;
	const pid = Number(readFileSync(file, "utf8").trim());
	rmSync(file, { force: true });
	if (!Number.isInteger(pid) || pid <= 1 || !isLitestream(pid)) return;
	log(`[replication] ending litestream ${pid}, left running by a crash`);
	process.kill(pid, "SIGTERM");
	for (let i = 0; i < 50 && isLitestream(pid); i++)
		await new Promise((r) => setTimeout(r, 100));
	if (isLitestream(pid)) process.kill(pid, "SIGKILL");
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
	// Checked again at every start: what an endpoint resolves to can change.
	try {
		await checkReplicaUrl(settings.url, settings);
	} catch (err) {
		deps.log(`[replication] not started: ${(err as Error).message}`);
		return null;
	}
	const binary = deps.binary === undefined ? findLitestream() : deps.binary;
	if (!binary) {
		deps.log(
			"[replication] set up, but litestream isn't installed here — the only copies are the daily ones on this disk",
		);
		return null;
	}
	await endLeftover(deps.dataDir, deps.log);
	const env = await litestreamEnv(deps.secrets);
	const db = join(deps.dataDir, "company.db");
	const pidFile = join(deps.dataDir, PID_FILE);
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
		if (current.pid)
			writeFileSync(pidFile, String(current.pid), { mode: 0o600 });
		current.stdout?.on("data", relay);
		current.stderr?.on("data", relay);
		current.on("error", (err) =>
			deps.log(`[replication] couldn't run litestream: ${err.message}`),
		);
		current.on("exit", (code, signal) => {
			child = null;
			// Only our own pid: a newer litestream may have written its own.
			try {
				if (readFileSync(pidFile, "utf8").trim() === String(current.pid))
					rmSync(pidFile, { force: true });
			} catch {
				// already gone
			}
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
		async stop() {
			stopped = true;
			if (timer) clearTimeout(timer);
			const running = child;
			// A signal leaves exitCode null: it has exited if either is set.
			if (!running || running.exitCode !== null || running.signalCode !== null)
				return;
			const exited = new Promise<void>((r) => running.once("exit", () => r()));
			running.kill("SIGTERM");
			const kill = setTimeout(() => running.kill("SIGKILL"), 5_000);
			await exited;
			clearTimeout(kill);
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
