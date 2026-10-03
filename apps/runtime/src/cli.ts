import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Connection } from "@jamot/core";
import {
	backup,
	doctor,
	exportCompany,
	importCompany,
	importTarget,
	listTemplates,
	loadTemplate,
	mcpConnections,
	mcpInfo,
	pair,
	prepareDemo,
	restore,
	serviceInstall,
	setPassword,
	setSecret,
	setup,
	status,
	TELEGRAM_TOKEN,
	VERSION,
	webchat,
} from "./cli/commands.js";
import { companyDir, jamotHome, webRoot } from "./cli/paths.js";
import { createRuntime } from "./runtime.js";

const HELP = `jamot ${VERSION} — one company, one runtime

  jamot demo [template]       try it: a throwaway company you talk to in the browser,
                              no keys (--no-open: don't open the browser)
  jamot setup                 create a company from a template (asks a few questions)
  jamot start                 run it: Telegram, heartbeats, the console on :3000
  jamot status                how the company is doing
  jamot ask "<question>"      ask an agent directly (--agent <key>)
  jamot doctor [--live]       check everything it needs to run
  jamot pair [successor]      a new code to link the owner's (or successor's) Telegram
  jamot mcp                   the address and token for your own AI
  jamot mcp add <key>         connect an outside agent as an agent/person of the map
                              (--people lets it see people); mcp list, mcp revoke <id>
  jamot backup [--to file]    a consistent copy of the data, while it runs
                              (one is taken every day on its own; the last 7 are kept)
  jamot restore <file|latest> put a backup back on the next start (--dry-run: just look)
  jamot export --to <dir>     company.yaml + company.db  (--with-key adds secrets.key)
  jamot import <dir|yaml>     start a company from an export or a company.yaml,
                              in a folder named after its id (--as <id> to rename)
  jamot secret set <name>     store a secret (e.g. a tool's token), encrypted
  jamot webchat on|off|status a chat page at /chat for customers (--cap <dollars> a day)
  jamot password              change the console password
  jamot templates             the companies you can start from
  jamot service install       start with the machine (writes the service file)

Options: --company <id>  --data <dir>  --port <n>  --host <addr>  --no-telegram
Companies live in ${jamotHome()} (set JAMOT_HOME to change it).`;

const DEFAULT_MODELS = {
	anthropic: "claude-sonnet-5",
	openai: "gpt-5",
	openrouter: "anthropic/claude-sonnet-5",
	ollama: "llama3.1",
} as const;

