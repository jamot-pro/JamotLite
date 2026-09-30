import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCompanyFile, stringifyCompanyFile } from "./index.js";

const TEMPLATES = fileURLToPath(new URL("../../../templates", import.meta.url));
const templateFiles = readdirSync(TEMPLATES).filter((f) => f.endsWith(".yaml"));

function parseOk(text: string) {
	const result = parseCompanyFile(text);
	if (!result.ok) throw new Error(result.errors.join("\n"));
	return result.file;
}

const MINIMAL = `
jamot: 1
company: { id: tiny, name: A tiny company }
dream: { objective: Stay alive }
teams:
  - { key: crew, name: Crew }
responsibilities:
  - { key: r-books, name: Books }
links:
  - crew owns r-books
  - dream requires r-books
`;

describe("company.yaml", () => {
	it("ships the seven company templates", () => {
		expect(templateFiles.sort()).toEqual([
			"bali-cafe.yaml",
			"ecommerce-shop.yaml",
			"electrical-contractor.yaml",
			"montessori-school.yaml",
			"organic-farm.yaml",
			"plumbing-company.yaml",
			"restaurant.yaml",
		]);
	});

	it.each(templateFiles)(
		"%s parses, and writing it back changes nothing",
		(name) => {
			const file = parseOk(readFileSync(join(TEMPLATES, name), "utf8"));
			expect(file.company.id).toBe(name.replace(".yaml", ""));
			expect(parseOk(stringifyCompanyFile(file))).toEqual(file);
		},
	);

	it("fills in defaults a person may leave out", () => {
		const file = parseOk(MINIMAL);
		expect(file.company).toMatchObject({ summary: "", timezone: "UTC" });
		expect(file.dream.outcomes).toEqual([]);
		expect(file.edges).toContainEqual({
			from: "crew",
			relation: "owns",
			to: "r-books",
		});
	});

	it("keeps config that clashes with an item's own fields under config:", () => {
		const file = parseOk(MINIMAL);
		const clash = {
			key: "crew",
			kind: "team" as const,
			name: "Crew",
			config: { name: "shadow", purpose: "x" },
		};
		const text = stringifyCompanyFile({
			...file,
			nodes: [clash, ...file.nodes.slice(1)],
		});
		expect(text).toContain("config:");
		expect(parseOk(text).nodes[0]?.config).toEqual({
			name: "shadow",
			purpose: "x",
		});
	});

	it.each([
		[
			"an unknown relation",
			MINIMAL.replace("crew owns r-books", "crew manages r-books"),
			"links[0]: unknown relation",
		],
		[
			"a link to a missing node",
			MINIMAL.replace("crew owns r-books", "crew owns r-taxes"),
			"links[0]: unknown node 'r-taxes'",
		],
		[
			"a link that isn't three words",
			MINIMAL.replace("crew owns r-books", "crew owns"),
			'links[0]: write it as "from relation to"',
		],
		[
			"a duplicate key",
			MINIMAL.replace("key: r-books", "key: crew"),
			"responsibilities[0].key: duplicate key 'crew'",
		],
		[
			"a bad time zone",
			MINIMAL.replace("A tiny company }", "A tiny company, timezone: Bali }"),
			"company.timezone: not a known IANA time zone",
		],
		["an unknown section", `${MINIMAL}robots: []\n`, "robots: unknown section"],
		[
			"the wrong format",
			MINIMAL.replace("jamot: 1", "jamot: 2"),
			"jamot: expected format 1",
		],
		[
			"a founder who isn't a human",
			`${MINIMAL}founder: crew\n`,
			"founder: founder must be the key of a human node",
		],
	])(
		"explains %s, pointing at the line a person wrote",
		(_case, text, message) => {
			const result = parseCompanyFile(text);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.errors.join("\n")).toContain(message);
		},
	);
});
