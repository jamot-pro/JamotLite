import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parseCompanyFile, stringifyCompanyFile } from "@jamot/company-file";
import type { CompanyFile } from "@jamot/contracts";
import {
	computeVitals,
	createSecretBox,
	createSecrets,
	exportCompanyFile,
	importCompanyFile,
	loadOrCreateSecretKey,
	type Secrets,
} from "@jamot/core";
import type { CompanyStore } from "@jamot/ports";
import {
	type DatabaseSummary,
	inspectCompanyDb,
	openCompanyStore,
} from "@jamot/sqlite";
import { Cron } from "croner";
import { hashPassword, PASSWORD_SETTING } from "../auth.js";
import {
	backupsDir,
	listBackups,
	stageRestore,
	takeBackup,
} from "../backups.js";
import {
	BOT_TOKEN_SECRET,
	createRuntime,
	MCP_TOKEN_SECRET,
	MODEL_KEY_SECRET,
	MODEL_SETTING,
	VERSION,
} from "../runtime.js";
import { templatesDir } from "./paths.js";

/**
 * What the `jamot` commands do, as plain functions: the CLI (cli.ts) only
 * parses arguments and asks questions. Each opens the company folder, does
 * its work and closes it — they can run next to a running `jamot start`.
 */

export interface Company {
	dir: string;
	store: CompanyStore;
	secrets: Secrets;
	close(): void;
}

export function openCompany(dir: string): Company {
	if (!existsSync(join(dir, "company.db")))
		throw new Error(`no company in ${dir}`);
	const store = openCompanyStore(join(dir, "company.db"));
	const secrets = createSecrets(
		store.secrets,
		createSecretBox(loadOrCreateSecretKey(join(dir, "secrets.key"))),
	);
	return { dir, store, secrets, close: () => store.close() };
}

export function listTemplates(): {
	id: string;
	name: string;
	summary: string;
	file: CompanyFile;
}[] {
	return readdirSync(templatesDir())
		.filter((f) => f.endsWith(".yaml"))
		.sort()
		.map((f) => {
			const parsed = parseCompanyFile(
				readFileSync(join(templatesDir(), f), "utf8"),
			);
			if (!parsed.ok)
				throw new Error(`template ${f}: ${parsed.errors.join("; ")}`);
			return {
				id: parsed.file.company.id,
				name: parsed.file.company.name,
				summary: parsed.file.company.summary,
				file: parsed.file,
			};
		});
}

export interface SetupInput {
	dir: string;
	/** A template id, or a path to a company.yaml. */
	template: string;
	name?: string;
	timezone?: string;
	ownerName: string;
	password: string;
	model: {
		provider: "anthropic" | "openai" | "openrouter" | "ollama";
		modelId: string;
		apiKey?: string;
		baseUrl?: string;
	};
	telegramToken: string;
}

export const TELEGRAM_TOKEN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;

/** Creates a company folder, ready for `jamot start`. Returns the owner's Telegram pairing code. */
export async function setup(
	input: SetupInput,
): Promise<{ pairingCode: string; companyName: string }> {
	if (existsSync(join(input.dir, "company.db")))
		throw new Error(`${input.dir} already holds a company`);
	if (!TELEGRAM_TOKEN.test(input.telegramToken))
		throw new Error(
			"that doesn't look like a Telegram bot token (it comes from @BotFather)",
		);
	const file = loadTemplate(input.template);
	if (input.name) file.company.name = input.name;
	if (input.timezone) {
		new Intl.DateTimeFormat("en", { timeZone: input.timezone }); // throws on an unknown zone
		file.company.timezone = input.timezone;
	}
	const passwordHash = await hashPassword(input.password);

	mkdirSync(input.dir, { recursive: true, mode: 0o700 });
	const company = openCompanyStore(join(input.dir, "company.db"));
	const secrets = createSecrets(
		company.secrets,
		createSecretBox(loadOrCreateSecretKey(join(input.dir, "secrets.key"))),
	);
	try {
		await secrets.set(BOT_TOKEN_SECRET, input.telegramToken);
		if (input.model.apiKey)
			await secrets.set(MODEL_KEY_SECRET, input.model.apiKey);
		const { apiKey: _key, ...model } = input.model;
		await company.settings.set(MODEL_SETTING, model);
		await company.settings.set(PASSWORD_SETTING, passwordHash);
	} finally {
		company.close();
	}

	// The runtime makes the pairing code (and the MCP token) — without starting.
	const runtime = await createRuntime({ dataDir: input.dir, log: () => {} });
	try {
		await runtime.importCompany(file, {
			refId: "owner",
			name: input.ownerName,
		});
		return {
			pairingCode: await runtime.telegram.createPairingCode("owner"),
			companyName: file.company.name,
		};
	} finally {
		await runtime.stop();
	}
}

