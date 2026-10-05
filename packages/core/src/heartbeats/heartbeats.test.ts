import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCompanyFile } from "@jamot/company-file";
import type { CompanyStore } from "@jamot/ports";
import { openCompanyStore } from "@jamot/sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { receiveMessage } from "../channels/intake.js";
import { importCompanyFile } from "../company/import.js";
import { addSteward } from "../people/stewards.js";
import { computeReadiness } from "../readiness/readiness.js";
import { budgetForTier, computeVitals } from "../survival/vitals.js";
import { handleOwnerAction } from "./actions.js";
import {
	type Notifier,
	OWNER_LAST_SEEN,
	type OwnerAction,
	SUCCESSION,
} from "./notify.js";
import { runHeartbeat } from "./run.js";
import { HEARTBEAT_JOB, planHeartbeats } from "./schedule.js";

function template(name: string) {
	const parsed = parseCompanyFile(
		readFileSync(
			fileURLToPath(
				new URL(`../../../../templates/${name}.yaml`, import.meta.url),
			),
			"utf8",
		),
	);
	if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
	return parsed.file;
}

let store: CompanyStore;
let toOwner: { text: string; actions?: OwnerAction[] }[];
let toSuccessor: string[];
let ownerPaired: boolean;
const notifier: Notifier = {
	async toOwner(m) {
		if (!ownerPaired) return false;
		toOwner.push(m);
		return true;
	},
	async toSuccessor(m) {
		toSuccessor.push(m.text);
		return true;
	},
};

beforeEach(async () => {
	store = openCompanyStore(":memory:");
	toOwner = [];
	toSuccessor = [];
	ownerPaired = true;
});
afterEach(() => store.close());

const at = (iso: string) => () => new Date(iso);

describe("readiness", () => {
	it("names every gap in a template, and is covered once they're filled", async () => {
		await importCompanyFile(store.graph, template("restaurant"));
		const graph = {
			nodes: await store.graph.listNodes(),
			edges: await store.graph.listEdges(),
		};
		const report = computeReadiness(graph);
		expect(report.covered).toBe(false);
		expect(
			report.dimensions.find((d) => d.key === "responsibilities")?.missing,
		).toEqual([
			{ key: "r-chef", name: "Head chef" },
			{ key: "r-floor", name: "Floor manager" },
		]);
		expect(report.dimensions.find((d) => d.key === "heartbeats")?.score).toBe(
			1,
		);

		await handleOwnerAction(store, "assign:r-chef:founder", "Lucia");
		await handleOwnerAction(store, "assign:r-floor:founder", "Lucia");
		expect(
			computeReadiness({
				nodes: await store.graph.listNodes(),
				edges: await store.graph.listEdges(),
			}).covered,
		).toBe(true);
	});
});

describe("heartbeat schedules", () => {
	it("runs in the company's time zone: 08:00 in Bali is midnight UTC", async () => {
		await importCompanyFile(store.graph, template("bali-cafe"));
		await planHeartbeats(store, new Date("2026-10-01T23:59:00Z"));
		await planHeartbeats(store, new Date("2026-10-02T00:00:30Z"));
		const pulse = (await store.jobs.list({ kind: HEARTBEAT_JOB })).filter(
			(j) => j.payload.heartbeat === "h-pulse",
		);
		expect(pulse.map((j) => j.runAt)).toEqual(["2026-10-02T00:00:00.000Z"]);
	});

	it("never queues the same run twice, and after downtime only the latest", async () => {
		await importCompanyFile(store.graph, template("plumbing-company"));
		await planHeartbeats(store, new Date("2026-10-01T10:00:10Z"));
		await planHeartbeats(store, new Date("2026-10-01T10:00:40Z"));
		const sweep = () =>
			store.jobs
				.list({ kind: HEARTBEAT_JOB })
				.then((js) => js.filter((j) => j.payload.heartbeat === "h-desk"));
		expect((await sweep()).map((j) => j.runAt)).toEqual([
			"2026-10-01T10:00:00.000Z",
		]);

		// Down for three hours: the every-15-minutes sweep runs once, for the latest slot.
		await planHeartbeats(store, new Date("2026-10-01T13:07:00Z"));
		expect((await sweep()).map((j) => j.runAt)).toEqual([
			"2026-10-01T13:00:00.000Z",
			"2026-10-01T10:00:00.000Z",
		]);
	});

	it("reports a schedule it can't read instead of failing", async () => {
		const file = template("restaurant");
		const node = file.nodes.find((n) => n.key === "h-kitchen");
		if (node) node.config.schedule = "every morning";
		await importCompanyFile(store.graph, file);
		await planHeartbeats(store, new Date());
		expect(
			(await store.events.list({ type: "heartbeat.invalid" })).map(
				(e) => e.subject,
			),
		).toEqual(["h-kitchen"]);
	});
});

