// Two companies, one machine, fully independent (BLUEPRINT S7, D35, D42).
// From the bundle: two companies in two homes, each its own process and port.
// A second start on a running company is refused, naming its process; killing
// one leaves the other answering; the killed one starts again over its stale
// lock. Run in CI after the build.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jamot = join(root, "dist/jamot.mjs");
const children = [];
const fail = (why) => {
	console.error(`isolation check failed: ${why}`);
	for (const c of children) c.process.kill("SIGKILL");
	process.exit(1);
};
const until = async (check, what, ms = 20_000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await check().catch(() => false)) return;
		await new Promise((r) => setTimeout(r, 200));
	}
	fail(`timed out waiting for ${what}`);
};

function company(template, port) {
	const home = mkdtempSync(join(tmpdir(), `jamot-iso-${template}-`));
	const env = { ...process.env, JAMOT_HOME: home };
	const imported = spawnSync(
		process.execPath,
		[jamot, "import", join(root, "templates", `${template}.yaml`)],
		{ env, encoding: "utf8" },
	);
	if (imported.status !== 0) fail(`import ${template}: ${imported.stderr}`);
	const start = () => {
		const child = spawn(
			process.execPath,
			[jamot, "start", "--no-telegram", "--port", String(port)],
			{ env, stdio: ["ignore", "pipe", "pipe"] },
		);
		const c = { process: child, output: "" };
		child.stdout.on("data", (d) => {
			c.output += d;
		});
		child.stderr.on("data", (d) => {
			c.output += d;
		});
		children.push(c);
		return c;
	};
	const health = async () =>
		(await fetch(`http://127.0.0.1:${port}/health`)).json();
	return { template, env, start, health };
}

const port = 3800 + Math.floor(Math.random() * 90);
const a = company("restaurant", port);
const b = company("bali-cafe", port + 100);
let runA = a.start();
b.start();
await until(async () => (await a.health()).ok, "the restaurant to start");
await until(async () => (await b.health()).ok, "the café to start");
const names = [(await a.health()).company, (await b.health()).company];
if (names[0] === names[1]) fail(`both answer as ${names[0]}`);
console.log(`✓ two companies, two processes: ${names.join(" · ")}`);

// A second start on the restaurant's folder is refused, naming the process.
const again = spawnSync(
	process.execPath,
	[jamot, "start", "--no-telegram", "--port", String(port + 50)],
	{ env: a.env, encoding: "utf8", timeout: 20_000 },
);
if (again.status === 0 || !again.stderr.includes(`process ${runA.process.pid}`))
	fail(
		`a second start wasn't refused by name: ${again.stderr || again.stdout}`,
	);
console.log(
	`✓ a second start is refused: ${again.stderr.trim().replace(/^jamot: /, "")}`,
);

// Kill the restaurant without warning: the café doesn't notice.
runA.process.kill("SIGKILL");
await new Promise((r) => setTimeout(r, 1_000));
const stillThere = await b.health().catch(() => null);
if (!stillThere?.ok)
	fail("the café stopped answering when the restaurant died");
const gone = await a.health().catch(() => null);
if (gone) fail("the restaurant still answers after SIGKILL");
console.log("✓ killing one company leaves the other answering");

// The restaurant starts again over the lock its killed process left.
runA = a.start();
await until(
	async () => (await a.health()).ok,
	"the restaurant to restart over its stale lock",
);
console.log("✓ a crashed company starts again");

for (const c of children) c.process.kill("SIGTERM");
console.log("isolation check passed");
