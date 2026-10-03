import {
	existsSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { receiveMessage } from "@jamot/core";
import { openCompanyStore } from "@jamot/sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	applyPendingRestore,
	BACKUPS_KEPT,
	backupIfDue,
	listBackups,
	stageRestore,
	takeBackup,
} from "./backups.js";
import { createRuntime } from "./runtime.js";

let dataDir: string;
beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "jamot-backups-"));
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

const open = () => openCompanyStore(join(dataDir, "company.db"));
const say = (id: string, text: string) => ({
	channel: "telegram" as const,
	threadId: "100",
	messageId: id,
	from: { userId: "100", displayName: "Mrs. Rossi" },
	text,
});

describe("backups", () => {
	it("takes one a day on its own and keeps the last seven", async () => {
		const store = open();
		try {
			const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n, 2));
			expect(await backupIfDue(store, dataDir, day(0))).not.toBeNull();
			// Not again the same day.
			expect(
				await backupIfDue(
					store,
					dataDir,
					new Date(day(0).getTime() + 3_600_000),
				),
			).toBeNull();
			for (let n = 1; n <= 9; n++) await backupIfDue(store, dataDir, day(n));
			const kept = listBackups(dataDir);
			expect(kept).toHaveLength(BACKUPS_KEPT);
			expect(kept[0]).toContain("2026-10-10");
			expect(
				readdirSync(join(dataDir, "backups")).some((f) => f.includes("key")),
			).toBe(false);
		} finally {
			store.close();
		}
	});

	it("restores a snapshot on the next start, and finds the memory again", async () => {
		const store = open();
		await receiveMessage(store, say("1", "I'm allergic to walnuts"));
		const snapshot = await takeBackup(store, dataDir);
		await receiveMessage(store, say("2", "Something said after the backup"));
		const before = (await store.memory.list()).length;
		store.close();

		const summary = stageRestore(dataDir, snapshot);
		expect(summary).toMatchObject({ people: 1 });
		expect(summary.memories).toBeLessThan(before);

		const runtime = await createRuntime({
			dataDir,
			telegram: false,
			log: () => {},
		});
		try {
			const found = await runtime.store.memory.search("walnuts");
			expect(found).toHaveLength(1);
			expect(
				await runtime.store.memory.search("after the backup"),
			).toHaveLength(0);
		} finally {
			await runtime.stop();
		}
		// The company as it was is set aside, so the restore can be undone.
		expect(
			readdirSync(join(dataDir, "backups")).some((f) =>
				f.startsWith("before-restore-"),
			),
		).toBe(true);
		expect(existsSync(join(dataDir, "restore.db"))).toBe(false);
	});

	it("refuses a file that isn't a company database", () => {
		const bogus = join(dataDir, "notes.db");
		writeFileSync(bogus, "");
		expect(() => stageRestore(dataDir, bogus)).toThrow(
			"isn't a Jamot company database",
		);
		expect(applyPendingRestore(dataDir)).toBeNull();
	});
});

describe("restoring safely", () => {
	it("refuses a database that still has its write-ahead log beside it", async () => {
		const store = open(); // open: company.db-wal exists
		try {
			await receiveMessage(store, say("1", "hello"));
			expect(() => stageRestore(dataDir, join(dataDir, "company.db"))).toThrow(
				"-wal is next to it",
			);
		} finally {
			store.close();
		}
	});

	it("keeps company.db whole if it stops between the copy and the swap", async () => {
		const store = open();
		await receiveMessage(store, say("1", "I'm allergic to walnuts"));
		const snapshot = await takeBackup(store, dataDir);
		await receiveMessage(store, say("2", "Something said after the backup"));
		store.close();
		stageRestore(dataDir, snapshot);
		// As if a first attempt had set the old one aside and then crashed:
		// company.db is still the old company, restore.db still waits.
		const again = open();
		expect(await again.memory.search("after the backup")).toHaveLength(1);
		again.close();
		expect(applyPendingRestore(dataDir)).toContain("before-restore-");
		const restored = open();
		try {
			expect(await restored.memory.search("walnuts")).toHaveLength(1);
			expect(await restored.memory.search("after the backup")).toHaveLength(0);
		} finally {
			restored.close();
		}
	});

	it("keeps only the last three companies set aside by restores", async () => {
		const store = open();
		const snapshot = await takeBackup(store, dataDir);
		store.close();
		for (let n = 0; n < 5; n++) {
			stageRestore(dataDir, snapshot);
			applyPendingRestore(dataDir, new Date(Date.UTC(2026, 9, 1 + n)));
		}
		const setAside = readdirSync(join(dataDir, "backups")).filter((f) =>
			f.startsWith("before-restore-"),
		);
		expect(setAside).toHaveLength(3);
	});
});
