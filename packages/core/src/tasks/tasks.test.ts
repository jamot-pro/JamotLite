import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPiBrain } from "@jamot/brain";
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
import { importCompanyFile } from "../company/import.js";
import type { Notifier, OwnerAction } from "../heartbeats/notify.js";
import { createWorker } from "../jobs/worker.js";
import { contributionsView } from "../people/contributions.js";
import { addSteward, setStewardResponsibilities } from "../people/stewards.js";
import {
	answerTask,
	createTask,
	followUpTasks,
	routeTask,
	TASK_ROUTE_JOB,
	TASK_RUN_JOB,
	TASK_TELL_JOB,
	type TaskActor,
	taskAction,
	tasksText,
	tellAssignee,
} from "./tasks.js";
import { conversationTaskTools, runTask } from "./work.js";

let store: CompanyStore;
let toOwner: { text: string; actions?: OwnerAction[] }[];
let toMember: { key: string; text: string; actions?: OwnerAction[] }[];
let linked: Set<string>;
const notifier: Notifier = {
	toOwner: async (m) => {
		toOwner.push(m);
		return true;
	},
	toSuccessor: async () => false,
	toMember: async (key, m) => {
		if (!linked.has(key)) return false;
		toMember.push({ key, ...m });
		return true;
	},
};
const founder: TaskActor = { founder: true, key: "founder", name: "Andrea" };
const nadya: TaskActor = { founder: false, key: "nadya", name: "Nadya" };

type Ctx = { messages: { role: string }[] };
/** An agent that calls `tool` once, then says `after`. */
const agentThat = (
	tool: string,
	args: Parameters<typeof fauxToolCall>[1],
	after = "",
) =>
	fakeModel((ctx) =>
		(ctx as unknown as Ctx).messages.at(-1)?.role === "toolResult"
			? fauxAssistantMessage([fauxText(after)])
			: fauxAssistantMessage([fauxToolCall(tool, args)], {
					stopReason: "toolUse",
				}),
	);

/** Runs the queued task jobs, as the runtime's worker does, until none are left. */
async function drain(model = agentThat("finish_task", { result: "Done." })) {
	const deps = {
		store,
		notifier,
		brain: createPiBrain(store),
		model: async () => model,
		ask: async () => "r-purchasing",
	};
	const worker = createWorker(store, {
		[TASK_ROUTE_JOB]: (job) => routeTask(deps, String(job.payload.taskId)),
		[TASK_RUN_JOB]: async (job) => {
			await runTask(deps, job.payload as { taskId: string; agentKey: string });
		},
		[TASK_TELL_JOB]: (job) => tellAssignee(deps, String(job.payload.taskId)),
	});
	for (let i = 0; i < 10 && (await worker.tick()) > 0; i++);
}

const task = async (n: number) => {
	const t = await store.tasks.byNumber(n);
	if (!t) throw new Error(`no task #${n}`);
	return t;
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
	toMember = [];
	linked = new Set(["nadya"]);
	await addSteward(store, { name: "Nadya" }, "owner");
	await setStewardResponsibilities(store, "nadya", ["r-purchasing"], "owner");
});
afterEach(() => store.close());

describe("the tasks table", () => {
	it("numbers tasks and changes one only from the statuses it expects", async () => {
		const a = await store.tasks.create({
			title: "First",
			status: "open",
			requesterKind: "founder",
			requesterName: "Andrea",
		});
		const b = await store.tasks.create({
			title: "Second",
			status: "open",
			requesterKind: "founder",
			requesterName: "Andrea",
		});
		expect([a.number, b.number]).toEqual([1, 2]);
		expect(
			(await store.tasks.update(a.id, ["open"], { status: "working" }))?.status,
		).toBe("working");
		// A second press of the same button finds it moved on.
		expect(await store.tasks.update(a.id, ["open"], { status: "done" })).toBe(
			null,
		);
		const done = await store.tasks.update(a.id, ["working"], {
			status: "done",
			result: "ok",
		});
		expect(done?.doneAt).not.toBe(null);
		expect(
			(await store.tasks.list({ status: ["open"] })).map((t) => t.title),
		).toEqual(["Second"]);
	});
});

