import http from "node:http";
import type { AddressInfo } from "node:net";
import type { JsonObject } from "@earendil-works/pi-ai";
import type { CompanyStore } from "@jamot/ports";
import { openCompanyStore } from "@jamot/sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type AgentSpec,
	type BrainTool,
	connectModel,
	createPiBrain,
} from "./index.js";
import {
	type FakeReply,
	fakeModel,
	fauxAssistantMessage,
	fauxText,
	fauxToolCall,
} from "./testing.js";

let store: CompanyStore;
beforeEach(() => {
	store = openCompanyStore(":memory:");
});
afterEach(() => store.close());

type Msg = {
	role: string;
	content?: unknown;
	toolCallId?: string;
	isError?: boolean;
	sections?: Record<string, string>;
};
const lastOf = (ctx: { messages: unknown[] }) => ctx.messages.at(-1) as Msg;
/** The conversation without system messages — pi also uses those to announce tools. */
const talk = (rows: { message: unknown }[]) =>
	rows.map((r) => r.message as Msg).filter((m) => m.role !== "system");
const textOf = (m: Msg) =>
	typeof m.content === "string"
		? m.content
		: ((m.content as { text?: string }[]) ?? [])
				.map((c) => c.text ?? "")
				.join("");

/** Calls `tool` with `args` once, then answers with what the tool said. */
const callThenAnswer =
	(tool: string, args: JsonObject): FakeReply =>
	(ctx) => {
		const last = lastOf(ctx);
		// After a person decided on a waiting call, the brain tells the agent.
		if (last.role === "user" && /approved|declined/.test(textOf(last)))
			return fauxAssistantMessage([fauxText(`Done: ${textOf(last)}`)]);
		if (last.role === "toolResult")
			return fauxAssistantMessage([fauxText(`Done: ${textOf(last)}`)]);
		return fauxAssistantMessage([fauxToolCall(tool, args)], {
			stopReason: "toolUse",
		});
	};

function spec(
	model: AgentSpec["model"],
	tools: BrainTool[] = [],
	extra: Partial<AgentSpec> = {},
): AgentSpec {
	return {
		key: "host",
		instructions: "Take reservations.",
		model,
		tools,
		...extra,
	};
}

function counter(name: string, policy: BrainTool["policy"] = "allow") {
	const calls: Record<string, unknown>[] = [];
	const tool: BrainTool = {
		name,
		description: `Does ${name}`,
		parameters: { type: "object", properties: { amount: { type: "number" } } },
		policy,
		async execute(args) {
			calls.push(args);
			return { text: `${name} ran with ${JSON.stringify(args)}` };
		},
	};
	return { tool, calls };
}

