// The bundled Telegram client reaches Telegram: a fake token must be refused
// (401) within seconds, not hang. Catches a build setting that breaks grammy's
// HTTP client, as renamed classes once did (RUNTIME D38). Needs the network.
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { bundleOptions } from "./build-options.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(mkdtempSync(join(tmpdir(), "jamot-smoke-")), "probe.mjs");
await build({
	...bundleOptions,
	stdin: {
		contents: `import { Bot } from "grammy";
const bot = new Bot("12345:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
try { await bot.init(AbortSignal.timeout(15000)); }
catch (e) { console.log(e.error_code ?? e.message); }`,
		resolveDir: join(root, "packages/telegram"),
		loader: "js",
	},
	outfile,
});
const run = spawnSync(process.execPath, [outfile], {
	encoding: "utf8",
	timeout: 30_000,
});
if (run.stdout.trim() !== "401") {
	console.error(
		`The bundled Telegram client got no answer from Telegram: ${run.stdout.trim() || run.stderr.trim() || "timed out"}`,
	);
	process.exit(1);
}
console.log("bundle smoke: Telegram refused the fake token (401) ✓");
