import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCompanyFile } from "@jamot/company-file";
import type { CompanyStore } from "@jamot/ports";
import { openCompanyStore } from "@jamot/sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importCompanyFile } from "../company/import.js";
import type { Notifier, OwnerAction } from "../heartbeats/notify.js";
import {
	answerCheckin,
	CHECKINS,
	checkDroppedRoles,
	DROP_SETTINGS,
	noteStewardActivity,
} from "./drops.js";
import {
	addSteward,
	setStewardResponsibilities,
	stewardsView,
} from "./stewards.js";

let store: CompanyStore;
let toOwner: string[];
let toMember: { key: string; text: string; actions?: OwnerAction[] }[];
let linked: Set<string>;
const notifier: Notifier = {
	toOwner: async (m) => {
		toOwner.push(m.text);
		return true;
	},
	toSuccessor: async () => false,
	toMember: async (key, m) => {
		if (!linked.has(key)) return false;
		toMember.push({ key, ...m });
		return true;
	},
};
const deps = () => ({ store, notifier });
const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n, 9));
const owns = async (key: string) =>
	(await stewardsView(store, { paired: new Set() })).stewards
		.find((s) => s.key === key)
		?.owns.map((r) => r.key);

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
	toOwner = [];
	toMember = [];
	linked = new Set(["nadya"]);
	await addSteward(store, { name: "Nadya" }, "owner");
	await setStewardResponsibilities(store, "nadya", ["r-chef", "r-floor"], "o");
});
afterEach(() => store.close());

describe("noticing a dropped role (D53)", () => {
	it("checks in kindly after two quiet weeks, once", async () => {
		await checkDroppedRoles(deps(), day(0)); // the clock starts
		await checkDroppedRoles(deps(), day(13));
		expect(toMember).toEqual([]);
		await checkDroppedRoles(deps(), day(14));
		expect(toMember).toMatchObject([
			{
				key: "nadya",
				text: expect.stringMatching(
					/^Hi Nadya, it's been a while .* You own Head chef, Floor manager\./,
				),
				actions: [
					{ action: "still:nadya" },
					{ action: "handover:nadya" },
					{ action: "pause:nadya" },
				],
			},
		]);
		await checkDroppedRoles(deps(), day(15));
		expect(toMember).toHaveLength(1);
		// The founder is never checked here: succession covers them (D22).
		expect(toMember.map((m) => m.key)).not.toContain("founder");
	});

	it("opens their roles when there's no answer, and tells the founder who could take them", async () => {
		await addSteward(store, { name: "Rio" }, "owner");
		await checkDroppedRoles(deps(), day(0));
		await checkDroppedRoles(deps(), day(14));
		await checkDroppedRoles(deps(), day(20));
		expect(await owns("nadya")).toEqual(["r-chef", "r-floor"]);
		await checkDroppedRoles(deps(), day(21));
		expect(await owns("nadya")).toEqual([]);
		expect(toOwner).toEqual([
			expect.stringMatching(
				/^🕯 Nadya has been quiet .* opened their roles: Head chef, Floor manager\.\nWho could take them: Rio \(owns nothing yet\)\.\nOr invite someone/,
			),
		]);
		// Nadya is still in the company; it happens once.
		expect(
			(await stewardsView(store, { paired: new Set() })).stewards.map(
				(s) => s.key,
			),
		).toContain("nadya");
		await checkDroppedRoles(deps(), day(40));
		expect(toOwner).toHaveLength(1);
	});

	it("starts over when they're back, or given a role again", async () => {
		await checkDroppedRoles(deps(), day(0));
		await checkDroppedRoles(deps(), day(14));
		await noteStewardActivity(store, "nadya", day(16));
		await checkDroppedRoles(deps(), day(25));
		expect(await owns("nadya")).toEqual(["r-chef", "r-floor"]);
		expect(await store.settings.get(CHECKINS)).toEqual({});
	});

	it("never releases someone it can't reach", async () => {
		linked = new Set();
		await checkDroppedRoles(deps(), day(0));
		await checkDroppedRoles(deps(), day(60));
		await checkDroppedRoles(deps(), day(90));
		expect(await owns("nadya")).toEqual(["r-chef", "r-floor"]);
		expect(toOwner).toEqual([]);
	});

	it("follows the company's own timing", async () => {
		await store.settings.set(DROP_SETTINGS, { quietDays: 3, graceDays: 1 });
		await checkDroppedRoles(deps(), day(0));
		await checkDroppedRoles(deps(), day(3));
		expect(toMember).toHaveLength(1);
		await checkDroppedRoles(deps(), day(4));
		expect(await owns("nadya")).toEqual([]);
	});

	describe("their answer", () => {
		beforeEach(async () => {
			await checkDroppedRoles(deps(), day(0));
			await checkDroppedRoles(deps(), day(14));
		});

		it("still on it: nothing changes", async () => {
			expect(await answerCheckin(deps(), "nadya", "still", day(15))).toBe(
				"Thanks, good to hear. Nothing changes.",
			);
			await checkDroppedRoles(deps(), day(25));
			expect(await owns("nadya")).toEqual(["r-chef", "r-floor"]);
		});

		it("hand it over: the roles open now, with thanks", async () => {
			expect(await answerCheckin(deps(), "nadya", "handover", day(15))).toMatch(
				/^Thank you for everything you did for Head chef, Floor manager\. It's open now/,
			);
			expect(await owns("nadya")).toEqual([]);
			expect(toOwner).toEqual([
				expect.stringMatching(
					/^🤝 Nadya handed over Head chef, Floor manager\./,
				),
			]);
			const [event] = await store.events.list({ type: "steward.handed_over" });
			expect(event).toMatchObject({
				subject: "nadya",
				data: { why: "they chose" },
			});
		});

		it("pause: no check-ins for two weeks, roles stay theirs", async () => {
			expect(await answerCheckin(deps(), "nadya", "pause", day(15))).toMatch(
				/^Enjoy the break\. I'll check in again after 2026-10-30/,
			);
			expect(toOwner).toEqual([
				"⏸ Nadya is pausing until 2026-10-30; they still own Head chef, Floor manager.",
			]);
			await checkDroppedRoles(deps(), day(28));
			expect(await owns("nadya")).toEqual(["r-chef", "r-floor"]);
			expect(toMember).toHaveLength(1);
			// Quiet two more weeks after the pause: asked again.
			await checkDroppedRoles(deps(), day(43));
			expect(toMember).toHaveLength(2);
		});
	});
});