describe("the brain on pi", () => {
	it("runs a tool, answers, and keeps the whole run in the company's database", async () => {
		const { tool, calls } = counter("book_table");
		const brain = createPiBrain(store);
		const out = await brain.run({
			agent: spec(fakeModel(callThenAnswer("book_table", { amount: 4 })), [
				tool,
			]),
			sessionId: "telegram:chat-1:host",
			input: "Table for 4 tonight?",
			trigger: "message",
		});

		expect(out).toMatchObject({
			status: "done",
			text: 'Done: book_table ran with {"amount":4}',
		});
		expect(calls).toEqual([{ amount: 4 }]);
		const transcript = await store.transcripts.load("telegram:chat-1:host");
		expect(transcript[0]?.message).toMatchObject({ role: "system" });
		expect(talk(transcript).map((m) => m.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
		]);

		const run = await store.runs.get(out.runId);
		expect(run).toMatchObject({
			status: "done",
			agentKey: "host",
			model: "faux/fake-1",
			trigger: "message",
		});
		expect(run?.inputTokens).toBeGreaterThan(0);
		expect((await store.events.listUndelivered()).map((e) => e.type)).toEqual([
			"agent.tool_called",
		]);
	});

	it("remembers the conversation across runs and restarts", async () => {
		const seen: number[] = [];
		const model = fakeModel((ctx) => {
			seen.push(ctx.messages.filter((m) => (m as Msg).role === "user").length);
			return fauxAssistantMessage([fauxText("ok")]);
		});
		await createPiBrain(store).run({
			agent: spec(model),
			sessionId: "s",
			input: "first",
			trigger: "message",
		});
		// A new brain, as after a restart: only the database carries the history.
		await createPiBrain(store).run({
			agent: spec(model),
			sessionId: "s",
			input: "second",
			trigger: "message",
		});
		expect(seen).toEqual([1, 2]);
	});

	it("never runs a denied tool, and tells the agent why", async () => {
		const { tool, calls } = counter("delete_customer", "deny");
		const out = await createPiBrain(store).run({
			agent: spec(fakeModel(callThenAnswer("delete_customer", {})), [tool]),
			sessionId: "s",
			input: "delete Mrs Rossi",
			trigger: "message",
		});
		expect(calls).toEqual([]);
		expect(out).toMatchObject({
			status: "done",
			text: expect.stringContaining("does not allow delete_customer"),
		});
	});

	it("waits for a person before a payment, then carries on when they approve", async () => {
		const { tool, calls } = counter("payment_send", "approve");
		const agent = spec(
			fakeModel(callThenAnswer("payment_send", { amount: 1200 })),
			[tool],
		);
		const brain = createPiBrain(store);

		const waiting = await brain.run({
			agent,
			sessionId: "s",
			input: "Pay the flour supplier",
			trigger: "heartbeat",
		});
		expect(waiting.status).toBe("awaiting_approval");
		expect(calls).toEqual([]);
		if (waiting.status !== "awaiting_approval") return;
		const [approvalId] = waiting.approvalIds;
		expect(await store.approvals.get(approvalId as string)).toMatchObject({
			status: "pending",
			tool: "payment_send",
			args: { amount: 1200 },
		});
		expect((await store.runs.get(waiting.runId))?.status).toBe(
			"awaiting_approval",
		);

		const done = await brain.decide({
			agent,
			approvalId: approvalId as string,
			approved: true,
			by: "Lucia",
		});
		expect(done).toMatchObject({
			status: "done",
			text: 'Done: Lucia approved payment_send. Result: payment_send ran with {"amount":1200}',
		});
		expect(calls).toEqual([{ amount: 1200 }]);
		expect((await store.approvals.get(approvalId as string))?.status).toBe(
			"approved",
		);
		await expect(
			brain.decide({
				agent,
				approvalId: approvalId as string,
				approved: true,
				by: "Marco",
			}),
		).rejects.toThrow(/already approved/);
		expect(calls).toHaveLength(1);
	});

	it("tells the agent when a person declines", async () => {
		const { tool, calls } = counter("payment_send", "approve");
		const agent = spec(
			fakeModel(callThenAnswer("payment_send", { amount: 99 })),
			[tool],
		);
		const brain = createPiBrain(store);
		const waiting = await brain.run({
			agent,
			sessionId: "s",
			input: "Pay it",
			trigger: "message",
		});
		if (waiting.status !== "awaiting_approval")
			throw new Error("expected to wait");

		const out = await brain.decide({
			agent,
			approvalId: waiting.approvalIds[0] as string,
			approved: false,
			by: "Lucia",
			note: "wrong IBAN",
		});
		expect(calls).toEqual([]);
		expect(out).toMatchObject({
			status: "done",
			text: "Done: Lucia declined payment_send: wrong IBAN",
		});
	});

	it("repairs a run a crash cut off mid-tool, without running the tool again", async () => {
		// What a process killed mid-tool leaves behind: a tool call with no result.
		const { tool, calls } = counter("send_invoice");
		const toolCall = {
			type: "toolCall",
			id: "call-1",
			name: "send_invoice",
			arguments: {},
		};
		await store.transcripts.append("s", [
			{
				role: "system",
				content: "x",
				sections: { instructions: "Take reservations." },
				timestamp: 0,
			},
			{ role: "user", content: "invoice Rossi", timestamp: 1 },
			{
				role: "assistant",
				content: [toolCall],
				api: "faux",
				provider: "faux",
				model: "fake-1",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "toolUse",
				timestamp: 2,
			},
		]);
		const saw: string[] = [];
		const model = fakeModel((ctx) => {
			saw.push(textOf(lastOf(ctx)));
			return fauxAssistantMessage([
				fauxText("I'll check whether the invoice went out."),
			]);
		});
		const out = await createPiBrain(store).run({
			agent: spec(model, [tool]),
			sessionId: "s",
			input: "status?",
			trigger: "message",
		});

		expect(out.status).toBe("done");
		expect(calls).toEqual([]);
		const conversation = talk(await store.transcripts.load("s"));
		expect(conversation.map((m) => m.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"user",
			"assistant",
		]);
		const repaired = conversation[2] as Msg;
		expect(repaired).toMatchObject({ toolCallId: "call-1", isError: true });
		expect(textOf(repaired)).toMatch(/Interrupted/);
	});

	it("gives up on a tool that hangs", async () => {
		const hang: BrainTool = {
			name: "slow_report",
			description: "never answers",
			parameters: { type: "object", properties: {} },
			timeoutMs: 50,
			execute: () => new Promise(() => {}),
		};
		const out = await createPiBrain(store).run({
			agent: spec(fakeModel(callThenAnswer("slow_report", {})), [hang]),
			sessionId: "s",
			input: "report",
			trigger: "message",
		});
		expect(out).toMatchObject({
			status: "done",
			text: "Done: slow_report timed out after 50 ms",
		});
	});

	it("stops an agent that loops, at its budget", async () => {
		const { tool, calls } = counter("check_stock");
		const loops = fakeModel(() =>
			fauxAssistantMessage([fauxToolCall("check_stock", {})], {
				stopReason: "toolUse",
			}),
		);
		const out = await createPiBrain(store).run({
			agent: spec(loops, [tool], { budget: { maxTurns: 3 } }),
			sessionId: "s",
			input: "stock?",
			trigger: "heartbeat",
		});
		expect(out).toMatchObject({
			status: "aborted",
			message: "budget reached: 3 turns",
		});
		expect(calls.length).toBeLessThanOrEqual(3);
		expect((await store.runs.get(out.runId))?.status).toBe("aborted");
	});

	it("updates the agent's instructions in place when they change", async () => {
		const prompts: string[][] = [];
		const model = fakeModel((ctx) => {
			prompts.push(
				ctx.messages
					.filter((m) => (m as Msg).role === "system")
					.map((m) => (m as Msg).sections?.instructions ?? ""),
			);
			return fauxAssistantMessage([fauxText("ok")]);
		});
		const brain = createPiBrain(store);
		await brain.run({
			agent: spec(model),
			sessionId: "s",
			input: "1",
			trigger: "message",
		});
		await brain.run({
			agent: spec(model),
			sessionId: "s",
			input: "2",
			trigger: "message",
		});
		await brain.run({
			agent: spec(model, [], {
				instructions: "Take reservations. Never after 22:00.",
			}),
			sessionId: "s",
			input: "3",
			trigger: "message",
		});
		expect(prompts).toEqual([
			["Take reservations."],
			["Take reservations."],
			["Take reservations.", "Take reservations. Never after 22:00."],
		]);
	});

	it("keeps two messages on one conversation in order", async () => {
		const model = fakeModel(
			(ctx) =>
				fauxAssistantMessage([fauxText(`reply to ${textOf(lastOf(ctx))}`)]),
			{ tokensPerSecond: 500 },
		);
		const brain = createPiBrain(store);
		await Promise.all([
			brain.run({
				agent: spec(model),
				sessionId: "s",
				input: "A",
				trigger: "message",
			}),
			brain.run({
				agent: spec(model),
				sessionId: "s",
				input: "B",
				trigger: "message",
			}),
		]);
		const texts = (await store.transcripts.load("s"))
			.slice(1)
			.map((r) => textOf(r.message as Msg));
		expect(texts).toEqual(["A", "reply to A", "B", "reply to B"]);
	});

	it("refuses tool names model providers reject", async () => {
		const bad = { ...counter("payment.send").tool };
		const out = await createPiBrain(store)
			.run({
				agent: spec(fakeModel(callThenAnswer("x", {})), [bad]),
				sessionId: "s",
				input: "hi",
				trigger: "message",
			})
			.catch((e: Error) => e);
		expect(String(out)).toMatch(/payment_send/);
	});

	it("closes runs a stopped process left open", async () => {
		await store.runs.start({
			sessionId: "s",
			agentKey: "host",
			model: null,
			trigger: "message",
			input: "hi",
		});
		expect(await createPiBrain(store).recoverInterrupted()).toBe(1);
		expect(await store.runs.list({ status: "running" })).toEqual([]);
	});
});

