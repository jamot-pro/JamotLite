// The esbuild options for the bundle, shared by build.mjs and smoke-bundle.mjs.
export const bundleOptions = {
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	minify: true,
	// Keep class names: node-fetch (under grammy) recognises an abort signal by
	// its class being called "AbortSignal", and esbuild renames the polyfill's
	// class to dodge the global one. Without this, every Telegram call hangs.
	keepNames: true,
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
};
