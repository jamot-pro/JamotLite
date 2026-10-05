import type {
	ActionResult,
	AgentInput,
	AgentRow,
	AgentsView,
} from "@jamot/contracts";
import { useCallback, useEffect, useState } from "react";
import { api, usd, when } from "../api.js";
import {
	Actions,
	Badge,
	Button,
	Card,
	Checkbox,
	ErrorText,
	Field,
	Form,
	Grid,
	Input,
	Label,
	Loading,
	Muted,
	Notice,
	Page,
	Select,
	TextArea,
} from "../ui/index.js";

/**
 * The company's agents (RUNTIME D47): what each one does, where it works,
 * what it may use and what it costs — and the owner's changes to them. What
 * an agent's instructions say is what it does from its next run.
 */
export function Agents() {
	const [view, setView] = useState<AgentsView | null>(null);
	const [note, setNote] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const load = useCallback(() => api<AgentsView>("/agents").then(setView), []);
	useEffect(() => {
		load();
	}, [load]);
	if (!view) return <Loading />;

	const done = (message: string) => {
		setNote(message);
		setAdding(false);
		load();
	};

	return (
		<Page
			title="Agents"
			actions={
				!adding && (
					<Button variant="secondary" onClick={() => setAdding(true)}>
						Add an agent
					</Button>
				)
			}
		>
			<Muted block>
				Each agent works from its instructions, framed by the charter. A change
				applies from its next run.
			</Muted>
			{note && <Notice>{note}</Notice>}
			{adding && (
				<Card title="A new agent">
					<AgentForm
						view={view}
						submitLabel="Add the agent"
						onCancel={() => setAdding(false)}
						onSave={async (input) =>
							done(
								(
									await api<ActionResult>("/agents", {
										method: "POST",
										body: input,
									})
								).message,
							)
						}
					/>
				</Card>
			)}

			<Grid>
				{view.agents.map((a) => (
					<AgentCard key={a.key} agent={a} view={view} onDone={done} />
				))}
			</Grid>

			{view.retired.length > 0 && (
				<Card muted title="Retired">
					{view.retired.map((r) => (
						<p key={r.key}>
							{r.name} <Muted small>· retired {when(r.retiredAt)}</Muted>
						</p>
					))}
				</Card>
			)}
		</Page>
	);
}

function AgentCard({
	agent: a,
	view,
	onDone,
}: {
	agent: AgentRow;
	view: AgentsView;
	onDone: (message: string) => void;
}) {
	const [mode, setModeState] = useState<"read" | "edit" | "tools" | "retire">(
		"read",
	);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// A new mode starts clean: an old error doesn't follow the owner around.
	const setMode = (next: typeof mode) => {
		setError(null);
		setModeState(next);
	};
	const act = async (call: () => Promise<ActionResult>) => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const { message } = await call();
			setModeState("read");
			onDone(message);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};
	const toolName = (key: string) =>
		view.tools.find((t) => t.key === key)?.name ?? key;

	return (
		<Card as="article" title={a.name}>
			{a.role && <Muted block>{a.role}</Muted>}
			<Actions>
				{a.answers.map((c) => (
					<Badge key={c} tone="ok">
						Answers {c}
					</Badge>
				))}
				{a.connections > 0 && (
					<Badge>
						{a.connections} outside AI{a.connections === 1 ? "" : "s"} connected
						as it
					</Badge>
				)}
			</Actions>

			{error && <ErrorText>{error}</ErrorText>}

			{mode === "edit" ? (
				<AgentForm
					view={view}
					agent={a}
					submitLabel="Save"
					onCancel={() => setMode("read")}
					onSave={(input) =>
						act(() =>
							api<ActionResult>(`/agents/${a.key}`, {
								method: "PUT",
								body: input,
							}),
						)
					}
				/>
			) : mode === "tools" ? (
				<ToolsForm
					agent={a}
					view={view}
					busy={busy}
					onCancel={() => setMode("read")}
					onSave={(tools) =>
						act(() =>
							api<ActionResult>(`/agents/${a.key}/tools`, {
								method: "PUT",
								body: { tools },
							}),
						)
					}
				/>
			) : (
				<>
					<Label>Works in</Label>
					<p>
						{a.teams.length ? (
							a.teams.map((t) => t.name).join(", ")
						) : (
							<Muted>No team</Muted>
						)}
					</p>
					<Label>Owns</Label>
					<p>
						{a.owns.length ? a.owns.join(", ") : <Muted>Nothing yet</Muted>}
					</p>
					<Label>Uses</Label>
					<p>
						{a.tools.length + a.teamTools.length === 0 ? (
							<Muted>No tools</Muted>
						) : (
							<>
								{a.tools.map(toolName).join(", ")}
								{a.teamTools.length > 0 && (
									<Muted>
										{a.tools.length ? " · " : ""}through its team:{" "}
										{a.teamTools.map(toolName).join(", ")}
									</Muted>
								)}
							</>
						)}
					</p>
					<Label>Last 30 days</Label>
					<p>
						{a.runs30d.runs} run{a.runs30d.runs === 1 ? "" : "s"} ·{" "}
						{usd(a.runs30d.costMicroUsd)}{" "}
						<Muted small>
							{a.lastRunAt ? `· last ${when(a.lastRunAt)}` : "· never run"}
						</Muted>
					</p>
					<Label>Instructions</Label>
					<Muted block>{a.instructions || "None yet."}</Muted>

					{mode === "retire" ? (
						<>
							<p>
								<strong>Retire {a.name}?</strong> It stops answering and owning
								anything; its history stays.
							</p>
							{/* "Keep it" first: a double-click on Retire lands on it. */}
							<Actions>
								<Button variant="secondary" onClick={() => setMode("read")}>
									Keep it
								</Button>
								<Button
									disabled={busy}
									onClick={() =>
										act(() =>
											api<ActionResult>(`/agents/${a.key}/retire`, {
												method: "POST",
												body: {},
											}),
										)
									}
								>
									{busy ? "Retiring…" : `Retire ${a.name}`}
								</Button>
							</Actions>
						</>
					) : (
						<Actions>
							<Button size="small" onClick={() => setMode("edit")}>
								Edit
							</Button>
							<Button
								size="small"
								variant="secondary"
								onClick={() => setMode("tools")}
							>
								Tools
							</Button>
							<Button
								size="small"
								variant="secondary"
								onClick={() => setMode("retire")}
							>
								Retire
							</Button>
						</Actions>
					)}
				</>
			)}
		</Card>
	);
}

