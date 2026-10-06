import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCompanyFile } from "@jamot/company-file";
import type { CompanyStore } from "@jamot/ports";
import { openCompanyStore } from "@jamot/sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentError } from "../agents/manage.js";
import { importCompanyFile } from "../company/import.js";
import type { Notifier } from "../heartbeats/notify.js";
import {
	contributionsView,
	decideContribution,
	giveReward,
	ledgerText,
	recordContribution,
} from "./contributions.js";
import { handOver } from "./drops.js";
import { acceptInvite, createRoleInvite, decideInvite } from "./invites.js";
import { STEWARDS_LAST_SEEN } from "./keys.js";
import { addSteward, setStewardResponsibilities } from "./stewards.js";

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

const refusal = (p: Promise<unknown>) =>
	p.then(
		() => "no refusal",
		(err: unknown) =>
			err instanceof AgentError ? err.message : `unexpected: ${String(err)}`,
	);
async function join(name: string, role: string) {
	const { code } = await createRoleInvite(store, role, "owner");
	const accepted = await acceptInvite(store, code, {
		userId: name,
		chatId: name,
		name,
	});
	await decideInvite(store, accepted?.invite.id ?? "", true, "owner");
	return name.toLowerCase();
}

describe("the contribution record (D54)", () => {
	it("records joining, taking on a role, and confirmed /did work", async () => {
		const nadya = await join("Nadya", "r-chef");
		await addSteward(store, { name: "Rio" }, "owner");
		await setStewardResponsibilities(store, "rio", ["r-floor"], "owner");
		const { id, message } = await recordContribution(
			store,
			{ nodeKey: nadya, what: "Wrote the opening menu" },
			"Nadya",
			false,
		);
		expect(message).toBe(
			"Noted. The founder will confirm it: Wrote the opening menu",
		);

		let view = await contributionsView(store);
		expect(
			view.contributions.map((c) => [c.who.name, c.what, c.status]),
		).toEqual(
			expect.arrayContaining([
				["Nadya", "Joined, taking on Head chef", "confirmed"],
				["Rio", "Took on Floor manager", "confirmed"],
				["Nadya", "Wrote the opening menu", "claimed"],
			]),
		);

		expect((await decideContribution(store, id, true, "owner")).message).toBe(
			"Confirmed for Nadya: Wrote the opening menu",
		);
		expect(await refusal(decideContribution(store, id, false, "o"))).toBe(
			"That one is already decided.",
		);
		const own = await recordContribution(
			store,
			{ nodeKey: nadya, what: "Covered a shift" },
			"Nadya",
			false,
		);
		// An acting successor doesn't confirm their own.
		expect(
			await refusal(decideContribution(store, own.id, true, "Nadya", nadya)),
		).toBe("That's your own: the founder decides it.");
		view = await contributionsView(store);
		expect(view.contributions.find((c) => c.id === id)?.status).toBe(
			"confirmed",
		);
		expect(view.experiment).toMatchObject({
			invited: 1,
			joined: 1,
			firstWorkIn2Weeks: 1,
			peopleContributions30d: 3,
		});
	});

	it("keeps declined claims off a person's own record", async () => {
		const nadya = await join("Nadya", "r-chef");
		const { id } = await recordContribution(
			store,
			{ nodeKey: nadya, what: "Fixed the oven" },
			"Nadya",
			false,
		);
		await decideContribution(store, id, false, "owner");
		expect(await ledgerText(store, nadya)).not.toMatch(/oven/);
		expect(
			(await contributionsView(store)).contributions.find((c) => c.id === id)
				?.status,
		).toBe("declined");
	});

	it("records rewards as notes, never payments", async () => {
		const nadya = await join("Nadya", "r-chef");
		expect(
			await giveReward(
				store,
				{ nodeKey: nadya, note: "€50 for the menu" },
				"o",
			),
		).toBe("Recorded a reward for Nadya: €50 for the menu");
		expect((await contributionsView(store)).rewards).toMatchObject([
			{ who: { name: "Nadya" }, note: "€50 for the menu" },
		]);
		expect(await store.ledger.list()).toEqual([]);
		expect(
			await refusal(giveReward(store, { nodeKey: "ghost", note: "x" }, "o")),
		).toBe('There\'s no one "ghost" in the company.');
		expect(
			await refusal(giveReward(store, { nodeKey: nadya, note: "  " }, "o")),
		).toBe("Say the reward in words.");
		expect(
			await refusal(
				recordContribution(
					store,
					{ nodeKey: nadya, what: "x".repeat(281) },
					"o",
					true,
				),
			),
		).toMatch(/^Keep it to 280 characters/);
	});

	it("shows a steward their own record, and the founder everyone's", async () => {
		const nadya = await join("Nadya", "r-chef");
		const rio = await join("Rio", "r-floor");
		await recordContribution(
			store,
			{ nodeKey: rio, what: "Trained the new waiter" },
			"o",
			true,
		);
		await giveReward(store, { nodeKey: rio, note: "A dinner on us" }, "o");
		const mine = await ledgerText(store, nadya);
		expect(mine).toMatch(/^Your record:\n• .* Joined, taking on Head chef/);
		expect(mine).not.toMatch(/Rio|waiter|dinner/);
		const all = await ledgerText(store, null);
		expect(all).toMatch(/Rio: Trained the new waiter/);
		expect(all).toMatch(/Confirmed, per person:\n• Rio: 2\n• Nadya: 1/);
	});

	it("counts the experiment: active after six weeks, roles picked up again", async () => {
		const nadya = await join("Nadya", "r-chef");
		const later = new Date(Date.now() + 50 * 86_400_000);
		let e = (await contributionsView(store, later)).experiment;
		expect(e).toMatchObject({ joinedSixWeeksAgo: 1, activeAfterSixWeeks: 0 });
		await store.settings.set(STEWARDS_LAST_SEEN, {
			[nadya]: new Date(later.getTime() - 86_400_000).toISOString(),
		});
		e = (await contributionsView(store, later)).experiment;
		expect(e.activeAfterSixWeeks).toBe(1);

		const notifier: Notifier = {
			toOwner: async () => true,
			toSuccessor: async () => false,
		};
		await handOver({ store, notifier }, nadya, "they chose");
		e = (await contributionsView(store)).experiment;
		expect(e).toMatchObject({ handedOver: 1, pickedUpAgain: 0 });
		await setStewardResponsibilities(store, "founder", ["r-chef"], "owner");
		e = (await contributionsView(store)).experiment;
		expect(e).toMatchObject({ handedOver: 1, pickedUpAgain: 1 });
	});
});