describe("a heartbeat run", () => {
	beforeEach(async () => {
		await importCompanyFile(store.graph, template("restaurant"), {
			founder: { refId: "p-lucia", name: "Lucia" },
		});
	});

	it("tells the owner what's missing once, with a one-tap fix, then verifies it", async () => {
		const first = await runHeartbeat(
			{ store, notifier, now: at("2026-10-01T09:00:00Z") },
			"h-pulse",
		);
		expect(first.opened).toEqual(["unowned:r-chef", "unowned:r-floor"]);
		expect(toOwner[0]?.text).toContain("Nobody owns “Head chef”");
		expect(toOwner[0]?.actions).toContainEqual({
			label: "I'll take “Head chef”",
			action: "assign:r-chef:founder",
		});

		// An hour later: nothing new, so no message.
		await runHeartbeat(
			{ store, notifier, now: at("2026-10-01T10:00:00Z") },
			"h-pulse",
		);
		expect(toOwner).toHaveLength(1);

		// The owner taps the button; the next run reports it fixed.
		expect(
			await handleOwnerAction(store, "assign:r-chef:founder", "Lucia"),
		).toBe("Done — Lucia now owns “Head chef”.");
		const third = await runHeartbeat(
			{ store, notifier, now: at("2026-10-01T11:00:00Z") },
			"h-pulse",
		);
		expect(third.resolved).toEqual(["unowned:r-chef"]);
		expect(toOwner[1]?.text).toContain("✅ Nobody owns “Head chef”");

		// A day later, what's still open gets a reminder.
		await runHeartbeat(
			{ store, notifier, now: at("2026-10-02T09:30:00Z") },
			"h-pulse",
		);
		expect(toOwner[2]?.text).toContain(
			"Nobody owns “Floor manager” (reminder)",
		);
	});

	it("keeps trying when no owner is paired yet", async () => {
		ownerPaired = false;
		await runHeartbeat(
			{ store, notifier, now: at("2026-10-01T09:00:00Z") },
			"h-pulse",
		);
		expect(
			(await store.events.list({ type: "heartbeat.unrouted" })).length,
		).toBe(1);
		ownerPaired = true;
		await runHeartbeat(
			{ store, notifier, now: at("2026-10-01T09:15:00Z") },
			"h-pulse",
		);
		expect(toOwner[0]?.text).toContain("Nobody owns “Head chef”");
	});

	it("notices a team with nobody in it", async () => {
		const run = await runHeartbeat(
			{ store, notifier, now: at("2026-10-01T10:00:00Z") },
			"h-kitchen",
		);
		expect(run.issues.map((i) => i.title)).toEqual(["Nobody is in Kitchen"]);
	});

	it("tells a team's linked stewards about their team's heartbeat (D48)", async () => {
		const told: [string[], string][] = [];
		const withMembers: Notifier = {
			...notifier,
			async toMembers(keys, m) {
				told.push([keys, m.text]);
				return keys.length;
			},
		};
		const deps = { store, notifier: withMembers };
		await runHeartbeat(
			{ ...deps, now: at("2026-10-01T10:00:00Z") },
			"h-kitchen",
		);
		// Nobody in the kitchen yet: only the owner hears.
		expect(told).toEqual([]);
		const { key } = await addSteward(
			store,
			{ name: "Citra", teamKey: "kitchen" },
			"owner",
		);
		await runHeartbeat(
			{ ...deps, now: at("2026-10-01T10:30:00Z") },
			"h-kitchen",
		);
		expect(told).toHaveLength(1);
		expect(told[0]?.[0]).toEqual([key]);
		expect(told[0]?.[1]).toContain("✅ Nobody is in Kitchen");
	});

	it("notices a customer waiting too long for an answer", async () => {
		await receiveMessage(store, {
			channel: "telegram",
			threadId: "9",
			messageId: "1",
			from: { userId: "9", displayName: "Rossi" },
			text: "Hello?",
			at: "2026-10-01T08:00:00.000Z",
		});
		const run = await runHeartbeat(
			{ store, notifier, now: at("2026-10-01T09:00:00Z") },
			"h-pulse",
		);
		expect(run.issues.map((i) => i.title)).toContain(
			"Rossi has been waiting for an answer since 08:00 UTC",
		);
	});
});

