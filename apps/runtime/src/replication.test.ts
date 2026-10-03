import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { receiveMessage } from "@jamot/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { takeBackup } from "./backups.js";
import { importCompany, openCompany, replicate } from "./cli/commands.js";
import {
	checkReplicaUrl,
	REPLICATION_SETTING,
	restoreFromReplica,
	startReplication,
} from "./replication.js";
import { createRuntime } from "./runtime.js";

let root: string;
let dir: string;
let fake: string;
let calls: string;
beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "jamot-replica-test-"));
	dir = join(root, "company");
	await importCompany(join("templates", "restaurant.yaml"), dir);
	calls = join(root, "calls.jsonl");
	// A stand-in for litestream: records what it was given; `replicate` runs
	// until stopped (or exits at once when told to), `restore` copies a file.
	fake = join(root, "litestream");
	writeFileSync(
		fake,
		`#!${process.execPath}
const fs = require("node:fs");
const [cmd, ...args] = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ cmd, args, env: process.env }) + "\\n");
if (cmd === "restore") { fs.copyFileSync(process.env.FAKE_SOURCE || ${JSON.stringify(join(root, "replica.db"))}, args[1]); process.exit(0); }
if (fs.existsSync(${JSON.stringify(join(root, "crash"))})) process.exit(3);
setInterval(() => {}, 1000);
`,
	);
	chmodSync(fake, 0o755);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const recorded = () =>
	existsSync(calls)
		? readFileSync(calls, "utf8")
				.trim()
				.split("\n")
				.map((l) => JSON.parse(l))
		: [];
const until = async (check: () => boolean) => {
	for (let i = 0; i < 100 && !check(); i++)
		await new Promise((r) => setTimeout(r, 50));
};