async function main(argv: string[]): Promise<number> {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			company: { type: "string" },
			data: { type: "string" },
			port: { type: "string" },
			host: { type: "string" },
			to: { type: "string" },
			template: { type: "string" },
			live: { type: "boolean" },
			"no-telegram": { type: "boolean" },
			"with-key": { type: "boolean" },
			"dry-run": { type: "boolean" },
			people: { type: "boolean" },
			"no-open": { type: "boolean" },
			as: { type: "string" },
			cap: { type: "string" },
			yes: { type: "boolean", short: "y" },
			agent: { type: "string" },
			help: { type: "boolean", short: "h" },
			version: { type: "boolean", short: "v" },
		},
	});
	const [command, ...rest] = positionals;
	if (values.version) return print(VERSION);
	if (values.help || !command || command === "help") return print(HELP);
	const where = {
		...(values.data ? { data: values.data } : {}),
		...(values.company ? { company: values.company } : {}),
	};

	switch (command) {
		case "templates":
			for (const t of listTemplates())
				console.log(`  ${t.id.padEnd(22)} ${t.name} — ${t.summary}`);
			return 0;

		case "demo": {
			const demo = await prepareDemo(rest[0] ?? values.template);
			const runtime = await createRuntime({
				dataDir: demo.dir,
				telegram: false,
				port: Number(values.port ?? process.env.PORT ?? 3000),
				host: values.host ?? "127.0.0.1",
				...(webRoot() ? { webRoot: webRoot() as string } : {}),
			});
			const stop = async () => {
				await runtime.stop();
				process.exit(0);
			};
			process.once("SIGINT", stop);
			process.once("SIGTERM", stop);
			await runtime.start({ telegram: false });
			const port = Number(values.port ?? process.env.PORT ?? 3000);
			const base = `http://${values.host ?? "127.0.0.1"}:${port}`;
			console.log(`
${demo.companyName} is running as a demo — scripted replies, no keys, nobody real.

  Talk to it:        ${base}/chat
  Its console:       ${base}   (password: ${demo.password})

It lives in ${demo.dir} and is gone when you delete that folder.
To start a real company: jamot setup.   Stop: Ctrl+C.
`);
			if (values["no-open"] !== true) openInBrowser(`${base}/chat`);
			return new Promise(() => {}); // runs until stopped
		}

		case "setup":
			return runSetup(values.template, where);

		case "start": {
			// A container's first boot: no company yet, and the setup answers
			// in the environment (JAMOT_TEMPLATE, JAMOT_PASSWORD…).
			if (process.env.JAMOT_TEMPLATE && !hasCompany(where))
				await runSetup(undefined, where);
			const dir = companyDir(where);
			const runtime = await createRuntime({
				dataDir: dir,
				telegram: values["no-telegram"] !== true,
				port: Number(values.port ?? process.env.PORT ?? 3000),
				host: values.host ?? process.env.HOST ?? "127.0.0.1",
				...(webRoot() ? { webRoot: webRoot() as string } : {}),
				behindProxy: process.env.JAMOT_BEHIND_PROXY === "1",
			});
			const stop = async () => {
				console.log("\n[runtime] stopping…");
				await runtime.stop();
				process.exit(0);
			};
			process.once("SIGINT", stop);
			process.once("SIGTERM", stop);
			try {
				await runtime.start({ telegram: values["no-telegram"] !== true });
			} catch (err) {
				// Close the port and timers, so the process ends and a supervisor
				// (Render, systemd) shows the failure instead of a half-alive company.
				await runtime.stop();
				throw err;
			}
			return new Promise(() => {}); // runs until stopped
		}

		case "status":
			return print(await status(companyDir(where)));

		case "ask": {
			const question = rest.join(" ").trim();
			if (!question)
				throw new Error('usage: jamot ask "<question>" [--agent <key>]');
			const runtime = await createRuntime({
				dataDir: companyDir(where),
				log: () => {},
			});
			try {
				const outcome = await runtime.ask(question, values.agent);
				if (outcome.status === "done" || outcome.status === "awaiting_approval")
					return print(outcome.text);
				throw new Error(outcome.message);
			} finally {
				await runtime.stop();
			}
		}

		case "doctor": {
			const checks = await doctor(companyDir(where), {
				live: values.live === true,
			});
			for (const c of checks)
				console.log(`  ${c.ok ? "✅" : "❌"} ${c.name.padEnd(20)} ${c.detail}`);
			return checks.every((c) => c.ok) ? 0 : 1;
		}

		case "pair": {
			const role = rest[0] === "successor" ? "successor" : "owner";
			const code = await pair(companyDir(where), role);
			return print(
				`Send this to the company's bot on Telegram, from the ${role}'s account, within 24 hours:\n\n  /start ${code}`,
			);
		}

		case "mcp": {
			if (rest[0] === "add" || rest[0] === "list" || rest[0] === "revoke") {
				const { connections, token } = await mcpConnections(
					companyDir(where),
					rest[0],
					rest[1],
					{ people: values.people === true },
				);
				const lines = connections.map(
					(c) =>
						`  ${c.id}  ${c.nodeName} (${c.nodeKey}) · ${c.access}${c.revokedAt ? ` · revoked ${c.revokedAt.slice(0, 10)}` : ""}`,
				);
				if (token) {
					const added = connections.at(-1) as Connection;
					return print(
						`${added.nodeName} can now connect, as ${added.nodeKey}, with ${added.access} access.\n\nToken (shown once — keep it like a password):\n  ${token}\n\nClaude Code:\n  claude mcp add --transport http ${added.nodeKey} <your company address>/mcp --header "Authorization: Bearer ${token}"`,
					);
				}
				return print(
					lines.length
						? lines.join("\n")
						: "No connections yet: jamot mcp add <agent or person key>",
				);
			}
			const info = await mcpInfo(
				companyDir(where),
				Number(values.port ?? 3000),
			);
			return print(
				info.token
					? `URL:   ${info.url}\nToken: ${info.token}\n\nClaude Code:\n  claude mcp add --transport http my-company ${info.url} --header "Authorization: Bearer ${info.token}"`
					: "No token yet — it's created on the first `jamot start`.",
			);
		}

		case "backup":
			return print(
				`Backed up to ${await backup(companyDir(where), values.to)}`,
			);

		case "webchat": {
			const w = await webchat(companyDir(where), rest[0], values.cap);
			return print(
				w.enabled
					? `Web chat is on at /chat, up to $${w.dailyCapUsd} of replies a day. It's public: read docs/recipes/web-chat.md.`
					: "Web chat is off: /chat answers 404.",
			);
		}

		case "restore": {
			const from = rest[0];
			if (!from)
				throw new Error("say which: jamot restore <backup file | latest>");
			const dryRun = values["dry-run"] === true;
			const { file, summary: b } = restore(companyDir(where), from, {
				dryRun,
			});
			return print(
				`${file}\n  company: ${b.company ?? "?"} · ${b.people} people · ${b.memories} memories · last message ${b.lastMessageAt ?? "never"}\n\n${
					dryRun
						? "Nothing changed (dry run)."
						: "Staged. Restart the company to put it back; the company as it is now is kept in backups/."
				}`,
			);
		}

		case "export": {
			if (!values.to) throw new Error("say where: jamot export --to <folder>");
			const files = await exportCompany(companyDir(where), values.to, {
				withKey: values["with-key"] === true,
			});
			return print(
				`Exported:\n${files.map((f) => `  ${f}`).join("\n")}${values["with-key"] ? "\n\nThis export includes secrets.key: keep it as safe as a password." : "\n\nsecrets.key isn't included, so stored secrets travel unreadable. Add --with-key to move them too."}`,
			);
		}

		case "import": {
			const from = rest[0];
			if (!from)
				throw new Error(
					"say what: jamot import <export folder | company.yaml>",
				);
			const dir = importTarget(from, {
				...(values.as ? { as: values.as } : {}),
				...(values.data ? { data: values.data } : {}),
			});
			const kind = await importCompany(from, dir);
			return print(
				kind === "data"
					? `Imported the company, with its memory, into ${dir}.`
					: `Started a company from ${from} in ${dir}. Run \`jamot setup\` steps for its model and bot: \`jamot secret set telegram.botToken\`, \`jamot password\`.`,
			);
		}

		case "secret": {
			if (rest[0] !== "set" || !rest[1])
				throw new Error(
					"usage: jamot secret set <name>   (the value is asked, not typed on the command line)",
				);
			await setSecret(
				companyDir(where),
				rest[1],
				await ask(`Value for ${rest[1]}: `, { hidden: true }),
			);
			return print(`Stored ${rest[1]}, encrypted.`);
		}

		case "password": {
			const password = await askNewPassword();
			await setPassword(companyDir(where), password);
			return print("Console password changed.");
		}

		case "service": {
			if (rest[0] !== "install")
				throw new Error("usage: jamot service install");
			const { path, enable } = serviceInstall(
				companyDir(where),
				fileURLToPath(import.meta.url),
			);
			return print(
				`Wrote ${path}\n\nTo turn it on:\n${enable.map((c) => `  ${c}`).join("\n")}`,
			);
		}

		default:
			console.error(`Unknown command "${command}".\n`);
			console.log(HELP);
			return 1;
	}
}

