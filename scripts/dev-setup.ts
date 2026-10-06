// The setup gate to build its screens against (`pnpm dev:setup`): a runtime
// with no company yet, in a throwaway folder, drafting with a scripted model
// that always plans the same small bakery — no keys, no Telegram, nothing
// leaves this machine. The console's dev server (`pnpm dev:web`) talks to it
// on :3000. Every start begins a new setup.
//
// Sign in with the development password (the same as `pnpm dev:company`).
// The bot token and model key below are placeholders the gate checks the
// shape of; nothing uses them.
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSetupGate } from "../apps/runtime/src/setup/gate.js";
import {
	fakeModel,
	fauxAssistantMessage,
	fauxText,
} from "../packages/brain/src/testing.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = join(root, ".dev-companies", "setup");
rmSync(home, { recursive: true, force: true });

const plan = {
	template: "restaurant",
	summary: "Fresh bread for the street, ordered the night before",
	vision: null,
	mission: "",
	values: [],
	goals: [],
	teams: [
		{ key: "bakery", name: "Bakery", purpose: "The bread, every night" },
		{ key: "shop", name: "Shop", purpose: "Orders, customers and the books" },
	],
	agents: [
		{
			key: "orders",
			name: "Order taker",
			role: "Takes orders on Telegram and reminds customers",
			instructions: "Answer customers, collect tomorrow's orders by 8 pm.",
			team: "shop",
		},
		{
			key: "books",
			name: "Bookkeeper",
			role: "Drafts the weekly accounts",
			instructions: "Draft the week's income and costs for the founder.",
			team: "shop",
		},
	],
	people: [{ key: "rio", name: "Rio", role: "Night baker", team: "bakery" }],
	responsibilities: [
		{
			key: "r-bread",
			name: "Bread every morning",
			team: "bakery",
			owner: "rio",
		},
		{
			key: "r-flour",
			name: "Flour and suppliers",
			team: "bakery",
			owner: "founder",
		},
		{
			key: "r-orders",
			name: "Orders and customers",
			team: "shop",
			owner: "orders",
		},
		{ key: "r-delivery", name: "Deliveries", team: "shop", owner: "open" },
		{ key: "r-books", name: "Books", team: "shop", owner: "books" },
	],
	successor: null,
};

const gate = await createSetupGate({
	home,
	env: {
		JAMOT_PASSWORD: "jamot-dev-password",
		JAMOT_TELEGRAM_TOKEN: `123456:${"A".repeat(35)}`,
		JAMOT_MODEL: "anthropic",
		JAMOT_MODEL_KEY: "not-a-real-key",
	},
	model: fakeModel(
		() => fauxAssistantMessage([fauxText(JSON.stringify(plan))]),
		{
			tokensPerSecond: 400,
		},
	),
});
const port = Number(process.env.PORT ?? 3000);
await gate.app.listen({ port, host: "127.0.0.1" });
console.log(
	`[dev] the setup gate is open on :${port} — sign in with jamot-dev-password`,
);
const dir = await gate.done;
await gate.stop();
console.log(
	`[dev] set up in ${dir}; stopping (start it with: jamot start --data ${dir} --no-telegram)`,
);
process.exit(0);
