import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";

interface SettingsData {
	model: { provider: string; modelId: string; baseUrl?: string } | null;
	modelKeySet: boolean;
	owner: { name: string } | null;
	successor: { name: string } | null;
	version: string;
}

export function Settings() {
	const [s, setS] = useState<SettingsData | null>(null);
	const [provider, setProvider] = useState("anthropic");
	const [modelId, setModelId] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [notice, setNotice] = useState<string | null>(null);
	const [code, setCode] = useState<{ role: string; code: string } | null>(null);
	const [mcp, setMcp] = useState<{ url: string; token: string } | null>(null);

	const load = useCallback(
		() =>
			api<SettingsData>("/settings").then((d) => {
				setS(d);
				if (d.model) {
					setProvider(d.model.provider);
					setModelId(d.model.modelId);
				}
			}),
		[],
	);
	useEffect(() => {
		load();
	}, [load]);
	if (!s) return <p className="muted">Loading…</p>;

	return (
		<>
			<header className="head">
				<h1>Settings</h1>
				<span className="muted small">Jamot {s.version}</span>
			</header>
			{notice && <p className="notice">{notice}</p>}

			<section className="card">
				<h2>Model</h2>
				<p className="muted small">
					The model your agents think with. The key is stored encrypted and
					never shown again.
				</p>
				<form
					className="stack"
					onSubmit={async (e) => {
						e.preventDefault();
						await api("/settings/model", {
							method: "PUT",
							body: { provider, modelId, ...(apiKey ? { apiKey } : {}) },
						});
						setApiKey("");
						setNotice("Model saved.");
						load();
					}}
				>
					<label>
						Provider
						<select
							value={provider}
							onChange={(e) => setProvider(e.target.value)}
						>
							<option value="anthropic">Anthropic</option>
							<option value="openai">OpenAI</option>
							<option value="openrouter">OpenRouter</option>
							<option value="ollama">Ollama (on this machine)</option>
						</select>
					</label>
					<label>
						Model
						<input
							value={modelId}
							onChange={(e) => setModelId(e.target.value)}
							placeholder="claude-sonnet-5"
						/>
					</label>
					{provider !== "ollama" && (
						<label>
							API key{" "}
							{s.modelKeySet && (
								<span className="muted small">
									(one is stored — leave empty to keep it)
								</span>
							)}
							<input
								type="password"
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
								autoComplete="off"
							/>
						</label>
					)}
					<button type="submit" disabled={!modelId}>
						Save
					</button>
				</form>
			</section>

			<section className="card">
				<h2>Telegram</h2>
				<ul className="list">
					<li>
						<span>Owner</span>
						<span>{s.owner ? `✅ ${s.owner.name}` : "not paired"}</span>
					</li>
					<li>
						<span>Successor — contacted if the owner goes silent</span>
						<span>{s.successor ? `✅ ${s.successor.name}` : "not named"}</span>
					</li>
				</ul>
				<div className="row">
					{(["owner", "successor"] as const).map((role) => (
						<button
							key={role}
							type="button"
							className="secondary"
							onClick={async () =>
								setCode({
									role,
									code: (
										await api<{ code: string }>("/pairing", {
											method: "POST",
											body: { role },
										})
									).code,
								})
							}
						>
							Pairing code for the {role}
						</button>
					))}
				</div>
				{code && (
					<p className="notice">
						From the {code.role}'s Telegram, send the company's bot:{" "}
						<code>/start {code.code}</code> — it works once, for 24 hours.
					</p>
				)}
			</section>

			<section className="card">
				<h2>Your AI</h2>
				<p className="muted small">
					Connect Claude, Cursor or any MCP client to this company. It can read
					and take notes; it can't approve anything.
				</p>
				{mcp ? (
					<>
						<p>
							URL <code>{mcp.url}</code>
						</p>
						<p>
							Token <code className="secret">{mcp.token}</code>
						</p>
						<pre>{`claude mcp add --transport http my-company ${mcp.url} --header "Authorization: Bearer ${mcp.token}"`}</pre>
					</>
				) : (
					<button
						type="button"
						className="secondary"
						onClick={async () => setMcp(await api("/mcp"))}
					>
						Show address and token
					</button>
				)}
			</section>

			<section className="card">
				<h2>Your company, as a file</h2>
				<p className="muted small">
					The structure of the company — teams, responsibilities, agents,
					heartbeats. Fork it, share it, start another company from it. For a
					full export with its memory, run <code>jamot export</code>.
				</p>
				<a
					className="button secondary"
					href="/api/company.yaml"
					download="company.yaml"
				>
					Download company.yaml
				</a>
			</section>
		</>
	);
}