export function loadTemplate(template: string): CompanyFile {
	const path = existsSync(template)
		? template
		: join(templatesDir(), `${template}.yaml`);
	if (!existsSync(path)) {
		throw new Error(
			`no template "${template}" — pick one of: ${listTemplates()
				.map((t) => t.id)
				.join(", ")}`,
		);
	}
	const parsed = parseCompanyFile(readFileSync(path, "utf8"));
	if (!parsed.ok) throw new Error(`${path}:\n  ${parsed.errors.join("\n  ")}`);
	return parsed.file;
}

export async function status(dir: string): Promise<string> {
	const c = openCompany(dir);
	try {
		const company = await c.store.graph.getCompany();
		const v = await computeVitals(c.store, { dataDir: dir });
		const owner = await c.store.settings.get<{ name: string }>(
			"telegram.owner",
		);
		const pending = await c.store.approvals.list({ status: "pending" });
		const day = await c.store.runs.totals({
			since: new Date(Date.now() - 86_400_000).toISOString(),
		});
		const money =
			v.money.currency && v.money.balance !== null
				? `${(v.money.balance / 100).toFixed(2)} ${v.money.currency}${v.money.runwayDays !== null ? `, ${v.money.runwayDays} days of runway` : ""}`
				: "not tracked yet (no ledger entries)";
		return [
			`${company?.name ?? "?"}  (${dir})`,
			`  Owned       ${Math.round((v.people.readiness.dimensions.find((d) => d.key === "responsibilities")?.score ?? 0) * 100)}% of responsibilities have an owner${v.people.readiness.covered ? "  — fully covered ✅" : ""}`,
			`  Unowned     ${v.people.unowned.map((u) => u.name).join(" · ") || "none"}`,
			`  Survival    ${v.tier}`,
			`  Money       ${money}`,
			`  Waiting     ${v.work.waiting.length} customer(s) waiting for an answer`,
			`  Approvals   ${pending.length} waiting for you`,
			`  Last 24 h   ${day.runs} agent run(s), $${(day.costMicroUsd / 1_000_000).toFixed(4)}`,
			`  Owner       ${owner ? `${owner.name} (Telegram)` : "not paired yet — run `jamot pair`"}`,
		].join("\n");
	} finally {
		c.close();
	}
}

export interface Check {
	name: string;
	ok: boolean;
	detail: string;
}