function AgentForm({
	view,
	agent,
	submitLabel,
	onSave,
	onCancel,
}: {
	view: AgentsView;
	agent?: AgentRow;
	submitLabel: string;
	onSave: (input: AgentInput) => Promise<void>;
	onCancel: () => void;
}) {
	const [name, setName] = useState(agent?.name ?? "");
	const [role, setRole] = useState(agent?.role ?? "");
	const [instructions, setInstructions] = useState(agent?.instructions ?? "");
	const [teamKey, setTeamKey] = useState(agent?.teams[0]?.key ?? "");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const { limits } = view;

	return (
		<Form
			onSubmit={async () => {
				setBusy(true);
				setError(null);
				try {
					await onSave({
						name,
						role,
						instructions,
						teamKey: teamKey || null,
					});
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setBusy(false);
				}
			}}
		>
			<Field label="Name">
				<Input
					autoFocus
					value={name}
					maxLength={limits.name}
					onChange={(e) => setName(e.target.value)}
				/>
			</Field>
			<Field label="Role" hint="(what it does, in a line)">
				<Input
					value={role}
					maxLength={limits.role}
					onChange={(e) => setRole(e.target.value)}
				/>
			</Field>
			<Field label="Works in">
				<Select value={teamKey} onChange={(e) => setTeamKey(e.target.value)}>
					<option value="">No team</option>
					{view.teams.map((t) => (
						<option key={t.key} value={t.key}>
							{t.name}
						</option>
					))}
				</Select>
			</Field>
			<Field
				label="Instructions"
				hint={`(${instructions.length} of ${limits.instructions} characters)`}
			>
				<TextArea
					value={instructions}
					maxLength={limits.instructions}
					placeholder="What it does, how, and what it never does without asking."
					onChange={(e) => setInstructions(e.target.value)}
				/>
			</Field>
			{error && <ErrorText>{error}</ErrorText>}
			<Actions>
				<Button type="submit" disabled={busy || !name.trim()}>
					{busy ? "Saving…" : submitLabel}
				</Button>
				<Button variant="secondary" onClick={onCancel}>
					Cancel
				</Button>
			</Actions>
		</Form>
	);
}

function ToolsForm({
	agent,
	view,
	busy,
	onSave,
	onCancel,
}: {
	agent: AgentRow;
	view: AgentsView;
	busy: boolean;
	onSave: (tools: string[]) => Promise<void>;
	onCancel: () => void;
}) {
	const [chosen, setChosen] = useState(new Set(agent.tools));
	return (
		<Form onSubmit={() => onSave([...chosen])}>
			{view.tools.length === 0 && (
				<Muted block>The company has no tools in its map yet.</Muted>
			)}
			{view.tools.map((t) => {
				const viaTeam = agent.teamTools.includes(t.key);
				return (
					<Checkbox
						key={t.key}
						label={viaTeam ? `${t.name} (through its team)` : t.name}
						hint={t.approval}
						checked={viaTeam || chosen.has(t.key)}
						disabled={viaTeam}
						onChange={(on) => {
							const next = new Set(chosen);
							if (on) next.add(t.key);
							else next.delete(t.key);
							setChosen(next);
						}}
					/>
				);
			})}
			<Actions>
				<Button type="submit" disabled={busy}>
					{busy ? "Saving…" : "Save tools"}
				</Button>
				<Button variant="secondary" onClick={onCancel}>
					Cancel
				</Button>
			</Actions>
		</Form>
	);
}
