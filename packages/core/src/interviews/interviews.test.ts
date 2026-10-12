import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	type InterviewDeps,
	interviewTurn,
	loadInterview,
	missingFacts,
	startInterview,
} from "./interviews.js";

const BUILT_IN = fileURLToPath(
	new URL("../../../../interviews", import.meta.url),
);
const charter = () => loadInterview("charter", [BUILT_IN]);

/** A model that answers each turn from a list, and records what it was asked. */
function scripted(replies: unknown[]) {
	const asked: { system: string; prompt: string }[] = [];
	const deps: InterviewDeps = {
		ask: async (input) => {
			asked.push(input);
			const next = replies.shift();
			if (next instanceof Error) throw next;
			return typeof next === "string" ? next : JSON.stringify(next);
		},
	};
	return { deps, asked };
}

describe("interviews (D61)", () => {
	it("loads the built-in definitions and their skills", () => {
		const c = charter();
		expect(c.definition.fields.map((f) => f.id)).toEqual([
			"name",
			"founder",
			"what",
			"why",
			"goals",
			"never",
			"people",
			"delegate",
			"successor",
		]);
		expect(c.skills.map((s) => s.name)).toEqual([
			"interviewing",
			"charter-rules",
		]);
		expect(c.skills[1]?.body).toContain("# A good charter");
		const n = loadInterview("newcomer", [BUILT_IN]);
		expect(n.skills.map((s) => s.name)).toEqual(["interviewing", "newcomer"]);
	});

	it("takes a company's own definition and skills before the built-in ones", () => {
		const own = mkdtempSync(join(tmpdir(), "jamot-interviews-"));
		writeFileSync(
			join(own, "newcomer.yaml"),
			[
				"id: newcomer",
				"name: Welcome to the bakery",
				"goal: Learn which shifts the new baker can take.",
				"skills: [interviewing, bakery]",
				"fields:",
				"  - id: shifts",
				"    label: Shifts they can take",
				"    required: true",
			].join("\n"),
		);
		mkdirSync(join(own, "skills", "bakery"), { recursive: true });
		writeFileSync(
			join(own, "skills", "bakery", "SKILL.md"),
			"---\nname: bakery\ndescription: Night shifts.\n---\nAsk about night shifts.",
		);
		const n = loadInterview("newcomer", [own, BUILT_IN]);
		expect(n.definition.goal).toBe(
			"Learn which shifts the new baker can take.",
		);
		expect(n.skills.map((s) => [s.name, s.body])).toEqual([
			["interviewing", expect.stringContaining("One question per message")],
			["bakery", "Ask about night shifts."],
		]);
	});

	it("refuses a definition that doesn't hold together", () => {
		const own = mkdtempSync(join(tmpdir(), "jamot-interviews-"));
		writeFileSync(
			join(own, "bad.yaml"),
			"id: bad\nname: Bad\ngoal: Too short goal here.\nskills: [nope]\nfields:\n  - id: a\n    label: A\n",
		);
		expect(() => loadInterview("bad", [own])).toThrow('no skill "nope"');
		expect(() => loadInterview("missing", [own])).toThrow(
			'no interview "missing"',
		);
	});

	it("opens with the definition's words and what's known already", () => {
		const s = startInterview(charter(), {
			facts: { founder: "Andrea", x: "y" },
		});
		expect(s.facts).toEqual({ founder: "Andrea" });
		expect(s.messages[0]?.text).toMatch(/^Hi, I'm Jamot/);
		const n = startInterview(loadInterview("newcomer", [BUILT_IN]), {
			context: { company: "Sunrise Bakery", name: "Rio" },
		});
		expect(n.messages[0]?.text).toMatch(/^Welcome to Sunrise Bakery, Rio!/);
	});

	it("gathers facts turn by turn, keeps only real fields, and completes when the founder confirms", async () => {
		const c = charter();
		const { deps, asked } = scripted([
			{
				facts: {
					what: "Fresh bread for families, ordered on Telegram",
					made_up: "x",
				},
				say: "Lovely. What's it called?",
			},
			// Code fences and prose around the JSON are fine.
			'Sure:\n```json\n{"facts": {"name": "Sunrise Bakery", "goals": ["100 customers by December", "Orders open by 8 pm"]}, "say": "So: Sunrise Bakery, 100 customers by December. Right?", "complete": false}\n```',
			{ facts: {}, say: "Great — I have what I need.", complete: true },
		]);
		let s = startInterview(c, { facts: { founder: "Andrea" } });
		({ state: s } = await interviewTurn(deps, c, s, "A bakery for families"));
		expect(s.facts).toEqual({
			founder: "Andrea",
			what: "Fresh bread for families, ordered on Telegram",
		});
		({ state: s } = await interviewTurn(deps, c, s, "Sunrise Bakery"));
		expect(s.facts.goals).toBe(
			"100 customers by December\nOrders open by 8 pm",
		);
		const last = await interviewTurn(deps, c, s, "Yes, that's right");
		expect(last.state.status).toBe("complete");
		expect(last.reply).toBe("Great — I have what I need.");
		expect(last.state.messages.map((m) => m.from)).toEqual([
			"jamot",
			"person",
			"jamot",
			"person",
			"jamot",
			"person",
			"jamot",
		]);
		// The model reads the goal, the skills, the facts and the conversation.
		expect(asked[0]?.system).toContain("## Skill: charter-rules");
		expect(asked[2]?.prompt).toContain('so far: "Sunrise Bakery"');
		expect(asked[2]?.prompt).toContain("Person: Yes, that's right");
	});

	it("never completes while a required fact is missing", async () => {
		const c = charter();
		const { deps } = scripted([
			{ facts: { what: "Bread" }, say: "Done!", complete: true },
		]);
		const { state } = await interviewTurn(deps, c, startInterview(c), "Bread");
		expect(state.status).toBe("asking");
		expect(missingFacts(c, state).map((f) => f.id)).toEqual([
			"name",
			"founder",
		]);
	});

	it('ends on "that\'s enough" once the required facts are in, without the model', async () => {
		const c = charter();
		const { deps, asked } = scripted([]);
		const s = startInterview(c, {
			facts: { name: "Sunrise", founder: "Andrea" },
		});
		const early = await interviewTurn(deps, c, s, "that's enough");
		expect(early.state.status).toBe("asking");
		expect(early.reply).toMatch(
			/still need: what the business does and for whom/,
		);
		const done = await interviewTurn(
			deps,
			c,
			{ ...early.state, facts: { ...early.state.facts, what: "Bread" } },
			"Enough!",
		);
		expect(done.state.status).toBe("complete");
		expect(asked).toEqual([]);
	});

	it("carries on with plain questions when the model fails", async () => {
		const c = charter();
		const { deps } = scripted([new Error("503 overloaded")]);
		const logged: string[] = [];
		const { state, reply } = await interviewTurn(
			{ ...deps, log: (m) => logged.push(m) },
			c,
			startInterview(c),
			"A bakery",
		);
		// The log says why, never what the person said.
		expect(logged).toEqual([
			"[interview] charter: the model failed: 503 overloaded",
		]);
		expect(reply).toBe("The company's name? (A working name is fine.)");
		expect(state.turns).toBe(1);
		const { deps: garbled } = scripted(["no json here", "still none"]);
		expect(
			(await interviewTurn(garbled, c, startInterview(c), "A bakery")).reply,
		).toBe("The company's name? (A working name is fine.)");
	});

	it("stops calling the model once its turns are spent", async () => {
		const c = charter();
		const { deps, asked } = scripted([]);
		const s = { ...startInterview(c), turns: c.definition.maxTurns };
		const { reply } = await interviewTurn(deps, c, s, "More about us");
		expect(asked).toEqual([]);
		expect(reply).toMatch(/still need/);
	});

	it("refuses an empty or very long message", async () => {
		const c = charter();
		const { deps } = scripted([]);
		await expect(
			interviewTurn(deps, c, startInterview(c), "  "),
		).rejects.toThrow("Say something first.");
		await expect(
			interviewTurn(deps, c, startInterview(c), "x".repeat(2001)),
		).rejects.toThrow(/under 2000 characters/);
	});
});
