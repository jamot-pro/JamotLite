import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCompanyFile } from "@jamot/company-file";
import type { CompanyStore } from "@jamot/ports";
import { openCompanyStore } from "@jamot/sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportCompanyFile } from "../company/export.js";
import { importCompanyFile } from "../company/import.js";
import { addConnection, authenticateMcp } from "../connections/connections.js";
import { grantConnection, refreshConnection } from "../connections/oauth.js";
import { computeReadiness } from "../readiness/readiness.js";
import {
	AgentError,
	addAgent,
	agentsView,
	retireAgent,
	setAgentTools,
	updateAgent,
} from "./manage.js";
import { pickChannelAgent } from "./spec.js";

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

const channels = [{ id: "telegram", label: "Telegram" }];
const view = () => agentsView(store, { channels });
const agent = async (key: string) =>
	(await view()).agents.find((a) => a.key === key);
const refusal = (p: Promise<unknown>) =>
	p.then(
		() => "no refusal",
		(err: unknown) =>
			err instanceof AgentError ? err.message : `unexpected: ${String(err)}`,
	);

describe("the Agents page's view", () => {
	it("shows each agent: what it does, where, with what, and what it answers", async () => {
		const v = await view();
		expect(v.agents.map((a) => a.key)).toEqual(["host", "buyer"]);
		const host = v.agents[0];
		expect(host).toMatchObject({
			name: "Host",
			role: "Takes reservations and messages",
			answers: ["Telegram"],
			runs30d: { runs: 0, costMicroUsd: 0 },
			lastRunAt: null,
			connections: 0,
		});
		expect(host?.instructions).toContain("Answer reservation requests");
		expect(v.tools.map((t) => t.key)).toEqual([
			"t-telegram",
			"t-bookings",
			"t-pos",
		]);
		expect(v.tools[0]?.approval).toMatch(/Not connected to a system yet/);
		expect(v.limits.instructions).toBe(8_000);
		expect(v.retired).toEqual([]);
	});
});

describe("changing an agent", () => {
	it("saves its name, role and instructions, and records who did it", async () => {
		const message = await updateAgent(
			store,
			"host",
			{
				name: "Front of house",
				instructions: "  Greet every guest by name.  ",
			},
			"the owner (console)",
		);
		expect(message).toBe(
			"Saved Front of house. It works with the new instructions from its next run.",
		);
		const host = await agent("host");
		expect(host).toMatchObject({
			name: "Front of house",
			instructions: "Greet every guest by name.",
			role: "Takes reservations and messages",
		});
		const [event] = await store.events.list({ type: "agent.updated" });
		expect(event).toMatchObject({
			subject: "host",
			data: { by: "the owner (console)", changed: ["instructions", "name"] },
		});
		expect(
			await updateAgent(store, "host", { name: "Front of house" }, "x"),
		).toBe("Nothing changed.");
	});

	it("moves it to another team, or none", async () => {
		await updateAgent(store, "host", { teamKey: "kitchen" }, "owner");
		expect((await agent("host"))?.teams).toEqual([
			{ key: "kitchen", name: "Kitchen" },
		]);
		await updateAgent(store, "host", { teamKey: null }, "owner");
		expect((await agent("host"))?.teams).toEqual([]);
	});

	it("refuses what it can't keep, with a sentence", async () => {
		expect(await refusal(updateAgent(store, "host", { name: " " }, "o"))).toBe(
			"Give the agent a name.",
		);
		expect(
			await refusal(
				updateAgent(store, "host", { instructions: "x".repeat(8_001) }, "o"),
			),
		).toBe("Instructions are at most 8000 characters.");
		expect(
			await refusal(updateAgent(store, "host", { teamKey: "nowhere" }, "o")),
		).toBe('There\'s no team "nowhere".');
		expect(
			await refusal(
				updateAgent(store, "host", { name: 42 as unknown as string }, "o"),
			),
		).toBe("The name must be text.");
		expect(await refusal(updateAgent(store, "ghost", { name: "G" }, "o"))).toBe(
			'There\'s no agent "ghost" any more.',
		);
	});

	it("sets the tools it uses itself", async () => {
		await setAgentTools(store, "buyer", ["t-pos", "t-bookings"], "owner");
		expect((await agent("buyer"))?.tools.sort()).toEqual([
			"t-bookings",
			"t-pos",
		]);
		await setAgentTools(store, "buyer", [], "owner");
		expect((await agent("buyer"))?.tools).toEqual([]);
		const events = await store.events.list({ type: "agent.tools_changed" });
		expect(events.length).toBeGreaterThanOrEqual(1);
		expect(
			await refusal(setAgentTools(store, "buyer", ["t-nothing"], "o")),
		).toBe('There\'s no tool "t-nothing".');
	});
});

describe("adding and retiring agents", () => {
	it("adds an agent with a key of its own", async () => {
		const first = await addAgent(
			store,
			{ name: "Host", role: "Evenings", teamKey: "floor" },
			"owner",
		);
		expect(first.key).toBe("host-2");
		expect(await agent("host-2")).toMatchObject({
			name: "Host",
			role: "Evenings",
			teams: [{ key: "floor", name: "Floor" }],
		});
		expect((await addAgent(store, { name: "Rosé & Co." }, "owner")).key).toBe(
			"rose-co",
		);
	});

	it("retires an agent: it answers, owns and connects no more, and isn't exported", async () => {
		const { token } = await addConnection(store, { nodeKey: "host" });
		await retireAgent(store, "host", "owner");

		const v = await view();
		expect(v.agents.map((a) => a.key)).toEqual(["buyer"]);
		expect(v.retired).toMatchObject([{ key: "host", name: "Host" }]);
		const nodes = await store.graph.listNodes();
		const edges = await store.graph.listEdges();
		expect(pickChannelAgent(nodes, edges, "telegram")?.key).toBe("buyer");
		expect(await authenticateMcp(store, token, "shared")).toBeNull();
		// A sign-in's refresh token stops working when its agent retires.
		const granted = await grantConnection(store, {
			nodeKey: "buyer",
			access: "company",
			client: { id: "dcr_x", name: "Claude", host: "claude.ai" },
		});
		await addAgent(store, { name: "Spare" }, "owner");
		await retireAgent(store, "buyer", "owner");
		await expect(
			refreshConnection(store, granted.refresh_token, "dcr_x"),
		).rejects.toThrow("that refresh token doesn't work");
		await expect(addConnection(store, { nodeKey: "host" })).rejects.toThrow();
		const file = await exportCompanyFile(store.graph);
		expect(
			file.nodes.filter((n) => n.kind === "agent").map((n) => n.key),
		).toEqual(["spare"]);
		expect(computeReadiness({ nodes, edges }).covered).toBe(false);
		expect(await store.events.list({ type: "agent.retired" })).toHaveLength(2);

		// A company keeps one agent.
		expect(await refusal(retireAgent(store, "spare", "owner"))).toBe(
			"Spare is the company's only agent: add another before retiring it.",
		);
	});
});
