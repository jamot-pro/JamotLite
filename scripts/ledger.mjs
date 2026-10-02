// Lists merged pull requests that have no line in CONTRIBUTIONS.md yet, as
// draft ledger lines to check and paste (STEWARDS.md, "The ledger"). Reads
// GitHub through the `gh` CLI, so it sees exactly what you can see.
//
//   pnpm ledger            this repository
//   pnpm ledger <owner/repo>  another one (e.g. jamot-pro/J-Nesys)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = process.argv[2];
const ledger = readFileSync(join(root, "CONTRIBUTIONS.md"), "utf8");

let merged;
try {
	merged = JSON.parse(
		execFileSync(
			"gh",
			[
				"pr",
				"list",
				"--state",
				"merged",
				"--limit",
				"200",
				"--json",
				"number,title,author,mergedAt,url",
				...(repo ? ["--repo", repo] : []),
			],
			{ cwd: root, encoding: "utf8" },
		),
	);
} catch {
	console.error(
		"Couldn't list pull requests — is the GitHub CLI installed and signed in (`gh auth status`)?",
	);
	process.exit(1);
}

// A pull request is recorded when its URL, or "#<number>" for this repo, is in
// the ledger's evidence column.
const recorded = (pr) =>
	ledger.includes(pr.url) || (!repo && ledger.includes(`#${pr.number}]`));
const missing = merged
	.filter((pr) => !recorded(pr))
	.sort((a, b) => a.mergedAt.localeCompare(b.mergedAt));

if (missing.length === 0) {
	console.log("Every merged pull request has a ledger line.");
	process.exit(0);
}
console.log(
	`${missing.length} merged pull request(s) without a ledger line. Check each, fill in the responsibility and kind, and add it to CONTRIBUTIONS.md with the next numbers:\n`,
);
for (const pr of missing) {
	const date = pr.mergedAt.slice(0, 10);
	const title = pr.title.replace(/\|/g, "/");
	console.log(
		`| ? | ${date} | @${pr.author.login} | ? | build | ${title} | [#${pr.number}](${pr.url}) | ? |`,
	);
}