describe("usage and cost", () => {
	it("records what a real provider reports, priced from pi's catalog", async () => {
		// The real Anthropic client, pointed at a local server speaking its protocol.
		const server = http.createServer((req, res) => {
			req.resume();
			req.on("end", () => {
				res.writeHead(200, { "content-type": "text/event-stream" });
				const send = (event: string, data: unknown) =>
					res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
				send("message_start", {
					type: "message_start",
					message: {
						id: "m1",
						type: "message",
						role: "assistant",
						model: "claude-sonnet-5",
						content: [],
						stop_reason: null,
						usage: {
							input_tokens: 1000,
							output_tokens: 1,
							cache_read_input_tokens: 2000,
							cache_creation_input_tokens: 500,
						},
					},
				});
				send("content_block_start", {
					type: "content_block_start",
					index: 0,
					content_block: { type: "text", text: "" },
				});
				send("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "Booked." },
				});
				send("content_block_stop", { type: "content_block_stop", index: 0 });
				send("message_delta", {
					type: "message_delta",
					delta: { stop_reason: "end_turn" },
					usage: { output_tokens: 300 },
				});
				send("message_stop", { type: "message_stop" });
				res.end();
			});
		});
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
		const { port } = server.address() as AddressInfo;
		try {
			const model = connectModel({
				provider: "anthropic",
				modelId: "claude-sonnet-5",
				apiKey: "test-key",
				baseUrl: `http://127.0.0.1:${port}`,
			});
			const out = await createPiBrain(store).run({
				agent: spec(model),
				sessionId: "s",
				input: "book",
				trigger: "message",
			});
			expect(out).toMatchObject({ status: "done", text: "Booked." });

			// $2 / $10 / $0.20 / $2.50 per million: 1000 in, 300 out, 2000 cache read, 500 cache write.
			expect(await store.runs.get(out.runId)).toMatchObject({
				model: "anthropic/claude-sonnet-5",
				inputTokens: 1000,
				outputTokens: 300,
				cacheReadTokens: 2000,
				cacheWriteTokens: 500,
				costMicroUsd: 6650,
			});
			expect(await store.runs.totals()).toMatchObject({
				runs: 1,
				costMicroUsd: 6650,
			});
		} finally {
			server.close();
		}
	});
});
