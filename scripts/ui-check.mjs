// The console's UI rules, checked (apps/web/DESIGN.md, RUNTIME D46). Pages
// are made of components from src/ui, so a new look never means editing
// every page; the API's shapes come from @jamot/contracts, so a change on the
// server fails the build here instead of a screen.
//
//   pnpm ui-check
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirs = ["apps/web/src/pages", "apps/web/src/dev"].map((d) =>
	join(root, d),
);

const RULES = [
	[/\bclassName\s*=/, "a class name: use a component from src/ui instead"],
	[/\bstyle\s*=\s*\{/, "an inline style: use a component from src/ui instead"],
	[/import\s+["'][^"']+\.css["']/, "a stylesheet: styles live in src/ui"],
	[
		/^\s*(export\s+)?interface\s+\w+/,
		"its own interface: the API's shapes come from @jamot/contracts",
	],
	[
		/^\s*(export\s+)?type\s+\w+\s*=\s*\{/,
		"its own object type: the API's shapes come from @jamot/contracts",
	],
	[
		/<(div|section|article|ul|ol|li|table|button|input|select|form|nav|header|main)\b/,
		null,
	],
];

const files = dirs.flatMap((d) =>
	readdirSync(d, { recursive: true })
		.map(String)
		.filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
		.map((f) => join(d, f)),
);

const problems = [];
for (const file of files) {
	const lines = readFileSync(file, "utf8").split("\n");
	for (const [i, line] of lines.entries()) {
		for (const [pattern, why] of RULES) {
			if (!pattern.test(line)) continue;
			const tag = /<(\w+)/.exec(line)?.[1];
			problems.push(
				`${relative(root, file)}:${i + 1}  ${why ?? `a raw <${tag}>: use a component from src/ui instead`}`,
			);
		}
	}
}

if (problems.length) {
	console.error(
		`ui-check: ${problems.length} page line(s) break the UI rules (apps/web/DESIGN.md):\n`,
	);
	for (const p of problems) console.error(`  ${p}`);
	process.exit(1);
}
console.log(`ui-check: ${files.length} files follow the UI rules ✓`);
