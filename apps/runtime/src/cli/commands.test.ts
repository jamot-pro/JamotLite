import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	backup,
	doctor,
	exportCompany,
	importCompany,
	importTarget,
	listTemplates,
	openCompany,
	serviceInstall,
	setSecret,
	setup,
	status,
} from "./commands.js";
import { companyDir } from "./paths.js";

const TOKEN = "123456789:AAH-this-is-a-test-token-not-real_xyz"; // gitleaks:allow — a made-up test token
let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "jamot-cli-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const newCompany = (dir = join(root, "restaurant")) =>
	setup({
		dir,
		template: "restaurant",
		timezone: "Europe/Rome",
		ownerName: "Lucia",
		password: "a long enough password",
		model: {
			provider: "anthropic",
			modelId: "claude-sonnet-5",
			apiKey: "sk-ant-test",
		},
		telegramToken: TOKEN,
	});

describe("jamot setup", () => {
	it("creates a company folder ready to start, and a pairing code for the owner", async () => {
		const result = await newCompany();
		expect(result).toMatchObject({
			companyName: "A neighbourhood restaurant",
			pairingCode: expect.stringMatching(/^[A-Z2-9]{8}$/),
		});
		const dir = join(root, "restaurant");
		expect(statSync(join(dir, "secrets.key")).mode & 0o777).toBe(0o600);

		const c = openCompany(dir);
		expect((await c.store.graph.getCompany())?.timezone).toBe("Europe/Rome");
		expect(await c.secrets.get("telegram.botToken")).toBe(TOKEN);
		expect(await c.store.settings.get("model")).toEqual({
			provider: "anthropic",
			modelId: "claude-sonnet-5",
		});
		expect(
			(await c.store.graph.listNodes()).find((n) => n.key === "founder")?.name,
		).toBe("Lucia");
		c.close();
		expect(readFileSync(join(dir, "company.db")).includes("sk-ant-test")).toBe(
			false,
		);
	});

	it("refuses what can't work", async () => {
		await expect(
			setup({
				dir: join(root, "x"),
				template: "restaurant",
				ownerName: "L",
				password: "a long enough password",
				model: { provider: "ollama", modelId: "llama3.1" },
				telegramToken: "nope",
			}),
		).rejects.toThrow(/BotFather/);
		await expect(
			setup({
				dir: join(root, "x"),
				template: "circus",
				ownerName: "L",
				password: "a long enough password",
				model: { provider: "ollama", modelId: "llama3.1" },
				telegramToken: TOKEN,
			}),
		).rejects.toThrow(/no template "circus"/);
		await expect(
			setup({
				dir: join(root, "x"),
				template: "restaurant",
				ownerName: "L",
				password: "short",
				model: { provider: "ollama", modelId: "llama3.1" },
				telegramToken: TOKEN,
			}),
		).rejects.toThrow(/10 characters/);
		await newCompany();
		await expect(newCompany()).rejects.toThrow(/already holds a company/);
	});

	it("lists the seven templates", () => {
		expect(listTemplates().map((t) => t.id)).toHaveLength(7);
	});
});

describe("jamot status, doctor, backup", () => {
	it("reports how the company is doing and what it still needs", async () => {
		await newCompany();
		const dir = join(root, "restaurant");
		const report = await status(dir);
		expect(report).toContain("A neighbourhood restaurant");
		expect(report).toContain("Unowned     Head chef · Floor manager");
		expect(report).toContain("not paired yet");

		const checks = Object.fromEntries(
			(await doctor(dir)).map((c) => [c.name, c.ok]),
		);
		expect(checks).toMatchObject({
			"secrets.key": true,
			Company: true,
			Model: true,
			"Telegram bot": true,
			"Owner paired": false,
			"Heartbeat schedules": true,
			Backups: false,
		});

		const file = await backup(dir);
		expect(existsSync(file)).toBe(true);
		expect(
			Object.fromEntries((await doctor(dir)).map((c) => [c.name, c.ok]))
				.Backups,
		).toBe(true);
	});
});

