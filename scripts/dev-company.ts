// A company to build the console against (`pnpm dev:company`): the restaurant
// template, with people, conversations, notes, runs and proposals waiting, on
// the scripted demo model — no keys, no Telegram, nothing leaves this
// machine. The console's dev server (`pnpm dev:web`) talks to it on :3000.
//
//   pnpm dev:company            start it (created and seeded the first time)
//   pnpm dev:company --fresh    throw it away and seed a new one
//
// Sign in with the development password below. It's a test value for this
// local company only.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword, PASSWORD_SETTING } from "../apps/runtime/src/auth.js";
import {
	importCompany,
	openCompany,
} from "../apps/runtime/src/cli/commands.js";
import { createRuntime, MODEL_SETTING } from "../apps/runtime/src/runtime.js";
import { DEMO_PROVIDER } from "../packages/brain/src/index.js";
import {
	addConnection,
	propose,
	receiveMessage,
} from "../packages/core/src/index.js";

export const DEV_PASSWORD = "jamot-dev-password";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, ".dev-companies", "ui");
const port = Number(process.env.PORT ?? 3000);

if (process.argv.includes("--fresh"))
	rmSync(dir, { recursive: true, force: true });

if (!existsSync(join(dir, "company.db"))) {
	mkdirSync(dir, { recursive: true });
	await importCompany(join(root, "templates", "restaurant.yaml"), dir);
	const c = openCompany(dir);
	try {
		await seed(c.store);
	} finally {
		c.close();
	}
	console.log(`[dev] seeded a company in ${dir}`);
}

const runtime = await createRuntime({
	dataDir: dir,
	telegram: false,
	port,
	log: (m) => console.log(m),
});
await runtime.start({ telegram: false });
console.log(
	`[dev] company on http://127.0.0.1:${port} — console: pnpm dev:web, password: ${DEV_PASSWORD}`,
);
const stop = async () => {
	await runtime.stop();
	process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

/** Enough of everything for every screen to have something to show. */
async function seed(
	store: Awaited<ReturnType<typeof openCompany>>["store"],
): Promise<void> {
	await store.settings.set(MODEL_SETTING, {
		provider: DEMO_PROVIDER,
		modelId: "demo",
	});
	await store.settings.set(PASSWORD_SETTING, await hashPassword(DEV_PASSWORD));

	const now = Date.now();
	const ago = (minutes: number) =>
		new Date(now - minutes * 60_000).toISOString();
	const people = [
		{
			id: "1001",
			name: "Giulia Rossi",
			text: "Do you have a table for four tonight at 8?",
			at: 30,
		},
		{
			id: "1002",
			name: "Marco Bianchi",
			text: "Is the tiramisù gluten free? My daughter is coeliac.",
			at: 90,
		},
		{
			id: "1003",
			name: "Aisha Khan",
			text: "Thank you for last night — the risotto was wonderful.",
			at: 60 * 26,
		},
		{
			id: "1004",
			name: "Tomás Herrera de la Fuente y Castellanos",
			text: "Can I book the whole room for a birthday on the 14th? We would be about thirty people and would like a set menu.",
			at: 60 * 50,
		},
	];
	for (const [i, p] of people.entries())
		await receiveMessage(store, {
			channel: "telegram",
			threadId: p.id,
			messageId: `seed-${i}`,
			from: { userId: p.id, displayName: p.name },
			text: p.text,
			at: ago(p.at),
		});

	const found = await store.people.list({ search: "", limit: 10 });
	const marco = found.find((p) => p.displayName === "Marco Bianchi");
	if (marco)
		await store.memory.store({
			scope: "person",
			ownerId: marco.id,
			kind: "fact",
			content: "His daughter is coeliac: no gluten at all.",
			source: "human",
		});
	await store.memory.store({
		scope: "company",
		ownerId: null,
		kind: "fact",
		content: "The flour supplier closes for all of August.",
		source: "human",
	});

	// What the agents did: one fine, one that failed.
	const agents = (await store.graph.listNodes()).filter(
		(n) => n.kind === "agent",
	);
	const host = agents[0]?.key ?? "host";
	const done = await store.runs.start({
		sessionId: "seed:host",
		agentKey: host,
		model: "demo/demo",
		trigger: "heartbeat:h-pulse",
		input: null,
	});
	await store.runs.addUsage(done.id, {
		inputTokens: 1800,
		outputTokens: 240,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		costMicroUsd: 4200,
	});
	await store.runs.finish(done.id, {
		status: "done",
		output: "Checked the day: two bookings tonight, one question waiting.",
	});
	const failed = await store.runs.start({
		sessionId: "seed:buyer",
		agentKey: agents[1]?.key ?? host,
		model: "demo/demo",
		trigger: "heartbeat:h-office",
		input: null,
	});
	await store.runs.finish(failed.id, {
		status: "error",
		error: "The supplier's order page didn't answer in time.",
	});

	// An outside AI connected as an agent, with a proposal waiting.
	const { connection } = await addConnection(store, { nodeKey: host });
	const run = await store.runs.start({
		sessionId: `mcp:${connection.id}`,
		agentKey: host,
		model: "external (MCP)",
		trigger: "mcp:propose",
		input: null,
	});
	await store.runs.finish(run.id, { status: "done", output: null });
	await propose(
		store,
		{ connectionId: connection.id, nodeKey: host, runId: run.id },
		{ kind: "assign_owner", responsibilityKey: "r-reviews", ownerKey: host },
	);
}
