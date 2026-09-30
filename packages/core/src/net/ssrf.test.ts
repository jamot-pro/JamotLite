import { describe, expect, it } from "vitest";
import { assertSafeUrl } from "./ssrf.js";

describe("outbound URL guard", () => {
	it.each([
		["http://127.0.0.1:8080/mcp", /loopback/],
		["http://localhost/mcp", /loopback/],
		["http://[::1]/mcp", /loopback/],
		["http://169.254.169.254/latest/meta-data", /private network/],
		["http://10.1.2.3/mcp", /private network/],
		["http://[::ffff:192.168.1.5]/mcp", /private network/],
		["http://[::ffff:127.0.0.1]/mcp", /loopback/],
		["file:///etc/passwd", /scheme/],
		["not a url", /not a valid URL/],
	])("refuses %s", async (url, error) => {
		await expect(assertSafeUrl(url)).rejects.toThrow(error);
	});

	it("allows the company's own network only when the tool opts in, never loopback", async () => {
		await expect(
			assertSafeUrl("http://192.168.1.20:8123/mcp", {
				allowPrivateNetwork: true,
			}),
		).resolves.toBeUndefined();
		await expect(
			assertSafeUrl("http://127.0.0.1/mcp", { allowPrivateNetwork: true }),
		).rejects.toThrow(/loopback/);
	});

	it("allows public addresses", async () => {
		await expect(
			assertSafeUrl("https://93.184.216.34/mcp"),
		).resolves.toBeUndefined();
	});
});
