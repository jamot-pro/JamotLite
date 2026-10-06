import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPiBrain } from "@jamot/brain";
import {
	fakeModel,
	fauxAssistantMessage,
	fauxText,
} from "@jamot/brain/testing";
import { parseCompanyFile } from "@jamot/company-file";
import type { CompanyStore } from "@jamot/ports";
import { openCompanyStore } from "@jamot/sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { replyToMessage } from "../agents/reply.js";
import { receiveMessage } from "../channels/intake.js";
import { importCompanyFile } from "../company/import.js";
import type { Notifier } from "../heartbeats/notify.js";
import { loadInterview } from "./interviews.js";
import { continueWelcome, startWelcome, welcomeKey } from "./welcome.js";

const BUILT_IN = fileURLToPath(
	new URL("../../../../interviews", import.meta.url),
);
const newcomer = () => loadInterview("newcomer", [BUILT_IN]);

let store: CompanyStore;
let toOwner: string[];
const notifier: Notifier = {
	toOwner: async (m) => {
		toOwner.push(m.text);
		return true;
	},
	toSuccessor: async () => false,
};

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
});
afterEach(() => store.close());

/** Rio writes on Telegram; returns the intake for the reply job. */
const rioWrites = (text: string, id: string) =>
	receiveMessage(store, {
		channel: "telegram",
		threadId: "chat-9",
		messageId: id,
		from: { userId: "9", displayName: "Rio Santos" },
		text,
	});

describe("a newcomer's welcome (D61)", () => {
	it("opens with their name and the company's, then gathers facts into their memory and tells the founder", async () => {
		const intake = await rioWrites("hi", "0");
		const personId = (await store.people.findByIdentity("telegram", "9"))
			?.id as string;
		const opening = await startWelcome(store, newcomer(), {
			personId,
			nodeKey: "rio",
			name: "Rio Santos",
		});
		expect(opening).toMatch(/^Welcome to .+, Rio!/);
		expect(intake).toBeTruthy();

		const replies = [
			{
				facts: { strengths: "Sourdough, 10 years of night shifts" },
				say: "What would you like to do here?",
			},
			{
				facts: {
					wants: "Bake, and teach the new ones",
					time: "20 hours a week, nights",
				},
				say: "So: sourdough, teaching, 20 hours of nights. Right?",
			},
			{
				facts: {},
				say: "Thank you, Rio! The founder will see a short summary, and your first tasks will come here.",
				complete: true,
			},
		];
		const deps = {
			store,
			notifier,
			ask: async () => JSON.stringify(replies.shift()),
		};
		expect(
			await continueWelcome(deps, newcomer, personId, "I bake sourdough"),
		).toBe("What would you like to do here?");
		await continueWelcome(deps, newcomer, personId, "Bake and teach; 20h");
		const last = await continueWelcome(deps, newcomer, personId, "Yes");
		expect(last).toMatch(/^Thank you, Rio!/);

		const known = await store.memory.list({
			scope: "person",
			ownerId: personId,
			kind: "profile",
		});
		expect(known.map((m) => m.content).sort()).toEqual([
			"How much time they have: 20 hours a week, nights",
			"What they are good at: Sourdough, 10 years of night shifts",
			"What they want to do here: Bake, and teach the new ones",
		]);
		expect(toOwner.at(-1)).toMatch(
			/^👋 Rio Santos finished their welcome:\n\nWhat they are good at: Sourdough/,
		);
		// Done: their next message is for the agents.
		expect(await store.settings.get(welcomeKey(personId))).toBe(null);
		expect(await continueWelcome(deps, newcomer, personId, "Hello again")).toBe(
			null,
		);
	});

	it("answers instead of the agents while the welcome is open", async () => {
		await rioWrites("hi", "0");
		const personId = (await store.people.findByIdentity("telegram", "9"))
			?.id as string;
		await startWelcome(store, newcomer(), {
			personId,
			nodeKey: "rio",
			name: "Rio Santos",
		});
		let agentCalls = 0;
		const agentModel = fakeModel(() => {
			agentCalls++;
			return fauxAssistantMessage([fauxText("I'm the Host.")]);
		});
		const intake = await rioWrites("I'm great at sourdough", "1");
		const deps = {
			store,
			brain: createPiBrain(store),
			model: async () => agentModel,
			interviewReply: (person: { id: string }, text: string) =>
				continueWelcome(
					{
						store,
						notifier,
						ask: async () =>
							JSON.stringify({
								facts: { strengths: "Sourdough" },
								say: "Lovely! What would you like to do here?",
							}),
					},
					newcomer,
					person.id,
					text,
				),
		};
		await replyToMessage(deps, intake);
		// Retried after a crash: still one answer.
		await replyToMessage(deps, intake);
		const out = (await store.conversations.listPending(10)).map((m) => m.text);
		expect(out).toEqual(["Lovely! What would you like to do here?"]);
		expect(agentCalls).toBe(0);
	});

	it("leaves people with no welcome open to the agents", async () => {
		expect(
			await continueWelcome(
				{ store, notifier, ask: async () => "{}" },
				newcomer,
				"nobody",
				"hello",
			),
		).toBe(null);
	});
});
