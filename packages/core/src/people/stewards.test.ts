import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCompanyFile } from "@jamot/company-file";
import type { CompanyStore } from "@jamot/ports";
import { openCompanyStore } from "@jamot/sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentError, retireMember } from "../agents/manage.js";
import { importCompanyFile } from "../company/import.js";
import {
	addSteward,
	setStewardResponsibilities,
	stewardsView,
	updateSteward,
} from "./stewards.js";

let store: CompanyStore;
beforeEach(async () => {
	store = openCompanyStore(":memory:");
	const parsed = parseCompanyFile(
		readFileSync(
			fileURLToPath(
				new URL("../../../../templates/restaurant.yaml", import.meta.url),
			),
			"utf8",
		),
	);
	if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
	await importCompanyFile(store.graph, parsed.file);
});
afterEach(() => store.close());

const view = (paired: string[] = []) =>
	stewardsView(store, { paired: new Set(paired) });
const steward = async (key: string) =>
	(await view()).stewards.find((s) => s.key === key);
const refusal = (p: Promise<unknown>) =>
	p.then(
		() => "no refusal",
		(err: unknown) =>
			err instanceof AgentError ? err.message : `unexpected: ${String(err)}`,
	);

describe("the Stewards page", () => {
	it("shows the people who run the company, and what everyone owns", async () => {
		const v = await view(["founder"]);
		expect(v.stewards.map((s) => s.key)).toEqual(["founder"]);
		expect(v.stewards[0]).toMatchObject({
			name: "Founder",
			founder: true,
			paired: true,
			connections: 0,
			teams: [{ key: "office", name: "Office" }],
		});
		const chef = v.responsibilities.find((r) => r.key === "r-chef");
		expect(chef).toEqual({ key: "r-chef", name: "Head chef", owner: null });
	});

	it("adds a steward with their handles and team", async () => {
		const { key, message } = await addSteward(
			store,
			{
				name: "Nadya Putri",
				role: "Floor manager",
				telegram: "@nadya_p",
				github: "nadyaputri",
				teamKey: "floor",
			},
			"the owner (console)",
		);
		expect(key).toBe("nadya-putri");
		expect(message).toMatch(/^Added Nadya Putri\./);
		expect(await steward(key)).toMatchObject({
			role: "Floor manager",
			telegram: "nadya_p",
			github: "nadyaputri",
			teams: [{ key: "floor", name: "Floor" }],
			founder: false,
			paired: false,
		});
		const [event] = await store.events.list({ type: "steward.added" });
		expect(event).toMatchObject({ subject: key });
	});

	it("refuses handles and fields it can't keep", async () => {
		expect(
			await refusal(
				addSteward(store, { name: "X", telegram: "not a handle!" }, "o"),
			),
		).toMatch(/^That Telegram handle doesn't look right/);
		expect(await refusal(addSteward(store, { name: "  " }, "o"))).toBe(
			"Give the person a name.",
		);
		expect(
			await refusal(
				updateSteward(
					store,
					"founder",
					{ github: 7 as unknown as string },
					"o",
				),
			),
		).toBe("The github must be text.");
	});

	it("gives responsibilities, moves them, and lets them go", async () => {
		const { key } = await addSteward(store, { name: "Citra" }, "owner");
		expect(
			await setStewardResponsibilities(
				store,
				key,
				["r-chef", "r-reservations"],
				"owner",
			),
		).toBe("Citra now owns Head chef, Reservations and messages.");
		expect(
			(await view()).responsibilities.find((r) => r.key === "r-reservations")
				?.owner,
		).toEqual({ key, name: "Citra" });

		expect(
			await setStewardResponsibilities(store, key, ["r-chef"], "owner"),
		).toBe("Reservations and messages now has no owner.");
		expect(
			(await view()).responsibilities.find((r) => r.key === "r-reservations")
				?.owner,
		).toBeNull();
		expect(
			await refusal(setStewardResponsibilities(store, key, ["r-x"], "o")),
		).toBe('There\'s no responsibility "r-x".');
	});

	it("retires a steward, never the founder", async () => {
		const { key } = await addSteward(store, { name: "Backend Papa" }, "owner");
		await setStewardResponsibilities(store, key, ["r-chef"], "owner");
		expect(await retireMember(store, "human", key, "owner")).toBe(
			"Retired Backend Papa. Head chef now has no owner.",
		);
		const v = await view();
		expect(v.stewards.map((s) => s.key)).toEqual(["founder"]);
		expect(v.retired).toMatchObject([{ key, name: "Backend Papa" }]);
		expect(await refusal(retireMember(store, "human", "founder", "o"))).toBe(
			"Founder founded the company and stays in it. Name a successor in Settings instead.",
		);
	});
});
