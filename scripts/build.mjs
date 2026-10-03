// Builds Jamot Lite into dist/: one bundled jamot.mjs (no node_modules needed
// at run time), the company templates, and the web console.
import {
	cpSync,
	existsSync,
	mkdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

if (!existsSync(join(root, "apps/web/dist/index.html"))) {
	throw new Error("build the console first: pnpm --filter @jamot/web build");
}

await build({
	entryPoints: [join(root, "apps/runtime/src/cli.ts")],
	outfile: join(dist, "jamot.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	minify: true,
	legalComments: "linked",
	sourcemap: false,
	// Some dependencies are CommonJS and call require(); give them one.
	banner: {
		js: [
			"#!/usr/bin/env -S node --disable-warning=DEP0040",
			'import { createRequire as __jamotRequire } from "node:module";',
			"const require = __jamotRequire(import.meta.url);",
		].join("\n"),
	},
	logLevel: "warning",
});

cpSync(join(root, "templates"), join(dist, "templates"), { recursive: true });
cpSync(join(root, "apps/web/dist"), join(dist, "web"), { recursive: true });
cpSync(join(root, "LICENSE"), join(dist, "LICENSE"));

const pkg = {
	name: "jamot-lite",
	version: "0.1.0",
	description:
		"The organization that doesn't die when people leave. One company, one runtime.",
	license: "MIT",
	type: "module",
	bin: { jamot: "./jamot.mjs" },
	engines: { node: ">=22.19" },
	files: ["jamot.mjs", "jamot.mjs.LEGAL.txt", "templates", "web", "LICENSE"],
};
writeFileSync(join(dist, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

const mb = (p) => (statSync(p).size / 1024 / 1024).toFixed(1);
console.log(`dist/jamot.mjs  ${mb(join(dist, "jamot.mjs"))} MB`);