function hasCompany(where: { data?: string; company?: string }): boolean {
	try {
		return existsSync(join(companyDir(where), "company.db"));
	} catch (err) {
		if ((err as Error).message.startsWith("no company")) return false;
		throw err;
	}
}

async function runSetup(
	template: string | undefined,
	where: { data?: string; company?: string },
): Promise<number> {
	const env = process.env;
	const interactive = process.stdin.isTTY && !env.JAMOT_PASSWORD;
	console.log(`Jamot ${VERSION} — let's set up your company.\n`);

	const templates = listTemplates();
	let chosen = template ?? env.JAMOT_TEMPLATE;
	if (!chosen) {
		if (!interactive) throw new Error("set JAMOT_TEMPLATE or pass --template");
		for (const [i, t] of templates.entries())
			console.log(`  ${i + 1}. ${t.name} — ${t.summary}`);
		const pick = Number(
			await ask(`\nWhich company? (1-${templates.length}): `),
		);
		chosen = templates[pick - 1]?.id;
		if (!chosen) throw new Error("pick a number from the list");
	}
	// A template id from the list, or a company.yaml given by its path.
	const base =
		templates.find((t) => t.id === chosen) ??
		(existsSync(chosen) ? loadTemplate(chosen).company : undefined);
	const answer = (
		question: string,
		fallback: string | undefined,
		envValue?: string,
	) =>
		envValue ??
		(interactive ? ask(question) : Promise.resolve("")).then(
			(a) => a.trim() || fallback || "",
		);

	const name = await answer(
		`Company name [${base?.name ?? chosen}]: `,
		base?.name ?? chosen,
		env.JAMOT_NAME,
	);
	const timezone = await answer(
		`Time zone [${Intl.DateTimeFormat().resolvedOptions().timeZone}]: `,
		Intl.DateTimeFormat().resolvedOptions().timeZone,
		env.JAMOT_TIMEZONE,
	);
	const ownerName = await answer("Your name: ", "Owner", env.JAMOT_OWNER);
	const password = env.JAMOT_PASSWORD ?? (await askNewPassword());

	let [provider, modelId] = (env.JAMOT_MODEL ?? "").split("/", 2) as [
		string?,
		string?,
	];
	if (env.JAMOT_MODEL?.startsWith("openrouter/"))
		modelId = env.JAMOT_MODEL.slice("openrouter/".length);
	if (!provider)
		provider = await answer(
			"Model provider (anthropic, openai, openrouter, ollama) [anthropic]: ",
			"anthropic",
		);
	if (!(provider in DEFAULT_MODELS))
		throw new Error(`unknown provider "${provider}"`);
	const p = provider as keyof typeof DEFAULT_MODELS;
	if (!modelId)
		modelId = await answer(`Model [${DEFAULT_MODELS[p]}]: `, DEFAULT_MODELS[p]);
	const apiKey =
		p === "ollama"
			? undefined
			: (env.JAMOT_MODEL_KEY ??
				(await ask(`${provider} API key: `, { hidden: true })));

	let telegramToken = env.JAMOT_TELEGRAM_TOKEN ?? "";
	while (!TELEGRAM_TOKEN.test(telegramToken)) {
		if (!interactive)
			throw new Error(
				"JAMOT_TELEGRAM_TOKEN is missing or doesn't look like a bot token",
			);
		telegramToken = await ask(
			"Telegram bot token (create a bot with @BotFather): ",
			{ hidden: true },
		);
	}

	const dir =
		where.data ??
		join(
			jamotHome(),
			where.company ??
				(chosen.endsWith(".yaml") ? loadTemplate(chosen).company.id : chosen),
		);
	const result = await setup({
		dir,
		template: chosen,
		name,
		timezone,
		ownerName,
		password,
		model: {
			provider: p,
			modelId,
			...(apiKey ? { apiKey } : {}),
			...(env.JAMOT_MODEL_URL ? { baseUrl: env.JAMOT_MODEL_URL } : {}),
		},
		telegramToken,
	});
	return print(`
${result.companyName} is ready in ${dir}.

  1. Start it:            jamot start${where.data ? ` --data ${dir}` : where.company ? ` --company ${where.company}` : ""}
  2. On Telegram, send your bot:   /start ${result.pairingCode}
     (that makes you its owner; the code works once, for 24 hours)
  3. Open the console:    http://127.0.0.1:3000
`);
}

