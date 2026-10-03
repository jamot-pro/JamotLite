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
			url: "s3://my-bucket/jamot?endpoint=s3.example.com&region=auto",
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
				"s3://my-bucket/jamot?endpoint=s3.example.com&region=auto",
			]);
			expect(call.env.LITESTREAM_ACCESS_KEY_ID).toBe("AKIDEXAMPLE");
			expect(call.env.LITESTREAM_SECRET_ACCESS_KEY).toBe("not-a-real-secret");
			expect(call.env.JAMOT_PASSWORD).toBeUndefined();
			// The secret is in the store, encrypted, and never in a log line.
			expect(logs.join("\n")).not.toContain("not-a-real-secret");
			expect(logs.join("\n")).toContain("s3://my-bucket/jamot");
			expect(logs.join("\n")).not.toContain("endpoint=");
			replication?.stop();
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
			replication?.stop();
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
		expect(() => checkReplicaUrl("https://example.com/x")).toThrow(/s3:\/\//);
		expect(() => checkReplicaUrl("s3://key:secret@bucket/x")).toThrow(
			/credentials in the URL/,
		);
		expect(() => checkReplicaUrl("not a url")).toThrow(/isn't a URL/);
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
});
