import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF guard for every URL a person or a company file supplies (AGENTS.md
 * rule 6). Carried over from J-Nesys `mcp/ssrf.ts`, with more reserved ranges
 * and one addition: a company can opt a tool into its own local network
 * (`allowPrivateNetwork`) — a runtime on the owner's own machine may well
 * talk to Home Assistant on the LAN. Loopback stays refused even then.
 *
 * Best effort against DNS rebinding: the request happens after the check.
 */

const PRIVATE_V4 = [
	"0.0.0.0/8",
	"10.0.0.0/8",
	"100.64.0.0/10",
	"169.254.0.0/16",
	"172.16.0.0/12",
	"192.168.0.0/16",
	"198.18.0.0/15",
];
const LOOPBACK_V4 = "127.0.0.0/8";

const toInt = (ip: string) =>
	ip.split(".").reduce((n, part) => ((n << 8) | Number(part)) >>> 0, 0);
function inCidr(ip: string, cidr: string): boolean {
	const [network, bits] = cidr.split("/") as [string, string];
	const mask =
		Number(bits) === 0 ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0;
	return (toInt(ip) & mask) === (toInt(network) & mask);
}

type Kind = "public" | "private" | "loopback";

function classify(address: string): Kind {
	const v = isIP(address);
	if (v === 4) {
		if (inCidr(address, LOOPBACK_V4)) return "loopback";
		return PRIVATE_V4.some((c) => inCidr(address, c)) ? "private" : "public";
	}
	if (v === 6) {
		const a = address.toLowerCase();
		if (a === "::1") return "loopback";
		if (a === "::") return "private";
		if (a.startsWith("::ffff:")) {
			const rest = a.slice(7);
			if (isIP(rest) === 4) return classify(rest);
			// URL parsing turns ::ffff:192.168.1.5 into ::ffff:c0a8:105 — read it back as IPv4.
			const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
			if (hex) {
				const hi = Number.parseInt(hex[1] as string, 16);
				const lo = Number.parseInt(hex[2] as string, 16);
				return classify(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
			}
		}
		if (/^fe[89ab]/.test(a) || a.startsWith("fc") || a.startsWith("fd"))
			return "private";
	}
	return "public";
}

export async function assertSafeUrl(
	url: string,
	opts: { allowPrivateNetwork?: boolean } = {},
): Promise<void> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`not a valid URL: ${url}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(
			`unsafe URL scheme: ${parsed.protocol} (http and https only)`,
		);
	}
	const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (host === "localhost" || host.endsWith(".localhost"))
		throw new Error(`unsafe URL host: ${host} (loopback)`);

	const check = (address: string, label: string) => {
		const kind = classify(address);
		if (kind === "loopback")
			throw new Error(`unsafe URL host: ${label} (loopback)`);
		if (kind === "private" && !opts.allowPrivateNetwork) {
			throw new Error(
				`unsafe URL host: ${label} is on a private network — set allowPrivateNetwork on the tool to allow it`,
			);
		}
	};

	if (isIP(host)) return check(host, host);
	let addresses: { address: string }[];
	try {
		addresses = await Promise.race([
			lookup(host, { all: true }),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("dns timeout")), 2000),
			),
		]);
	} catch {
		// Unresolvable now: the request itself will fail. Everything that resolves is checked.
		return;
	}
	for (const { address } of addresses) check(address, `${host} (${address})`);
}
