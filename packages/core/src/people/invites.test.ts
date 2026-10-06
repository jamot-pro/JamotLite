import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCompanyFile } from "@jamot/company-file";
import type { CompanyStore } from "@jamot/ports";
import { openCompanyStore } from "@jamot/sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentError } from "../agents/manage.js";
import { importCompanyFile } from "../company/import.js";
import {
	acceptInvite,
	createRoleInvite,
	decideInvite,
	INVITES,
	type Invite,
	invitesView,
	onboardingBrief,
} from "./invites.js";
import { setStewardResponsibilities, stewardsView } from "./stewards.js";

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

const nadya = {
	userId: "300",
	chatId: "300",
	name: "Nadya Putri",
	username: "nadya_p",
};
const refusal = (p: Promise<unknown>) =>
	p.then(
		() => "no refusal",
		(err: unknown) =>
			err instanceof AgentError ? err.message : `unexpected: ${String(err)}`,
	);

describe("open roles and invitations (D52)", () => {
	it("invites someone to an open role, and the founder lets them in", async () => {
		const { code, expiresAt } = await createRoleInvite(
			store,
			"r-chef",
			"owner",
		);
		expect(code).toMatch(/^[A-Z2-9]{10}$/);
		expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
		expect(await invitesView(store)).toMatchObject([
			{
				responsibility: { key: "r-chef", name: "Head chef" },
				status: "open",
				candidate: null,
			},
		]);

		// Codes are kept as hashes only.
		expect(JSON.stringify(await store.settings.get(INVITES))).not.toContain(
			code,
		);

		const accepted = await acceptInvite(store, code.toLowerCase(), nadya);
		expect(accepted?.reply).toMatch(/invited you to take on: Head chef/);
		expect(accepted?.reply).toMatch(/You'll hear from me here/);
		expect((await invitesView(store))[0]).toMatchObject({
			status: "waiting",
			candidate: "Nadya Putri",
		});
		// The code works once.
		expect(
			await acceptInvite(store, code, { ...nadya, userId: "301" }),
		).toBeNull();

		const linked: string[] = [];
		const { message } = await decideInvite(
			store,
			(accepted as { invite: Invite }).invite.id,
			true,
			"owner",
			async (_tx, key) => {
				linked.push(key);
			},
		);
		expect(message).toBe(
			"Nadya Putri joined and now owns Head chef. They have their welcome on Telegram.",
		);
		expect(linked).toEqual(["nadya-putri"]);
		const view = await stewardsView(store, { paired: new Set() });
		expect(view.stewards.find((s) => s.key === "nadya-putri")).toMatchObject({
			role: "Head chef",
			telegram: "nadya_p",
			owns: [{ key: "r-chef", name: "Head chef" }],
		});
		expect(view.invites).toEqual([]);
		const [event] = await store.events.list({ type: "invite.approved" });
		expect(event).toMatchObject({ subject: "nadya-putri" });

		expect(
			await refusal(decideInvite(store, accepted?.invite.id ?? "", true, "o")),
		).toBe("Already approved.");
	});

	it("leaves the role open when the founder says no", async () => {
		const { code } = await createRoleInvite(store, "r-floor", "owner");
		const accepted = await acceptInvite(store, code, nadya);
		const { message } = await decideInvite(
			store,
			accepted?.invite.id ?? "",
			false,
			"owner",
		);
		expect(message).toBe("Declined Nadya Putri. The role is still open.");
		const view = await stewardsView(store, { paired: new Set() });
		expect(view.stewards.map((s) => s.key)).toEqual(["founder"]);
		expect(
			view.responsibilities.find((r) => r.key === "r-floor")?.owner,
		).toBeNull();
		expect(view.invites).toEqual([]);
	});

	it("refuses roles that aren't open, and codes that don't work", async () => {
		expect(await refusal(createRoleInvite(store, "r-x", "o"))).toBe(
			'There\'s no responsibility "r-x".',
		);
		await setStewardResponsibilities(store, "founder", ["r-chef"], "o");
		expect(await refusal(createRoleInvite(store, "r-chef", "o"))).toMatch(
			/^Someone already owns Head chef/,
		);
		expect(await acceptInvite(store, "NOTACODE22", nadya)).toBeNull();

		// A role taken after the code was made can't be joined with it.
		const { code } = await createRoleInvite(store, "r-floor", "o");
		await setStewardResponsibilities(
			store,
			"founder",
			["r-chef", "r-floor"],
			"o",
		);
		expect(await acceptInvite(store, code, nadya)).toBeNull();
	});

	it("lets a code expire, and a new code replace an unused one", async () => {
		const first = await createRoleInvite(store, "r-floor", "o");
		const second = await createRoleInvite(store, "r-floor", "o");
		expect(await invitesView(store)).toHaveLength(1);
		expect(await acceptInvite(store, first.code, nadya)).toBeNull();

		const invites =
			(await store.settings.get<Record<string, Invite>>(INVITES)) ?? {};
		for (const inv of Object.values(invites))
			inv.expiresAt = "2020-01-01T00:00:00.000Z";
		await store.settings.set(INVITES, invites);
		expect(await invitesView(store)).toEqual([]);
		expect(await acceptInvite(store, second.code, nadya)).toBeNull();
		// Making a new code clears the expired ones away.
		await createRoleInvite(store, "r-chef", "o");
		expect(Object.keys((await store.settings.get(INVITES)) ?? {})).toHaveLength(
			1,
		);
	});

	it("asks for an answer before a new code while someone is waiting", async () => {
		const { code } = await createRoleInvite(store, "r-floor", "o");
		await acceptInvite(store, code, nadya);
		expect(await refusal(createRoleInvite(store, "r-floor", "o"))).toBe(
			"Nadya Putri is waiting for your answer on Floor manager: say yes or no first.",
		);
	});

	it("welcomes a newcomer with the charter and who's who — never money or customers", async () => {
		const { code } = await createRoleInvite(store, "r-chef", "o");
		const accepted = await acceptInvite(store, code, nadya);
		expect(accepted?.reply).not.toMatch(/€|\$|ledger|customer/i);
		await decideInvite(store, accepted?.invite.id ?? "", true, "o");
		const welcome = await onboardingBrief(store, "nadya-putri");
		expect(welcome).toMatch(
			/^Welcome to .*, Nadya Putri\. You now own Head chef\./,
		);
		expect(welcome).toMatch(/Who's who:/);
		expect(welcome).toMatch(/Still open: /);
		expect(welcome).toMatch(/waits for the founder's yes/);
		expect(welcome).not.toMatch(/€|\$|ledger/i);
	});
});
