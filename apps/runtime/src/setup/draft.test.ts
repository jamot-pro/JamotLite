import { describe, expect, it } from "vitest";
import { listTemplates } from "../cli/commands.js";
import { buildCompany, LIMITS, type Plan } from "./draft.js";

const answers = {
	name: "Sunrise Bakery",
	founder: "Andrea",
	what: "Fresh bread for the street",
	people: "Rio bakes with me at night. I need someone for deliveries.",
	successor: "Rio",
};
const plan = (over: Partial<Plan> = {}): Plan => ({
	template: "restaurant",
	summary: "A bakery for the street",
	vision: null,
	mission: "Fresh bread for the street",
	values: ["Never sell old bread as fresh"],
	goals: ["100 regulars"],
	teams: [
		{ key: "bakery", name: "Bakery", purpose: "The bread" },
		{ key: "shop", name: "Shop", purpose: "The customers" },
	],
	agents: [
		{
			key: "orders",
			name: "Order taker",
			role: "Takes the orders",
			instructions: "Answer customers and collect orders.",
			team: "shop",
		},
	],
	people: [{ key: "rio", name: "Rio", role: "Night baker", team: "bakery" }],
	responsibilities: [
		{ key: "r-bread", name: "Bread", team: "bakery", owner: "rio" },
		{ key: "r-orders", name: "Orders", team: "shop", owner: "orders" },
		{ key: "r-delivery", name: "Deliveries", team: "shop", owner: "open" },
		{ key: "r-books", name: "Books", team: "shop", owner: "founder" },
	],
	successor: "Rio",
	...over,
});

describe("drafting the company (D56)", () => {
	it("builds a valid company where every team and the charter are watched", () => {
		const { file, view } = buildCompany(
			plan(),
			answers,
			listTemplates(),
			"Asia/Makassar",
		);
		expect(file.company).toMatchObject({
			id: "sunrise-bakery",
			name: "Sunrise Bakery",
			timezone: "Asia/Makassar",
		});
		expect(file.dream).toMatchObject({
			objective: "Fresh bread for the street",
			constraints: ["Never sell old bread as fresh"],
		});
		const watched = file.edges
			.filter((e) => e.relation === "monitors")
			.map((e) => e.to);
		expect(watched.sort()).toEqual(["bakery", "dream", "shop"]);
		// Tools come from the template, never from the model.
		expect(file.nodes.filter((n) => n.kind === "tool").length).toBeGreaterThan(
			0,
		);
		expect(view.responsibilities.map((r) => [r.name, r.owner])).toEqual([
			["Bread", { kind: "person", name: "Rio" }],
			["Orders", { kind: "agent", name: "Order taker" }],
			["Deliveries", { kind: "open", name: null }],
			["Books", { kind: "founder", name: "Andrea" }],
		]);
		// Every agent is told the law.
		expect(
			file.nodes.find((n) => n.key === "orders")?.config.instructions,
		).toMatch(
			/never pay, sign, hire or promise anything without the owner's approval/,
		);
	});

	it("never adds a person the founder didn't name", () => {
		const { file, view } = buildCompany(
			plan({
				people: [
					{ key: "rio", name: "Rio", role: "Baker", team: "bakery" },
					{
						key: "marco",
						name: "Marco Bianchi",
						role: "Accountant",
						team: "shop",
					},
				],
				responsibilities: [
					{ key: "r-books", name: "Books", team: "shop", owner: "marco" },
				],
			}),
			answers,
			listTemplates(),
		);
		expect(view.people.map((p) => p.name)).toEqual(["Rio"]);
		expect(file.nodes.some((n) => n.name === "Marco Bianchi")).toBe(false);
		expect(view.responsibilities[0]?.owner).toEqual({
			kind: "open",
			name: null,
		});
	});

	it("matches names as whole words, and never lets a key take the founder's place", () => {
		const { view } = buildCompany(
			plan({
				people: [
					{ key: "al", name: "Al", role: "Invented", team: "shop" },
					{ key: "rio", name: "Rio", role: "Baker", team: "bakery" },
				],
				agents: [
					{
						key: "founder",
						name: "Impostor",
						role: "",
						instructions: "",
						team: "shop",
					},
					{
						key: "rio",
						name: "Clash",
						role: "",
						instructions: "",
						team: "shop",
					},
				],
				responsibilities: [
					{ key: "r-books", name: "Books", team: "shop", owner: "founder" },
					{ key: "r-bread", name: "Bread", team: "bakery", owner: "rio" },
				],
			}),
			{ ...answers, people: "Laura and Rio bake with me" },
			listTemplates(),
		);
		expect(view.people.map((p) => p.name)).toEqual(["Rio"]);
		expect(view.responsibilities.map((r) => r.owner)).toEqual([
			{ kind: "founder", name: "Andrea" },
			{ kind: "agent", name: "Clash" },
		]);
	});

	it("keeps it small, and survives keys a model gets wrong", () => {
		const many = (n: number, f: (i: number) => object) =>
			Array.from({ length: n }, (_, i) => f(i));
		const { file, view } = buildCompany(
			plan({
				template: "no-such-template",
				teams: many(7, (i) => ({
					key: "Team!",
					name: `Team ${i}`,
					purpose: "",
				})) as Plan["teams"],
				agents: many(6, (i) => ({
					key: "dream",
					name: `Agent ${i}`,
					role: "",
					instructions: "",
					team: "nope",
				})) as Plan["agents"],
				responsibilities: many(12, (i) => ({
					key: "",
					name: `Job ${i}`,
					team: null,
					owner: "ghost",
				})) as Plan["responsibilities"],
			}),
			answers,
			listTemplates(),
		);
		expect(view.teams).toHaveLength(LIMITS.teams);
		expect(view.agents).toHaveLength(LIMITS.agents);
		expect(view.responsibilities).toHaveLength(LIMITS.responsibilities);
		expect(view.responsibilities.every((r) => r.owner.kind === "open")).toBe(
			true,
		);
		const keys = file.nodes.map((n) => n.key);
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys).not.toContain("dream");
	});
});
