import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCompanyFile } from "@jamot/company-file";
import type { CompanyFile } from "@jamot/contracts";
import { openCompanyStore } from "@jamot/sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { exportCompanyFile, importCompanyFile } from "../index.js";

const TEMPLATES = fileURLToPath(
	new URL("../../../../templates", import.meta.url),
);
const templateFiles = readdirSync(TEMPLATES).filter((f) => f.endsWith(".yaml"));

function template(name: string): CompanyFile {
	const result = parseCompanyFile(readFileSync(join(TEMPLATES, name), "utf8"));
	if (!result.ok) throw new Error(result.errors.join("\n"));
	return result.file;
}

const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("company import and export", () => {
	it.each(templateFiles)(
		"%s survives import → export unchanged",
		async (name) => {
			const file = template(name);
			const store = openCompanyStore(":memory:").graph;
			await importCompanyFile(store, file);
			expect(await exportCompanyFile(store)).toEqual(file);
		},
	);

	it("moves to another machine: import, close, reopen the file, export", async () => {
		const dir = mkdtempSync(join(tmpdir(), "jamot-company-"));
		dirs.push(dir);
		const file = template("bali-cafe.yaml");

		const first = openCompanyStore(join(dir, "company.db"));
		await importCompanyFile(first.graph, file);
		first.close();

		const reopened = openCompanyStore(join(dir, "company.db"));
		const exported = await exportCompanyFile(reopened.graph);
		reopened.close();
		expect(exported).toEqual(file);
		expect(exported.company.timezone).toBe("Asia/Makassar");
	});

	it("exports data too: a backup of a running company opens elsewhere with its memory", async () => {
		const dir = mkdtempSync(join(tmpdir(), "jamot-backup-"));
		dirs.push(dir);
		const live = openCompanyStore(join(dir, "company.db"));
		await importCompanyFile(live.graph, template("restaurant.yaml"));
		const rossi = await live.people.create({ displayName: "Mrs. Rossi" });
		await live.memory.store({
			scope: "person",
			ownerId: rossi.id,
			kind: "preference",
			content: "Gluten-free",
			source: "conversation",
		});

		await live.backup(join(dir, "copy.db"));
		await live.people.create({ displayName: "Arrived after the backup" });
		live.close();

		const copy = openCompanyStore(join(dir, "copy.db"));
		expect(await exportCompanyFile(copy.graph)).toEqual(
			template("restaurant.yaml"),
		);
		expect((await copy.people.list()).map((p) => p.displayName)).toEqual([
			"Mrs. Rossi",
		]);
		expect((await copy.memory.search("gluten")).map((m) => m.ownerId)).toEqual([
			rossi.id,
		]);
		copy.close();
	});

	it("puts the person starting the company on the founder node", async () => {
		const store = openCompanyStore(":memory:").graph;
		await importCompanyFile(store, template("restaurant.yaml"), {
			founder: { refId: "person-1", name: "Andrea" },
		});
		const founder = (await store.listNodes()).find((n) => n.key === "founder");
		expect(founder).toMatchObject({
			kind: "human",
			name: "Andrea",
			refId: "person-1",
		});
		expect((await store.getCompany())?.founderKey).toBe("founder");
	});

	it("keeps the Dream on its own node, first in the graph", async () => {
		const store = openCompanyStore(":memory:").graph;
		const file = template("organic-farm.yaml");
		await importCompanyFile(store, file);
		const [first] = await store.listNodes();
		expect(first).toMatchObject({
			key: "dream",
			kind: "dream",
			config: file.dream,
		});
	});

	it("never lands on top of an existing company, and leaves it intact", async () => {
		const store = openCompanyStore(":memory:").graph;
		await importCompanyFile(store, template("restaurant.yaml"));
		await expect(
			importCompanyFile(store, template("organic-farm.yaml")),
		).rejects.toThrow(/already holds a company/);
		expect((await store.getCompany())?.id).toBe("restaurant");
		expect(await store.listNodes()).toHaveLength(
			template("restaurant.yaml").nodes.length + 1,
		);
	});
});