describe("replication with Litestream", () => {
	it("does nothing until it's set up", async () => {
		const c = openCompany(dir);
		try {
			expect(
				await startReplication({
					dataDir: dir,
					store: c.store,
					secrets: c.secrets,
					log: () => {},
					binary: fake,
				}),
			).toBeNull();
			expect(recorded()).toEqual([]);
		} finally {
			c.close();
		}
	});

	it("replicates company.db with the keys from the secret store, and nothing else of ours", async () => {
		await replicate(dir, "set", {
			url: "s3://my-bucket/jamot?endpoint=93.184.215.14&region=auto",
			accessKeyId: "AKIDEXAMPLE",
			secretAccessKey: "not-a-real-secret",
		});
		process.env.JAMOT_PASSWORD = "must not leak";
		const c = openCompany(dir);
		const logs: string[] = [];
		try {
			const replication = await startReplication({
				dataDir: dir,
				store: c.store,
				secrets: c.secrets,
				log: (m) => logs.push(m),
				binary: fake,
			});
			await until(() => recorded().length > 0);
			const [call] = recorded();
			expect(call.cmd).toBe("replicate");
			expect(call.args).toEqual([
				join(dir, "company.db"),
				"s3://my-bucket/jamot?endpoint=93.184.215.14&region=auto",
			]);
			expect(call.env.LITESTREAM_ACCESS_KEY_ID).toBe("AKIDEXAMPLE");
			expect(call.env.LITESTREAM_SECRET_ACCESS_KEY).toBe("not-a-real-secret");
			expect(call.env.JAMOT_PASSWORD).toBeUndefined();
			// The secret is in the store, encrypted, and never in a log line.
			expect(logs.join("\n")).not.toContain("not-a-real-secret");
			expect(logs.join("\n")).toContain("s3://my-bucket/jamot");
			expect(logs.join("\n")).not.toContain("endpoint=");
			await replication?.stop();
		} finally {
			delete process.env.JAMOT_PASSWORD;
			c.close();
		}
	});

	it("starts litestream again when it stops", async () => {
		await replicate(dir, "set", {
			url: "s3://my-bucket/jamot",
			accessKeyId: "AKIDEXAMPLE",
			secretAccessKey: "s",
		});
		writeFileSync(join(root, "crash"), "");
		const c = openCompany(dir);
		const logs: string[] = [];
		try {
			const replication = await startReplication({
				dataDir: dir,
				store: c.store,
				secrets: c.secrets,
				log: (m) => logs.push(m),
				binary: fake,
			});
			await until(() => logs.some((l) => l.includes("starting it again")));
			expect(logs.join("\n")).toMatch(
				/litestream stopped \(exit 3\); starting it again in 2s/,
			);
			await replication?.stop();
		} finally {
			c.close();
		}
	});

	it("restores the replica's latest copy on the next start, and finds the memory", async () => {
		await replicate(dir, "set", {
			url: "s3://my-bucket/jamot",
			accessKeyId: "AKIDEXAMPLE",
			secretAccessKey: "s",
		});
		// What the replica holds: the company, remembering a walnut allergy.
		const c = openCompany(dir);
		await receiveMessage(c.store, {
			channel: "telegram",
			threadId: "100",
			messageId: "1",
			from: { userId: "100", displayName: "Mrs. Rossi" },
			text: "I'm allergic to walnuts",
		});
		await takeBackup(c.store, dir, { to: join(root, "replica.db") });
		c.close();

		const again = openCompany(dir);
		try {
			const { summary } = await restoreFromReplica({
				dataDir: dir,
				store: again.store,
				secrets: again.secrets,
				binary: fake,
			});
			expect(summary.people).toBe(1);
			const [call] = recorded();
			expect(call.cmd).toBe("restore");
			expect(call.args.slice(0, 1)).toEqual(["-o"]);
			expect(call.args[2]).toBe("s3://my-bucket/jamot");
		} finally {
			again.close();
		}
		const runtime = await createRuntime({
			dataDir: dir,
			telegram: false,
			log: () => {},
		});
		try {
			expect(await runtime.store.memory.search("walnuts")).toHaveLength(1);
		} finally {
			await runtime.stop();
		}
	});

	it("takes only an s3:// URL with no credentials in it, and forgets the keys when off", async () => {
		await expect(checkReplicaUrl("https://example.com/x")).rejects.toThrow(
			/s3:\/\//,
		);
		await expect(checkReplicaUrl("s3://key:secret@bucket/x")).rejects.toThrow(
			/credentials in the URL/,
		);
		await expect(checkReplicaUrl("not a url")).rejects.toThrow(/isn't a URL/);
		// The endpoint gets the whole company: never a metadata or loopback
		// address, and a private one only when the owner says so.
		await expect(
			checkReplicaUrl("s3://b/x?endpoint=169.254.169.254"),
		).rejects.toThrow(/endpoint isn't safe/);
		await expect(
			checkReplicaUrl("s3://b/x?endpoint=http://127.0.0.1:9000"),
		).rejects.toThrow(/endpoint isn't safe/);
		await expect(
			checkReplicaUrl("s3://b/x?endpoint=http://192.168.1.20:9000"),
		).rejects.toThrow(/--private-network/);
		await expect(
			checkReplicaUrl("s3://b/x?endpoint=http://192.168.1.20:9000", {
				allowPrivateNetwork: true,
			}),
		).resolves.toContain("192.168.1.20");
		await replicate(dir, "set", {
			url: "s3://my-bucket/jamot",
			accessKeyId: "AKIDEXAMPLE",
			secretAccessKey: "s",
		});
		expect(await replicate(dir, "off")).toMatch(/off/);
		const c = openCompany(dir);
		try {
			expect(await c.store.settings.get(REPLICATION_SETTING)).toBeNull();
			expect(await c.secrets.list()).not.toContain("replication.accessKeyId");
		} finally {
			c.close();
		}
	});

	it("waits for litestream to exit on stop, and ends one a crash left running", async () => {
		await replicate(dir, "set", {
			url: "s3://my-bucket/jamot",
			accessKeyId: "AKIDEXAMPLE",
			secretAccessKey: "s",
		});
		const c = openCompany(dir);
		try {
			const first = await startReplication({
				dataDir: dir,
				store: c.store,
				secrets: c.secrets,
				log: () => {},
				binary: fake,
			});
			await until(() => existsSync(join(dir, "litestream.pid")));
			const pid = Number(readFileSync(join(dir, "litestream.pid"), "utf8"));
			const alive = (p: number) => {
				try {
					process.kill(p, 0);
					return true;
				} catch {
					return false;
				}
			};
			// As if the runtime had crashed: its litestream is still running,
			// and the next start finds its pid and ends it before starting anew.
			const logs: string[] = [];
			const second = await startReplication({
				dataDir: dir,
				store: c.store,
				secrets: c.secrets,
				log: (m) => logs.push(m),
				binary: fake,
			});
			expect(logs.join("\n")).toContain(`ending litestream ${pid}`);
			// (It's this test's own child, so Node reaps it a moment later.)
			await until(() => !alive(pid));
			expect(alive(pid)).toBe(false);
			await first?.stop();
			// stop() resolves only once litestream has exited.
			await until(() => existsSync(join(dir, "litestream.pid")));
			const secondPid = Number(
				readFileSync(join(dir, "litestream.pid"), "utf8"),
			);
			await second?.stop();
			await until(() => !alive(secondPid));
			expect(alive(secondPid)).toBe(false);
		} finally {
			c.close();
		}
	});
});