describe("jamot export and import", () => {
	it("moves a company to another folder; its secrets only travel with the key", async () => {
		await newCompany();
		const dir = join(root, "restaurant");
		await setSecret(dir, "stock.token", "s3cret");

		await exportCompany(dir, join(root, "export"));
		expect(existsSync(join(root, "export", "company.yaml"))).toBe(true);
		expect(existsSync(join(root, "export", "secrets.key"))).toBe(false);
		await importCompany(join(root, "export"), join(root, "moved"));
		const moved = openCompany(join(root, "moved"));
		expect((await moved.store.graph.getCompany())?.name).toBe(
			"A neighbourhood restaurant",
		);
		await expect(moved.secrets.get("stock.token")).rejects.toThrow(
			/can't be decrypted/,
		);
		moved.close();

		await exportCompany(dir, join(root, "export-key"), { withKey: true });
		await importCompany(join(root, "export-key"), join(root, "moved-key"));
		const withKey = openCompany(join(root, "moved-key"));
		expect(await withKey.secrets.get("stock.token")).toBe("s3cret");
		withKey.close();
	});

	it("starts a company from a bare company.yaml", async () => {
		await newCompany();
		await exportCompany(join(root, "restaurant"), join(root, "export"));
		expect(
			await importCompany(
				join(root, "export", "company.yaml"),
				join(root, "fresh"),
			),
		).toBe("structure");
		const fresh = openCompany(join(root, "fresh"));
		expect(await fresh.store.people.list()).toEqual([]);
		fresh.close();
	});
});

describe("one folder per company", () => {
	let before: string | undefined;
	beforeEach(() => {
		before = process.env.JAMOT_HOME;
		process.env.JAMOT_HOME = join(root, "home");
	});
	afterEach(() => {
		if (before === undefined) delete process.env.JAMOT_HOME;
		else process.env.JAMOT_HOME = before;
	});
	const template = (id: string) => join("templates", `${id}.yaml`);

	it("names the folder after the company, so two imports make two companies", async () => {
		for (const id of ["restaurant", "bali-cafe"]) {
			const dir = importTarget(template(id));
			expect(dir).toBe(join(root, "home", id));
			expect(await importCompany(template(id), dir)).toBe("structure");
		}
		expect(companyDir({ company: "bali-cafe" })).toBe(
			join(root, "home", "bali-cafe"),
		);
		// Two companies and no --company: it says which ones there are.
		expect(() => companyDir({})).toThrow(/bali-cafe, restaurant/);
		expect(() => companyDir({ company: "bakery" })).toThrow(
			/no company "bakery" .* there is bali-cafe, restaurant/,
		);
	});

	it("refuses to import over a company, and says how to keep both", async () => {
		const dir = importTarget(template("restaurant"));
		await importCompany(template("restaurant"), dir);
		await expect(importCompany(template("restaurant"), dir)).rejects.toThrow(
			/already holds a company.*--as <id>/,
		);
		const second = importTarget(template("restaurant"), { as: "trattoria-2" });
		await importCompany(template("restaurant"), second);
		expect(existsSync(join(root, "home", "trattoria-2", "company.db"))).toBe(
			true,
		);
	});

	it("only takes an id that can name a folder", () => {
		expect(() =>
			importTarget(template("restaurant"), { as: "../elsewhere" }),
		).toThrow(/can't name a company folder/);
		expect(() => importTarget(join(root, "nothing-here"))).toThrow(
			/no company.yaml.*--as <id>/,
		);
	});
});

describe("jamot service install", () => {
	it("writes a service file and says how to turn it on, without turning it on", async () => {
		const home = process.env.HOME;
		process.env.HOME = root;
		try {
			const { path, enable } = serviceInstall(
				join(root, "restaurant"),
				"/opt/jamot/jamot.mjs",
			);
			expect(readFileSync(path, "utf8")).toContain("/opt/jamot/jamot.mjs");
			expect(enable.join(" ")).toMatch(/launchctl|systemctl/);
			expect(readFileSync(path, "utf8")).not.toContain("--port");
			// A second company on the same machine gets its own port.
			const second = serviceInstall(
				join(root, "bali-cafe"),
				"/opt/jamot/jamot.mjs",
				{ port: 3001 },
			);
			expect(second.path).not.toBe(path);
			expect(readFileSync(second.path, "utf8")).toMatch(/--port.*3001/);
		} finally {
			process.env.HOME = home;
		}
	});
});