/** Everything that can stop the company from running, checked. `live` also calls Telegram. */
export async function doctor(
	dir: string,
	opts: { live?: boolean } = {},
): Promise<Check[]> {
	const checks: Check[] = [];
	const add = (name: string, ok: boolean, detail: string) =>
		checks.push({ name, ok, detail });
	const [major, minor] = process.versions.node.split(".").map(Number) as [
		number,
		number,
	];
	add(
		"Node.js",
		major > 22 || (major === 22 && minor >= 19),
		`${process.versions.node} (22.19 or newer needed)`,
	);

	const keyPath = join(dir, "secrets.key");
	if (existsSync(keyPath)) {
		const mode = statSync(keyPath).mode & 0o777;
		add(
			"secrets.key",
			mode === 0o600,
			mode === 0o600
				? "readable only by you"
				: `mode ${mode.toString(8)} — run chmod 600 ${keyPath}`,
		);
	} else {
		add(
			"secrets.key",
			false,
			"missing: the stored secrets can't be read without it",
		);
	}

	const c = openCompany(dir);
	try {
		const company = await c.store.graph.getCompany();
		add(
			"Company",
			company !== null,
			company ? company.name : "no company imported",
		);
		const model = await c.store.settings.get<{
			provider: string;
			modelId: string;
		}>(MODEL_SETTING);
		const refs = await c.secrets.list();
		add(
			"Model",
			model !== null &&
				(model.provider === "ollama" || refs.includes(MODEL_KEY_SECRET)),
			model
				? `${model.provider}/${model.modelId}${model.provider !== "ollama" && !refs.includes(MODEL_KEY_SECRET) ? " — no API key stored" : ""}`
				: "not configured",
		);
		add(
			"Telegram bot",
			refs.includes(BOT_TOKEN_SECRET),
			refs.includes(BOT_TOKEN_SECRET) ? "token stored" : "no bot token",
		);
		if (opts.live && refs.includes(BOT_TOKEN_SECRET)) {
			const token = await c.secrets.get(BOT_TOKEN_SECRET);
			const res = await fetch(`https://api.telegram.org/bot${token}/getMe`)
				.then(
					(r) =>
						r.json() as Promise<{ ok: boolean; result?: { username: string } }>,
				)
				.catch(() => ({ ok: false }));
			add(
				"Telegram reachable",
				res.ok === true,
				res.ok
					? `@${(res as { result: { username: string } }).result.username}`
					: "Telegram refused the token, or can't be reached",
			);
		}
		const owner = await c.store.settings.get<{ name: string }>(
			"telegram.owner",
		);
		add(
			"Owner paired",
			owner !== null,
			owner ? owner.name : "run `jamot pair` and send the code to the bot",
		);
		const passwordSet = (await c.store.settings.get(PASSWORD_SETTING)) !== null;
		add(
			"Console password",
			passwordSet,
			passwordSet ? "set" : "not set — run `jamot password`",
		);
		add(
			"MCP token",
			refs.includes(MCP_TOKEN_SECRET),
			refs.includes(MCP_TOKEN_SECRET)
				? "created"
				: "created on the first start",
		);

		const bad: string[] = [];
		for (const n of await c.store.graph.listNodes()) {
			if (n.kind !== "heartbeat") continue;
			try {
				new Cron(String(n.config.schedule), {
					paused: true,
					timezone: company?.timezone ?? "UTC",
				});
			} catch {
				bad.push(`${n.key} ("${n.config.schedule}")`);
			}
		}
		add(
			"Heartbeat schedules",
			bad.length === 0,
			bad.length ? `can't read: ${bad.join(", ")}` : "all readable",
		);

		const dead = await c.store.jobs.list({ status: "dead", limit: 5 });
		add(
			"Background jobs",
			dead.length === 0,
			dead.length
				? `${dead.length} gave up; last error: ${dead[0]?.lastError}`
				: "none failing",
		);
		const v = await computeVitals(c.store, { dataDir: dir });
		add(
			"Backups",
			v.runtime.lastBackupAt !== null &&
				Date.now() - Date.parse(v.runtime.lastBackupAt) < 48 * 3_600_000,
			v.runtime.lastBackupAt
				? `last ${v.runtime.lastBackupAt}`
				: "never — run `jamot backup`",
		);
		if (v.runtime.diskFreeBytes !== null) {
			add(
				"Disk",
				v.runtime.diskFreeBytes > 500 * 1024 * 1024,
				`${Math.round(v.runtime.diskFreeBytes / 1024 / 1024)} MB free`,
			);
		}
	} finally {
		c.close();
	}
	return checks;
}

/** A consistent copy of the company's data, taken while it may be running. */
export async function backup(dir: string, to?: string): Promise<string> {
	const c = openCompany(dir);
	try {
		return await takeBackup(c.store, dir, to ? { to } : {});
	} finally {
		c.close();
	}
}

/**
 * Checks a backup and stages it; the next `jamot start` swaps it in.
 * `latest` is the newest daily snapshot. A dry run only says what's in it.
 */
export function restore(
	dir: string,
	from: string,
	opts: { dryRun?: boolean } = {},
): { file: string; summary: DatabaseSummary } {
	const file = from === "latest" ? listBackups(dir)[0] : from;
	if (!file) throw new Error(`no backups in ${backupsDir(dir)} yet`);
	const summary = opts.dryRun
		? inspectCompanyDb(file)
		: stageRestore(dir, file);
	return { file, summary };
}

/**
 * Exports the company to a folder: `company.yaml` (its structure) and
 * `company.db` (its memory). `secrets.key` only with `withKey` — without it
 * the stored secrets travel unreadable, which is the safe default.
 */
