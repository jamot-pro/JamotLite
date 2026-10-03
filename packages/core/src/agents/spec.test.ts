import { describe, expect, it } from "vitest";
import { agentSpecFromNode } from "./spec.js";

describe("an agent's instructions", () => {
	it("frame it with the charter, in its own words", () => {
		const spec = agentSpecFromNode({
			node: {
				key: "host",
				name: "Host",
				config: { role: "Takes reservations", instructions: "Be kind." },
			} as never,
			company: { name: "Trattoria" } as never,
			dream: {
				vision: "Nobody in the street eats alone.",
				objective: "Run the restaurant the neighbourhood comes back to.",
				constraints: ["No discounts without the manager"],
				outcomes: [],
			} as never,
			model: {} as never,
			tools: [],
		});
		expect(spec.instructions).toContain(
			"The company's vision: Nobody in the street eats alone.",
		);
		expect(spec.instructions).toContain(
			"Its mission: Run the restaurant the neighbourhood comes back to.",
		);
		expect(spec.instructions).toContain("- No discounts without the manager");
		expect(spec.instructions).not.toMatch(/Dream/);
	});
});

describe("what the owner reads", () => {
	it("says charter, never Dream: the readiness checklist", async () => {
		const { computeReadiness } = await import("../readiness/readiness.js");
		const readiness = computeReadiness({ nodes: [], edges: [] });
		const words = JSON.stringify(readiness);
		expect(words).toMatch(/charter/);
		expect(words).not.toMatch(/Dream/);
	});
});
