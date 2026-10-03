// `jamot demo` works from the bundle with no keys and no network (BLUEPRINT S6):
// start it, post one message in the web chat, and wait for the demo reply.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 3900 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${port}`;
const demo = spawn(
	process.execPath,
	[join(root, "dist/jamot.mjs"), "demo", "--no-open", "--port", String(port)],
	{ stdio: ["ignore", "pipe", "pipe"] },
);
let output = "";
demo.stdout.on("data", (d) => {
	output += d;
});
demo.stderr.on("data", (d) => {
	output += d;
});

const fail = (why) => {
	console.error(`demo check failed: ${why}\n--- jamot demo said:\n${output}`);
	demo.kill();
	process.exit(1);
};
const until = async (check, what, ms = 20_000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const value = await check().catch(() => null);
		if (value) return value;
		await new Promise((r) => setTimeout(r, 250));
	}
	fail(`timed out waiting for ${what}`);
};

await until(
	() => Promise.resolve(output.includes("/chat")),
	"the demo to start",
);
const page = await fetch(`${base}/chat`);
if (page.status !== 200) fail(`/chat answered ${page.status}`);
const cookie = (page.headers.get("set-cookie") ?? "").split(";")[0];
const sent = await fetch(`${base}/chat/messages`, {
	method: "POST",
	headers: { "content-type": "application/json", cookie },
	body: JSON.stringify({ text: "Hello! Who are you?" }),
});
if (sent.status !== 202) fail(`posting answered ${sent.status}`);
const reply = await until(async () => {
	const { messages } = await (
		await fetch(`${base}/chat/history`, { headers: { cookie } })
	).json();
	return messages.find((m) => m.from === "company");
}, "the demo reply");
if (!reply.text.includes("Demo model"))
	fail(`the reply isn't labelled: ${reply.text}`);
console.log(
	`demo check: the demo company answered ✓\n  "${reply.text.split("\n")[0]}"`,
);
demo.kill();
