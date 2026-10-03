import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type BrainTool, createPiBrain } from "@jamot/brain";
import {
	fakeModel,
	fauxAssistantMessage,
	fauxText,
	fauxToolCall,
} from "@jamot/brain/testing";
import { parseCompanyFile } from "@jamot/company-file";
import type { CompanyStore } from "@jamot/ports";
import { openCompanyStore } from "@jamot/sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { receiveMessage } from "../channels/intake.js";
import { importCompanyFile } from "../company/import.js";
import { replyToMessage } from "./reply.js";
import { pickChannelAgent } from "./spec.js";

const restaurant = () => {
	const text = readFileSync(
		fileURLToPath(
			new URL("../../../../templates/restaurant.yaml", import.meta.url),
		),
		"utf8",
	);
	const parsed = parseCompanyFile(text);
	if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
	return parsed.file;
};

let store: CompanyStore;
beforeEach(async () => {
	store = openCompanyStore(":memory:");
	await importCompanyFile(store.graph, restaurant());
});
afterEach(() => store.close());

type Ctx = {
	messages: {
		role: string;
		content?: unknown;
		sections?: Record<string, string>;
	}[];
};
const lastText = (ctx: Ctx) => {
	const c = ctx.messages.at(-1)?.content;
	return typeof c === "string"
		? c
		: ((c as { text?: string }[]) ?? []).map((x) => x.text ?? "").join("");
};

async function customerWrites(text: string, messageId = "1") {
	return receiveMessage(store, {
		channel: "telegram",
		threadId: "chat-7",
		messageId,
		from: { userId: "7", displayName: "Mrs. Rossi" },
		text,
	});
}

describe("an agent replies to a customer", () => {
	it("picks the agent wired to Telegram in the company map", async () => {
		const agent = pickChannelAgent(
			await store.graph.listNodes(),
			await store.graph.listEdges(),
			"telegram",
		);
		expect(agent?.key).toBe("host");
	});

	it("answers as the Host, within the company's rules, and queues the reply", async () => {
		let instructions = "";
		const model = fakeModel((ctx) => {
			instructions =
				(ctx as unknown as Ctx).messages.find((m) => m.sections?.instructions)
					?.sections?.instructions ?? "";
			return fauxAssistantMessage([
				fauxText("Of course — a table for 4 at 8pm is booked."),
			]);
		});
		const intake = await customerWrites("Table for 4 at 8pm?");
		const outcome = await replyToMessage(
			{ store, brain: createPiBrain(store), model: async () => model },
			intake,
		);

		expect(outcome?.status).toBe("done");
		expect(instructions).toContain(
			"You are Host — Takes reservations and messages, at A neighbourhood restaurant.",
		);
		expect(instructions).toContain(
			"- Allergy information is always confirmed by a human in the kitchen, never by an agent alone",
		);
		const [reply] = await store.conversations.listPending();
		expect(reply).toMatchObject({
			text: "Of course — a table for 4 at 8pm is booked.",
			agentKey: "host",
			personId: intake.personId,
		});
	});

	it("uses what the company remembers, and can note new things down", async () => {
		const intake = await customerWrites("Hi, it's me");
		await store.memory.store({
			scope: "person",
			ownerId: intake.personId,
			kind: "preference",
			content: "Gluten-free",
			source: "human",
		});
		let input = "";
		const model = fakeModel((ctx) => {
			const last = (ctx as unknown as Ctx).messages.at(-1);
			if (last?.role === "user") {
				input = lastText(ctx as unknown as Ctx);
				return fauxAssistantMessage(
					[
						fauxToolCall("remember", {
							about: "person",
							note: "Birthday on 12 May",
						}),
					],
					{ stopReason: "toolUse" },
				);
			}
			return fauxAssistantMessage([fauxText("Welcome back!")]);
		});
		await replyToMessage(
			{ store, brain: createPiBrain(store), model: async () => model },
			intake,
		);

		expect(input).toContain("- Gluten-free");
		const facts = await store.memory.list({
			scope: "person",
			ownerId: intake.personId,
			kind: "fact",
		});
		expect(facts.map((m) => [m.content, m.source])).toEqual([
			["Birthday on 12 May", "agent"],
		]);
	});

	it("sends one answer even if the job runs twice", async () => {
		const model = fakeModel(() => fauxAssistantMessage([fauxText("Yes!")]));
		const intake = await customerWrites("Open Sunday?");
		const deps = {
			store,
			brain: createPiBrain(store),
			model: async () => model,
		};
		await replyToMessage(deps, intake);
		await replyToMessage(deps, intake);
		expect(await store.conversations.listPending()).toHaveLength(1);
	});

	it("tells someone when an agent's action waits for approval", async () => {
		const refund: BrainTool = {
			name: "refund",
			description: "Refund a customer",
			parameters: {
				type: "object",
				properties: { amount: { type: "number" } },
			},
			policy: "approve",
			execute: async () => ({ text: "refunded" }),
		};
		const model = fakeModel((ctx) =>
			(ctx as unknown as Ctx).messages.at(-1)?.role === "toolResult"
				? fauxAssistantMessage([
						fauxText("I've asked the manager to approve your refund."),
					])
				: fauxAssistantMessage([fauxToolCall("refund", { amount: 20 })], {
						stopReason: "toolUse",
					}),
		);
		const asked: string[][] = [];
		const intake = await customerWrites("The soup was cold, refund please");
		const outcome = await replyToMessage(
			{
				store,
				brain: createPiBrain(store),
				model: async () => model,
				extraTools: () => [refund],
				onApprovalNeeded: async (ids) => void asked.push(ids),
			},
			intake,
		);
		expect(outcome?.status).toBe("awaiting_approval");
		expect(asked).toHaveLength(1);
		expect((await store.conversations.listPending())[0]?.text).toBe(
			"I've asked the manager to approve your refund.",
		);
	});

	it("records a failed answer instead of sending nothing silently", async () => {
		const broken = fakeModel(() =>
			fauxAssistantMessage([], {
				stopReason: "error",
				errorMessage: "provider down",
			}),
		);
		const intake = await customerWrites("Hello?");
		const outcome = await replyToMessage(
			{ store, brain: createPiBrain(store), model: async () => broken },
			intake,
		);
		expect(outcome?.status).toBe("error");
		expect(await store.conversations.listPending()).toEqual([]);
		expect((await store.events.listUndelivered()).map((e) => e.type)).toContain(
			"agent.reply_failed",
		);
	});
});