describe("adding a task", () => {
	it("starts the founder's at once and queues the selector", async () => {
		const { task: t, message } = await createTask(
			{ store, notifier },
			{
				text: "Find a cheaper flour supplier\nWe use 50 kg a week.",
				requesterKind: "founder",
				requesterKey: "founder",
				requesterName: "Andrea",
			},
		);
		expect(t).toMatchObject({
			number: 1,
			title: "Find a cheaper flour supplier",
			details: "We use 50 kg a week.",
			status: "open",
		});
		expect(message).toContain("#1");
		expect(
			(await store.jobs.list({ kind: TASK_ROUTE_JOB })).map(
				(j) => j.payload.taskId,
			),
		).toEqual([t.id]);
		expect(toOwner).toEqual([]);
	});

	it("asks the founder before a steward's task starts", async () => {
		await createTask(
			{ store, notifier },
			{
				text: "Reprint the menus",
				requesterKind: "member",
				requesterKey: "nadya",
				requesterName: "Nadya",
			},
		);
		expect((await task(1)).status).toBe("proposed");
		expect(await store.jobs.list({ kind: TASK_ROUTE_JOB })).toEqual([]);
		expect(toOwner[0]?.actions?.map((a) => a.action)).toEqual([
			"task:go:1",
			"task:no:1",
		]);
		// Only the founder says yes.
		expect(await taskAction({ store, notifier }, "go", 1, nadya)).toBe(
			"Only the founder decides this.",
		);
		await taskAction({ store, notifier }, "go", 1, founder);
		expect((await task(1)).status).toBe("open");
		expect(toMember.at(-1)?.text).toContain("said yes");
		expect(await store.jobs.list({ kind: TASK_ROUTE_JOB })).toHaveLength(1);
	});

	it("keeps a person to 20 open tasks", async () => {
		const deps = { store, notifier };
		for (let i = 0; i < 20; i++)
			await createTask(deps, {
				text: `Task ${i}`,
				requesterKind: "member",
				requesterKey: "nadya",
				requesterName: "Nadya",
			});
		await expect(
			createTask(deps, {
				text: "One more",
				requesterKind: "member",
				requesterKey: "nadya",
				requesterName: "Nadya",
			}),
		).rejects.toThrow(/20 tasks open/);
	});
});

describe("the selector and the agent's turn", () => {
	const add = (text = "Find a cheaper flour supplier") =>
		createTask(
			{ store, notifier },
			{
				text,
				requesterKind: "founder",
				requesterKey: "founder",
				requesterName: "Andrea",
			},
		);

	it("gives a task to the agent first; a finished task reaches the founder with its result", async () => {
		await add();
		await drain(
			agentThat("finish_task", { result: "Molino Rossi: €0.62/kg, 10% less." }),
		);
		const t = await task(1);
		// Purchasing has no agent of its own and no team that needs it:
		// the company's default agent tries.
		expect(t).toMatchObject({
			status: "done",
			responsibilityKey: "r-purchasing",
			assigneeKind: "agent",
			assigneeKey: "host",
			result: "Molino Rossi: €0.62/kg, 10% less.",
		});
		expect(toOwner.at(-1)?.text).toContain("Molino Rossi");
	});

	it("prefers the agent that owns the responsibility", async () => {
		const nodes = await store.graph.listNodes();
		const id = (k: string) => nodes.find((n) => n.key === k)?.id as string;
		await store.graph.addEdge({
			fromNodeId: id("buyer"),
			toNodeId: id("r-purchasing"),
			relation: "responsible_for",
		});
		await add();
		await drain();
		expect((await task(1)).assigneeKey).toBe("buyer");
	});

	it("ignores a model answer that isn't one of the responsibilities", async () => {
		const t = (await add()).task;
		await routeTask({ store, notifier, ask: async () => "r-made-up" }, t.id);
		expect((await task(1)).responsibilityKey).toBe(null);
	});

	it("hands over to the responsibility's owner; their Done waits for the founder, then goes on their record", async () => {
		await add("Visit the flour mill");
		await drain(
			agentThat("hand_to_person", {
				why: "Someone has to go there.",
				done_so_far: "Found the address.",
			}),
		);
		expect(await task(1)).toMatchObject({
			status: "working",
			assigneeKind: "human",
			assigneeKey: "nadya",
		});
		const told = toMember.find((m) => m.key === "nadya");
		expect(told?.text).toContain("Visit the flour mill");
		expect(told?.text).toContain("Found the address.");
		expect(told?.actions?.map((a) => a.action)).toEqual([
			"task:done:1",
			"task:cant:1",
		]);

		// Only the person who has it can say it's done.
		expect(await taskAction({ store, notifier }, "done", 1, founder)).toContain(
			"isn't yours",
		);
		await taskAction({ store, notifier }, "done", 1, nadya);
		expect((await task(1)).status).toBe("review");
		expect(toOwner.at(-1)?.actions?.map((a) => a.action)).toEqual([
			"task:ok:1",
			"task:redo:1",
		]);
		expect(await taskAction({ store, notifier }, "ok", 1, nadya)).toBe(
			"Only the founder decides this.",
		);
		await taskAction({ store, notifier }, "ok", 1, founder);
		expect((await task(1)).status).toBe("done");
		const record = await contributionsView(store);
		expect(record.contributions.find((c) => c.who.key === "nadya")?.what).toBe(
			"#1 Visit the flour mill",
		);
		// Pressing it again changes nothing.
		expect(await taskAction({ store, notifier }, "ok", 1, founder)).toContain(
			"moved on",
		);
	});

	it("goes to the founder when the owner isn't on Telegram", async () => {
		linked.clear();
		await add("Visit the flour mill");
		await drain(agentThat("hand_to_person", { why: "Someone has to go." }));
		const t = await task(1);
		expect(t.status).toBe("blocked");
		expect(t.note).toContain("isn't linked on Telegram");
		expect(toOwner.at(-1)?.actions?.map((a) => a.action)).toEqual([
			"task:person:1",
			"task:mine:1",
			"task:drop:1",
		]);
		await taskAction({ store, notifier }, "mine", 1, founder);
		await drain();
		expect(await task(1)).toMatchObject({
			status: "working",
			assigneeKey: "founder",
		});
		// The founder's own Done needs nobody's confirmation.
		await taskAction({ store, notifier }, "done", 1, founder);
		expect((await task(1)).status).toBe("done");
	});

	it("asks the founder, and carries on with the answer", async () => {
		await add();
		await drain(
			agentThat("ask_founder", { question: "What's the most we can pay?" }),
		);
		expect((await task(1)).status).toBe("blocked");
		expect(toOwner.at(-1)?.text).toContain("/answer 1");
		expect(
			await answerTask({ store, notifier }, 1, "€0.70/kg", founder),
		).toContain("carries on");
		const t = await task(1);
		expect(t.status).toBe("working");
		expect(t.details).toContain("Andrea answered: €0.70/kg");
		await drain(agentThat("finish_task", { result: "Found one at €0.65." }));
		expect((await task(1)).status).toBe("done");
	});

	it("lets the founder judge an answer the agent didn't mark as finished", async () => {
		await add("Write a welcome note for new suppliers");
		await drain(
			fakeModel(() =>
				fauxAssistantMessage([fauxText("Dear supplier, welcome!")]),
			),
		);
		expect((await task(1)).status).toBe("review");
		expect(toOwner.at(-1)?.actions?.map((a) => a.action)).toEqual([
			"task:ok:1",
			"task:person:1",
		]);
		await taskAction({ store, notifier }, "ok", 1, founder);
		expect(await task(1)).toMatchObject({
			status: "done",
			result: "Dear supplier, welcome!",
		});
	});

	it("tells the founder when the agent couldn't run", async () => {
		await add();
		await drain(
			fakeModel(() =>
				fauxAssistantMessage([], {
					stopReason: "error",
					errorMessage: "invalid api key",
				}),
			),
		);
		const t = await task(1);
		expect(t.status).toBe("blocked");
		expect(t.note).toContain("couldn't work on it");
	});
});

