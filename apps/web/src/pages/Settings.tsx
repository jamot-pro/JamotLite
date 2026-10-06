import type { McpInfo, SettingsView } from "@jamot/contracts";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import {
	Actions,
	Button,
	ButtonLink,
	Card,
	ErrorText,
	Field,
	Form,
	Input,
	Item,
	List,
	Loading,
	Muted,
	Notice,
	Page,
	Pre,
	Secret,
	Select,
} from "../ui/index.js";

export function Settings() {
	const [s, setS] = useState<SettingsView | null>(null);
	const [provider, setProvider] = useState("anthropic");
	const [modelId, setModelId] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [notice, setNotice] = useState<string | null>(null);
	const [code, setCode] = useState<{ role: string; code: string } | null>(null);
	const [mcp, setMcp] = useState<McpInfo | null>(null);

	const load = useCallback(
		() =>
			api<SettingsView>("/settings").then((d) => {
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
	if (!s) return <Loading />;

	return (
		<Page title="Settings" actions={<Muted small>Jamot {s.version}</Muted>}>
			{notice && <Notice>{notice}</Notice>}

			<Card title="Model">
				<Muted small block>
					The model your agents think with. The key is stored encrypted and
					never shown again.
				</Muted>
				<Form
					onSubmit={async () => {
						await api("/settings/model", {
							method: "PUT",
							body: { provider, modelId, ...(apiKey ? { apiKey } : {}) },
						});
						setApiKey("");
						setNotice("Model saved.");
						load();
					}}
				>
					<Field label="Provider">
						<Select
							value={provider}
							onChange={(e) => setProvider(e.target.value)}
						>
							<option value="anthropic">Anthropic</option>
							<option value="openai">OpenAI</option>
							<option value="openrouter">OpenRouter</option>
							<option value="ollama">Ollama (on this machine)</option>
						</Select>
					</Field>
					<Field label="Model">
						<Input
							value={modelId}
							onChange={(e) => setModelId(e.target.value)}
							placeholder="claude-sonnet-5"
						/>
					</Field>
					{provider !== "ollama" && (
						<Field
							label="API key"
							hint={
								s.modelKeySet
									? "(one is stored — leave empty to keep it)"
									: undefined
							}
						>
							<Input
								type="password"
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
								autoComplete="off"
							/>
						</Field>
					)}
					<Button type="submit" disabled={!modelId}>
						Save
					</Button>
				</Form>
			</Card>

			<FallbackCard
				settings={s}
				onSaved={(m) => {
					setNotice(m);
					load();
				}}
			/>

			<Card title="Telegram">
				<List>
					<Item>
						<span>Owner</span>
						<span>{s.owner ? `✅ ${s.owner.name}` : "not paired"}</span>
					</Item>
					<Item>
						<span>Successor — contacted if the owner goes silent</span>
						<span>{s.successor ? `✅ ${s.successor.name}` : "not named"}</span>
					</Item>
					<Item>
						<span>Stewards' group — the heartbeats, for everyone</span>
						<span>{s.group ? `✅ ${s.group.title}` : "not connected"}</span>
					</Item>
				</List>
				{!s.group && (
					<Muted small block>
						To connect the group: add the company's bot to it, then send{" "}
						<code>/here</code> in the group from the owner's Telegram.
					</Muted>
				)}
				<Actions>
					{(["owner", "successor"] as const).map((role) => (
						<Button
							key={role}
							variant="secondary"
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
						</Button>
					))}
				</Actions>
				{code && (
					<Notice>
						From the {code.role}'s Telegram, send the company's bot:{" "}
						<code>/start {code.code}</code> — it works once, for 24 hours.
					</Notice>
				)}
			</Card>

			<Card title="Your AI">
				<Muted small block>
					Connect Claude, Cursor or any MCP client to this company. It can read
					and take notes; it can't approve anything.
				</Muted>
				{mcp ? (
					<>
						<p>
							URL <code>{mcp.url}</code>
						</p>
						<p>
							Token <Secret>{mcp.token}</Secret>
						</p>
						<Pre>{`claude mcp add --transport http my-company ${mcp.url} --header "Authorization: Bearer ${mcp.token}"`}</Pre>
					</>
				) : (
					<Button
						variant="secondary"
						onClick={async () => setMcp(await api<McpInfo>("/mcp"))}
					>
						Show address and token
					</Button>
				)}
			</Card>

			<Card title="Your company, as a file">
				<Muted small block>
					The structure of the company — teams, responsibilities, agents,
					heartbeats. Fork it, share it, start another company from it. For a
					full export with its memory, run <code>jamot export</code>.
				</Muted>
				<ButtonLink
					variant="secondary"
					href="/api/company.yaml"
					download="company.yaml"
				>
					Download company.yaml
				</ButtonLink>
			</Card>
		</Page>
	);
}

/**
 * The backup model (D57): when the first is down or rate-limited, agents
 * answer with this one instead of leaving a customer waiting.
 */
function FallbackCard({
	settings: s,
	onSaved,
}: {
	settings: SettingsView;
	onSaved: (message: string) => void;
}) {
	const [provider, setProvider] = useState(
		s.fallback?.provider ?? "openrouter",
	);
	const [modelId, setModelId] = useState(s.fallback?.modelId ?? "");
	const [apiKey, setApiKey] = useState("");
	const [error, setError] = useState<string | null>(null);
	return (
		<Card title="Backup model">
			<Muted small block>
				{s.fallback
					? `When your model is down or busy, agents answer with ${s.fallback.provider}/${s.fallback.modelId}.`
					: "None yet. When your model is down or busy, customers wait until it's back. A model from another provider keeps them answered."}
			</Muted>
			<Form
				onSubmit={async () => {
					setError(null);
					try {
						await api("/settings/model/fallback", {
							method: "PUT",
							body: { provider, modelId, ...(apiKey ? { apiKey } : {}) },
						});
						setApiKey("");
						onSaved("Backup model saved.");
					} catch (err) {
						setError(err instanceof Error ? err.message : String(err));
					}
				}}
			>
				<Field label="Provider">
					<Select
						value={provider}
						onChange={(e) => setProvider(e.target.value)}
					>
						<option value="openrouter">OpenRouter</option>
						<option value="anthropic">Anthropic</option>
						<option value="openai">OpenAI</option>
						<option value="ollama">Ollama (on this machine)</option>
					</Select>
				</Field>
				<Field label="Model">
					<Input
						value={modelId}
						onChange={(e) => setModelId(e.target.value)}
						placeholder="openai/gpt-5-mini"
					/>
				</Field>
				{provider !== "ollama" && (
					<Field
						label="API key"
						hint={
							s.fallbackKeySet
								? "(one is stored — leave empty to keep it)"
								: undefined
						}
					>
						<Input
							type="password"
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							autoComplete="off"
						/>
					</Field>
				)}
				{error && <ErrorText>{error}</ErrorText>}
				<Actions>
					<Button type="submit" disabled={!modelId.trim()}>
						Save
					</Button>
					{s.fallback && (
						<Button
							variant="secondary"
							onClick={async () => {
								await api("/settings/model/fallback", { method: "DELETE" });
								onSaved("Backup model removed.");
							}}
						>
							Remove
						</Button>
					)}
				</Actions>
			</Form>
		</Card>
	);
}