describe("survival", () => {
	beforeEach(async () => {
		await importCompanyFile(store.graph, template("restaurant"), {
			founder: { refId: "p-lucia", name: "Lucia" },
		});
	});

	it("measures runway from the ledger, and says unknown rather than healthy", async () => {
		expect((await computeVitals(store)).money).toMatchObject({
			currency: null,
			runwayDays: null,
		});
		expect((await computeVitals(store)).tier).toBe("normal");

		const now = new Date("2026-10-01T09:00:00Z");
		await store.ledger.post([
			{
				currency: "EUR",
				amountMinor: 1_000_000,
				description: "savings",
				occurredAt: "2026-08-01T00:00:00Z",
			},
			{
				currency: "EUR",
				amountMinor: -600_000,
				description: "rent and food",
				occurredAt: "2026-09-15T00:00:00Z",
			},
		]);
		const v = await computeVitals(store, { now });
		expect(v.money).toMatchObject({
			currency: "EUR",
			balance: 400_000,
			dailyBurn: 20_000,
			runwayDays: 20,
		});
		expect(v.tier).toBe("low_funding");
		expect(budgetForTier(v.tier)).toEqual({
			maxCostMicroUsd: 20_000,
			maxTurns: 6,
		});
	});

	it("records the tier only when it changes, and raises it with the owner", async () => {
		await store.ledger.post([
			{
				currency: "EUR",
				amountMinor: 100_000,
				description: "cash",
				occurredAt: "2026-09-01T00:00:00Z",
			},
			{
				currency: "EUR",
				amountMinor: -90_000,
				description: "spend",
				occurredAt: "2026-09-20T00:00:00Z",
			},
		]);
		const now = at("2026-10-01T09:00:00Z");
		const run = await runHeartbeat({ store, notifier, now }, "h-pulse");
		await runHeartbeat({ store, notifier, now }, "h-pulse");
		expect(run.issues.map((i) => i.key)).toContain("money:critical");
		expect(await store.settings.get("survival.tier")).toBe("critical");
		expect(
			await store.events.list({ type: "survival.tier_changed" }),
		).toHaveLength(1);
	});

	it("hands over to the successor when the owner goes silent, and back when they return", async () => {
		await store.settings.set(OWNER_LAST_SEEN, "2026-09-01T09:00:00.000Z");
		await runHeartbeat(
			{ store, notifier, now: at("2026-10-01T09:00:00Z") },
			"h-pulse",
		);
		expect(toSuccessor[0]).toContain(
			"the owner has been silent since 2026-09-01",
		);
		expect(await store.settings.get(SUCCESSION)).not.toBeNull();

		await runHeartbeat(
			{ store, notifier, now: at("2026-10-02T09:00:00Z") },
			"h-pulse",
		);
		expect(toSuccessor).toHaveLength(1);

		await store.settings.set(OWNER_LAST_SEEN, "2026-10-02T12:00:00.000Z");
		await runHeartbeat(
			{ store, notifier, now: at("2026-10-03T09:00:00Z") },
			"h-pulse",
		);
		expect(toSuccessor[1]).toContain("the owner is back");
		expect(await store.settings.get(SUCCESSION)).toBeNull();
	});
});

describe("owner actions", () => {
	it("won't give a responsibility a second owner", async () => {
		await importCompanyFile(store.graph, template("restaurant"));
		expect(await handleOwnerAction(store, "assign:r-rota:host", "Lucia")).toBe(
			"“Staff rota” is already owned by Founder.",
		);
		expect(
			await handleOwnerAction(store, "assign:r-nope:founder", "Lucia"),
		).toBe("That's no longer in the company map.");
	});
});
