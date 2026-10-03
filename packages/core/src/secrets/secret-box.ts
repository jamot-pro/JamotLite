import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import type { SecretStore } from "@jamot/ports";

/**
 * Encrypts secrets with the company's own key (`secrets.key`, created on first
 * run, readable only by its owner). AES-256-GCM; every ciphertext names its key
 * version ("v1:…") so the key can be rotated later without guessing.
 *
 * The key never goes in the database, `company.yaml`, logs or prompts. A
 * backup without `secrets.key` holds no readable secrets — which is the point.
 */
const VERSION = "v1";

export interface SecretBox {
	encrypt(plaintext: string): string;
	decrypt(ciphertext: string): string;
}

export function createSecretBox(key: Buffer): SecretBox {
	if (key.length !== 32) throw new Error("the secret key must be 32 bytes");
	return {
		encrypt(plaintext) {
			const iv = randomBytes(12);
			const cipher = createCipheriv("aes-256-gcm", key, iv);
			const body = Buffer.concat([
				cipher.update(plaintext, "utf8"),
				cipher.final(),
			]);
			return [
				VERSION,
				iv.toString("base64"),
				cipher.getAuthTag().toString("base64"),
				body.toString("base64"),
			].join(":");
		},
		decrypt(ciphertext) {
			const [version, iv, tag, body] = ciphertext.split(":");
			if (version !== VERSION || !iv || !tag || body === undefined)
				throw new Error("not a Jamot secret, or an unknown key version");
			const decipher = createDecipheriv(
				"aes-256-gcm",
				key,
				Buffer.from(iv, "base64"),
			);
			decipher.setAuthTag(Buffer.from(tag, "base64"));
			try {
				return Buffer.concat([
					decipher.update(Buffer.from(body, "base64")),
					decipher.final(),
				]).toString("utf8");
			} catch {
				throw new Error(
					"this secret can't be decrypted with this company's secrets.key",
				);
			}
		},
	};
}

/** Reads `secrets.key`, creating it (mode 600) the first time. */
export function loadOrCreateSecretKey(path: string): Buffer {
	if (existsSync(path)) {
		const key = Buffer.from(readFileSync(path, "utf8").trim(), "base64");
		if (key.length !== 32)
			throw new Error(`${path} is not a valid Jamot secret key`);
		return key;
	}
	const key = randomBytes(32);
	writeFileSync(path, `${key.toString("base64")}\n`, {
		mode: 0o600,
		flag: "wx",
	});
	chmodSync(path, 0o600);
	return key;
}

/** The secret store with encryption on the way in and decryption on the way out. */
export interface Secrets {
	set(ref: string, value: string): Promise<void>;
	get(ref: string): Promise<string | null>;
	delete(ref: string): Promise<boolean>;
	list(): Promise<string[]>;
}

export function createSecrets(store: SecretStore, box: SecretBox): Secrets {
	return {
		set: (ref, value) => store.put(ref, box.encrypt(value)),
		async get(ref) {
			const ciphertext = await store.get(ref);
			return ciphertext === null ? null : box.decrypt(ciphertext);
		},
		delete: (ref) => store.delete(ref),
		list: () => store.list(),
	};
}