async function ask(
	question: string,
	opts: { hidden?: boolean } = {},
): Promise<string> {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: true,
	});
	if (opts.hidden) {
		// Echo nothing while the secret is typed.
		const out = rl as unknown as {
			_writeToOutput: (s: string) => void;
			output: NodeJS.WriteStream;
		};
		out._writeToOutput = (s: string) => {
			if (s.startsWith(question)) out.output.write(question);
		};
	}
	try {
		const answer = await rl.question(question);
		if (opts.hidden) process.stdout.write("\n");
		return answer;
	} finally {
		rl.close();
	}
}

async function askNewPassword(): Promise<string> {
	for (;;) {
		const first = await ask("Console password (at least 10 characters): ", {
			hidden: true,
		});
		if (first.length < 10) {
			console.log("Too short.");
			continue;
		}
		if ((await ask("Again: ", { hidden: true })) === first) return first;
		console.log("They don't match.");
	}
}

function print(text: string): number {
	console.log(text);
	return 0;
}

main(process.argv.slice(2)).then(
	(code) => {
		if (code !== undefined) process.exitCode = code;
	},
	(err: unknown) => {
		console.error(`jamot: ${err instanceof Error ? err.message : String(err)}`);
		process.exitCode = 1;
	},
);

/** Opens a page in the default browser; quietly does nothing where it can't. */
function openInBrowser(url: string): void {
	const [command, args] =
		process.platform === "darwin"
			? ["open", [url]]
			: process.platform === "win32"
				? ["cmd", ["/c", "start", "", url]]
				: ["xdg-open", [url]];
	try {
		spawn(command as string, args as string[], {
			stdio: "ignore",
			detached: true,
		})
			.on("error", () => undefined)
			.unref();
	} catch {
		// No browser here (a server, CI): the address is printed above.
	}
}