export async function exportCompany(
	dir: string,
	to: string,
	opts: { withKey?: boolean } = {},
): Promise<string[]> {
	mkdirSync(to, { recursive: true, mode: 0o700 });
	if (existsSync(join(to, "company.db")))
		throw new Error(`${to} already holds an export`);
	const c = openCompany(dir);
	try {
		writeFileSync(
			join(to, "company.yaml"),
			stringifyCompanyFile(await exportCompanyFile(c.store.graph)),
		);
		await c.store.backup(join(to, "company.db"));
		chmodSync(join(to, "company.db"), 0o600);
	} finally {
		c.close();
	}
	const written = [join(to, "company.yaml"), join(to, "company.db")];
	if (opts.withKey) {
		copyFileSync(join(dir, "secrets.key"), join(to, "secrets.key"));
		chmodSync(join(to, "secrets.key"), 0o600);
		written.push(join(to, "secrets.key"));
	}
	return written;
}

/** Brings an export (or a bare company.yaml) into a new company folder. */
export async function importCompany(
	from: string,
	dir: string,
): Promise<"data" | "structure"> {
	if (existsSync(join(dir, "company.db")))
		throw new Error(`${dir} already holds a company`);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	if (existsSync(join(from, "company.db"))) {
		copyFileSync(join(from, "company.db"), join(dir, "company.db"));
		chmodSync(join(dir, "company.db"), 0o600);
		if (existsSync(join(from, "secrets.key"))) {
			copyFileSync(join(from, "secrets.key"), join(dir, "secrets.key"));
			chmodSync(join(dir, "secrets.key"), 0o600);
		}
		openCompany(dir).close(); // migrates it to this version
		return "data";
	}
	const yaml = from.endsWith(".yaml") ? from : join(from, "company.yaml");
	const file = loadTemplate(yaml);
	const store = openCompanyStore(join(dir, "company.db"));
	try {
		await importCompanyFile(store.graph, file);
	} finally {
		store.close();
	}
	return "structure";
}

export async function setSecret(
	dir: string,
	ref: string,
	value: string,
): Promise<void> {
	if (!/^[a-z0-9._-]+$/i.test(ref))
		throw new Error(
			"a secret name uses letters, digits, dots, dashes and underscores",
		);
	const c = openCompany(dir);
	try {
		await c.secrets.set(ref, value);
	} finally {
		c.close();
	}
}

export async function setPassword(
	dir: string,
	password: string,
): Promise<void> {
	const hash = await hashPassword(password);
	const c = openCompany(dir);
	try {
		await c.store.settings.set(PASSWORD_SETTING, hash);
	} finally {
		c.close();
	}
}

export async function mcpInfo(
	dir: string,
	port = 3000,
): Promise<{ url: string; token: string | null }> {
	const c = openCompany(dir);
	try {
		return {
			url: `http://127.0.0.1:${port}/mcp`,
			token: await c.secrets.get(MCP_TOKEN_SECRET),
		};
	} finally {
		c.close();
	}
}

/** A new pairing code for the owner or the successor. */
export async function pair(
	dir: string,
	role: "owner" | "successor",
): Promise<string> {
	const runtime = await createRuntime({ dataDir: dir, log: () => {} });
	try {
		return await runtime.telegram.createPairingCode(role);
	} finally {
		await runtime.stop();
	}
}

/**
 * Writes a service definition so the company starts with the machine and
 * restarts if it stops. It doesn't enable it: that is the owner's call, and
 * the commands to do it are returned.
 */
export function serviceInstall(
	dir: string,
	cliPath: string,
): { path: string; enable: string[] } {
	const id = basename(dir);
	if (process.platform === "darwin") {
		const label = `pro.jamot.${id}`;
		const path = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
		mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
		writeFileSync(
			path,
			`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>
    <string>${process.execPath}</string><string>${cliPath}</string><string>start</string><string>--data</string><string>${dir}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join(dir, "jamot.log")}</string>
  <key>StandardErrorPath</key><string>${join(dir, "jamot.log")}</string>
</dict></plist>
`,
		);
		return { path, enable: [`launchctl load -w ${path}`] };
	}
	const path = join(
		homedir(),
		".config",
		"systemd",
		"user",
		`jamot-${id}.service`,
	);
	mkdirSync(join(homedir(), ".config", "systemd", "user"), { recursive: true });
	writeFileSync(
		path,
		`[Unit]
Description=Jamot Lite — ${id}
After=network-online.target

[Service]
ExecStart=${process.execPath} ${cliPath} start --data ${dir}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`,
	);
	return {
		path,
		enable: [
			"systemctl --user daemon-reload",
			`systemctl --user enable --now jamot-${id}`,
			"loginctl enable-linger $USER   # keep it running after you log out",
		],
	};
}

export { VERSION };
