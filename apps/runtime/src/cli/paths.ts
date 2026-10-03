import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Where companies live: `$JAMOT_HOME` (default ~/.jamot), one folder each. */
export function jamotHome(): string {
	return resolve(process.env.JAMOT_HOME ?? join(homedir(), ".jamot"));
}

/** The companies in a JAMOT_HOME: the folders that hold a company.db. */
export function companiesIn(home: string): string[] {
	if (!existsSync(home)) return [];
	return readdirSync(home, { withFileTypes: true })
		.filter(
			(d) => d.isDirectory() && existsSync(join(home, d.name, "company.db")),
		)
		.map((d) => d.name)
		.sort();
}

/**
 * The company folder a command works on: `--data <dir>`, else `--company <id>`
 * under JAMOT_HOME, else the only company there is.
 */
export function companyDir(opts: { data?: string; company?: string }): string {
	if (opts.data) return resolve(opts.data);
	const home = jamotHome();
	if (opts.company) {
		const dir = join(home, opts.company);
		if (existsSync(join(dir, "company.db"))) return dir;
		const there = companiesIn(home);
		throw new Error(
			`no company "${opts.company}" in ${home}${there.length ? ` — there is ${there.join(", ")}` : " yet — run `jamot setup`"}`,
		);
	}
	const companies = companiesIn(home);
	if (companies.length === 1) return join(home, companies[0] as string);
	if (companies.length === 0)
		throw new Error(`no company in ${home} yet — run \`jamot setup\``);
	throw new Error(
		`there are several companies in ${home} (${companies.join(", ")}) — pick one with --company <id>`,
	);
}

/** The first of these that exists: next to the bundle, or in the source tree. */
function firstExisting(candidates: string[]): string | null {
	return candidates.find((c) => existsSync(c)) ?? null;
}

const here = fileURLToPath(new URL(".", import.meta.url));

export function templatesDir(): string {
	const dir = firstExisting(
		[
			process.env.JAMOT_TEMPLATES ?? "",
			join(here, "templates"),
			join(here, "../../../../templates"),
		].filter(Boolean),
	);
	if (!dir)
		throw new Error("the company templates are missing from this install");
	return dir;
}

export function webRoot(): string | undefined {
	return (
		firstExisting(
			[
				process.env.JAMOT_WEB ?? "",
				join(here, "web"),
				join(here, "../../../web/dist"),
			].filter(Boolean),
		) ?? undefined
	);
}