describe("where tasks stand", () => {
	it("shows the founder everything, a steward only theirs", async () => {
		const deps = { store, notifier };
		await createTask(deps, {
			text: "Order napkins",
			requesterKind: "founder",
			requesterKey: "founder",
			requesterName: "Andrea",
		});
		await createTask(deps, {
			text: "Reprint the menus",
			requesterKind: "member",
			requesterKey: "nadya",
			requesterName: "Nadya",
		});
		const all = await tasksText(store, founder);
		expect(all).toContain("Waiting for you:");
		expect(all).toContain("#2 Reprint the menus");
		expect(all).toContain("#1 Order napkins");
		const hers = await tasksText(store, nadya);
		expect(hers).toContain("#2 Reprint the menus");
		expect(hers).not.toContain("napkins");
	});

	it("gives agents talking with the founder a report, limited to what a steward may see", async () => {
		await createTask(
			{ store, notifier },
			{
				text: "Order napkins",
				requesterKind: "founder",
				requesterKey: "founder",
				requesterName: "Andrea",
			},
		);
		const report = (actor: TaskActor) =>
			conversationTaskTools({ store, notifier }, actor).find(
				(t) => t.name === "tasks_report",
			);
		const ctx = {
			runId: "r",
			sessionId: "s",
			agentKey: "host",
			signal: new AbortController().signal,
		};
		expect(
			(await report(founder)?.execute({ number: 1 }, ctx))?.text,
		).toContain("Order napkins");
		expect((await report(nadya)?.execute({ number: 1 }, ctx))?.text).toBe(
			"There's no task #1 you can see.",
		);
	});
});

describe("following up", () => {
	it("reminds a person after three quiet days, and sends the founder one summary a day", async () => {
		const deps = { store, notifier };
		const { task: t } = await createTask(deps, {
			text: "Count the stock",
			requesterKind: "founder",
			requesterKey: "founder",
			requesterName: "Andrea",
		});
		await store.tasks.update(t.id, ["open"], {
			status: "working",
			assigneeKind: "human",
			assigneeKey: "nadya",
		});
		const later = (days: number) =>
			new Date(Date.now() + days * 86_400_000 + 60_000);

		await followUpTasks(deps, later(1));
		expect(toMember).toEqual([]);
		expect(toOwner.at(-1)?.text).toContain("📋 Tasks today");
		const summaries = () =>
			toOwner.filter((m) => m.text.startsWith("📋 Tasks today")).length;
		await followUpTasks(deps, later(1.2));
		expect(summaries()).toBe(1); // not twice the same day

		await followUpTasks(deps, later(3));
		expect(toMember.at(-1)).toMatchObject({ key: "nadya" });
		expect(toMember.at(-1)?.text).toContain("How's #1 Count the stock going?");
		expect(summaries()).toBe(2);
		await followUpTasks(deps, later(3.5));
		expect(toMember).toHaveLength(1); // reminded once, not every heartbeat
	});
});
