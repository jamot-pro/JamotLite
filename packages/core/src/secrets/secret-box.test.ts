import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openCompanyStore } from "@jamot/sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
	createSecretBox,
	createSecrets,
	loadOrCreateSecretKey,
} from "./secret-box.js";

const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir() {
	const d = mkdtempSync(join(tmpdir(), "jamot-secrets-"));
	dirs.push(d);
	return d;
}

describe("secrets", () => {
	it("creates the key once, readable only by its owner, and reuses it", () => {
		const path = join(tempDir(), "secrets.key");
		const key = loadOrCreateSecretKey(path);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(loadOrCreateSecretKey(path).equals(key)).toBe(true);
	});

	it("keeps only ciphertext in the database", async () => {
		const dir = tempDir();
		const store = openCompanyStore(join(dir, "company.db"));
		const secrets = createSecrets(
			store.secrets,
			createSecretBox(loadOrCreateSecretKey(join(dir, "secrets.key"))),
		);
		await secrets.set("telegram.botToken", "123456:AA-bot-token-value");

		expect(await secrets.get("telegram.botToken")).toBe(
			"123456:AA-bot-token-value",
		);
		expect(await store.secrets.get("telegram.botToken")).toMatch(/^v1:/);
		expect(await secrets.list()).toEqual(["telegram.botToken"]);
		store.close();
		expect(
			readFileSync(join(dir, "company.db")).includes("bot-token-value"),
		).toBe(false);
	});

	it("can't be read with another company's key, or after tampering", () => {
		const ours = createSecretBox(Buffer.alloc(32, 1));
		const theirs = createSecretBox(Buffer.alloc(32, 2));
		const sealed = ours.encrypt("sk-live-123");
		expect(() => theirs.decrypt(sealed)).toThrow(/can't be decrypted/);
		const parts = sealed.split(":");
		parts[3] = Buffer.from("sk-live-999").toString("base64");
		expect(() => ours.decrypt(parts.join(":"))).toThrow(/can't be decrypted/);
		expect(ours.encrypt("same")).not.toBe(ours.encrypt("same"));
	});
});
