import {
	createHmac,
	randomBytes,
	scrypt as scryptCb,
	timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

/**
 * Console sign-in for v0.1: one owner password (scrypt), and a signed session
 * cookie keyed from the company's `secrets.key` (RUNTIME D24). Nothing to run
 * alongside, nothing stored per session.
 */

const scrypt = promisify(scryptCb) as (
	password: string,
	salt: Buffer,
	keylen: number,
) => Promise<Buffer>;

export const PASSWORD_SETTING = "console.passwordHash";
export const SESSION_COOKIE = "jamot_session";
const SESSION_DAYS = 14;

export async function hashPassword(password: string): Promise<string> {
	if (password.length < 10)
		throw new Error("the password must be at least 10 characters");
	const salt = randomBytes(16);
	const hash = await scrypt(password, salt, 32);
	return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(
	password: string,
	stored: string,
): Promise<boolean> {
	const [scheme, salt, hash] = stored.split("$");
	if (scheme !== "scrypt" || !salt || !hash) return false;
	const expected = Buffer.from(hash, "base64");
	const actual = await scrypt(
		password,
		Buffer.from(salt, "base64"),
		expected.length,
	);
	return timingSafeEqual(actual, expected);
}

/** Session tokens: "<expiry ms>.<hmac>". */
export function createSessions(secretKey: Buffer) {
	const key = createHmac("sha256", secretKey)
		.update("jamot console sessions v1")
		.digest();
	const sign = (payload: string) =>
		createHmac("sha256", key).update(payload).digest("base64url");
	return {
		issue(now = Date.now()): { token: string; maxAgeSeconds: number } {
			const expires = String(now + SESSION_DAYS * 86_400_000);
			return {
				token: `${expires}.${sign(expires)}`,
				maxAgeSeconds: SESSION_DAYS * 86_400,
			};
		},
		valid(token: string | undefined, now = Date.now()): boolean {
			if (!token) return false;
			const [expires, signature] = token.split(".");
			if (!expires || !signature) return false;
			const good = Buffer.from(sign(expires));
			const given = Buffer.from(signature);
			return (
				good.length === given.length &&
				timingSafeEqual(good, given) &&
				Number(expires) > now
			);
		},
	};
}

export function readCookie(
	header: string | undefined,
	name: string,
): string | undefined {
	for (const part of (header ?? "").split(";")) {
		const [k, ...v] = part.trim().split("=");
		if (k === name) return decodeURIComponent(v.join("="));
	}
	return undefined;
}
