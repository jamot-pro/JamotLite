import type {
	ActionResult,
	InviteRow,
	PairingCode,
	RoleInviteCode,
	StewardInput,
	StewardRow,
	StewardsView,
} from "@jamot/contracts";
import { useCallback, useEffect, useState } from "react";
import { api, when } from "../api.js";
import {
	Actions,
	Badge,
	Button,
	Card,
	Cell,
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
	Row,
	Select,
	Table,
} from "../ui/index.js";

/**
 * The people who run the company (RUNTIME D48): who they are, how to reach
 * them, their team and what they own — and a pairing code so the bot knows
 * them and their team's heartbeats reach them.
 */
export function Stewards() {
	const [view, setView] = useState<StewardsView | null>(null);
	const [note, setNote] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const load = useCallback(
		() => api<StewardsView>("/stewards").then(setView),
		[],
	);
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
			title="Stewards"
			actions={
				!adding && (
					<Button variant="secondary" onClick={() => setAdding(true)}>
						Add a person
					</Button>
				)
			}
		>
			<Muted block>
				The people who run the company. Each one owns responsibilities; once
				their Telegram is linked, their team's heartbeats reach them.
			</Muted>
			{note && <Notice>{note}</Notice>}
			{adding && (
				<Card title="A new person">
					<StewardForm
						view={view}
						submitLabel="Add them"
						onCancel={() => setAdding(false)}
						onSave={async (input) =>
							done(
								(
									await api<ActionResult>("/stewards", {
										method: "POST",
										body: input,
									})
								).message,
							)
						}
					/>
				</Card>
			)}

			<Waiting invites={view.invites} onDone={done} />

			<Grid>
				{view.stewards.map((s) => (
					<StewardCard key={s.key} steward={s} view={view} onDone={done} />
				))}
			</Grid>

			<OpenRoles view={view} onDone={done} />

			{view.retired.length > 0 && (
				<Card muted title="No longer in the company">
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

function StewardCard({
	steward: s,
	view,
	onDone,
}: {
	steward: StewardRow;
	view: StewardsView;
	onDone: (message: string) => void;
}) {
	const [mode, setModeState] = useState<"read" | "edit" | "owns" | "retire">(
		"read",
	);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [code, setCode] = useState<string | null>(null);
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

	return (
		<Card as="article" title={s.name}>
			{s.role && <Muted block>{s.role}</Muted>}
			<Actions>
				{s.founder && <Badge>Founder</Badge>}
				{s.paired ? (
					<Badge tone="ok">Telegram linked</Badge>
				) : (
					<Badge>Telegram not linked</Badge>
				)}
				{s.away?.state === "paused" && (
					<Badge>Paused until {when(s.away.at)}</Badge>
				)}
				{s.away?.state === "asked" && (
					<Badge tone="bad">
						Checked in on {when(s.away.at)}, no answer yet
					</Badge>
				)}
				{s.connections > 0 && (
					<Badge>
						{s.connections} AI{s.connections === 1 ? "" : "s"} connected as them
					</Badge>
				)}
			</Actions>
			{error && <ErrorText>{error}</ErrorText>}

			{mode === "edit" ? (
				<StewardForm
					view={view}
					steward={s}
					submitLabel="Save"
					onCancel={() => setMode("read")}
					onSave={(input) =>
						act(() =>
							api<ActionResult>(`/stewards/${s.key}`, {
								method: "PUT",
								body: input,
							}),
						)
					}
				/>
			) : mode === "owns" ? (
				<OwnsForm
					steward={s}
					view={view}
					busy={busy}
					onCancel={() => setMode("read")}
					onSave={(responsibilities) =>
						act(() =>
							api<ActionResult>(`/stewards/${s.key}/responsibilities`, {
								method: "PUT",
								body: { responsibilities },
							}),
						)
					}
				/>
			) : (
				<>
					<Label>Reach them</Label>
					<p>
						{s.telegram || s.github ? (
							[
								s.telegram && `Telegram @${s.telegram}`,
								s.github && `GitHub ${s.github}`,
							]
								.filter(Boolean)
								.join(" · ")
						) : (
							<Muted>No handles yet</Muted>
						)}
					</p>
					{s.paired && (
						<Muted block small>
							{s.lastSeen
								? `Last heard from ${when(s.lastSeen)}`
								: "Not heard from on Telegram yet"}
						</Muted>
					)}
					<Label>Works in</Label>
					<p>
						{s.teams.length ? (
							s.teams.map((t) => t.name).join(", ")
						) : (
							<Muted>No team</Muted>
						)}
					</p>
					<Label>Owns</Label>
					<p>
						{s.owns.length ? (
							s.owns.map((r) => r.name).join(", ")
						) : (
							<Muted>Nothing yet</Muted>
						)}
					</p>
					{code && (
						<Notice>
							From {s.telegram ? `@${s.telegram}` : `${s.name}'s`} Telegram,
							send the company's bot: <code>/start {code}</code> — it works
							once, for 24 hours.
						</Notice>
					)}

					{mode === "retire" ? (
						<>
							<p>
								<strong>Retire {s.name}?</strong> What they own is left without
								an owner, and their Telegram stops hearing from the company.
								Their history stays.
							</p>
							{/* "Keep them" first: a double-click on Retire lands on it. */}
							<Actions>
								<Button variant="secondary" onClick={() => setMode("read")}>
									Keep them
								</Button>
								<Button
									disabled={busy}
									onClick={() =>
										act(() =>
											api<ActionResult>(`/stewards/${s.key}/retire`, {
												method: "POST",
												body: {},
											}),
										)
									}
								>
									{busy ? "Retiring…" : `Retire ${s.name}`}
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
								onClick={() => setMode("owns")}
							>
								Responsibilities
							</Button>
							<Button
								size="small"
								variant="secondary"
								disabled={busy}
								onClick={async () => {
									setError(null);
									try {
										setCode(
											(
												await api<PairingCode>(`/stewards/${s.key}/pairing`, {
													method: "POST",
													body: {},
												})
											).code,
										);
									} catch (err) {
										setError(err instanceof Error ? err.message : String(err));
									}
								}}
							>
								{s.paired ? "Link again" : "Pairing code"}
							</Button>
							{!s.founder && (
								<Button
									size="small"
									variant="secondary"
									onClick={() => setMode("retire")}
								>
									Retire
								</Button>
							)}
						</Actions>
					)}
				</>
			)}
		</Card>
	);
}

function StewardForm({
	view,
	steward,
	submitLabel,
	onSave,
	onCancel,
}: {
	view: StewardsView;
	steward?: StewardRow;
	submitLabel: string;
	onSave: (input: StewardInput) => Promise<void>;
	onCancel: () => void;
}) {
	const [name, setName] = useState(steward?.name ?? "");
	const [role, setRole] = useState(steward?.role ?? "");
	const [telegram, setTelegram] = useState(steward?.telegram ?? "");
	const [github, setGithub] = useState(steward?.github ?? "");
	const [teamKey, setTeamKey] = useState(steward?.teams[0]?.key ?? "");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	return (
		<Form
			onSubmit={async () => {
				setBusy(true);
				setError(null);
				try {
					await onSave({
						name,
						role,
						telegram,
						github,
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
					maxLength={80}
					onChange={(e) => setName(e.target.value)}
				/>
			</Field>
			<Field label="Role" hint="(what they do, in a line)">
				<Input
					value={role}
					maxLength={160}
					onChange={(e) => setRole(e.target.value)}
				/>
			</Field>
			<Field label="Telegram" hint="(their @handle)">
				<Input
					value={telegram}
					maxLength={65}
					placeholder="@handle"
					onChange={(e) => setTelegram(e.target.value)}
				/>
			</Field>
			<Field label="GitHub">
				<Input
					value={github}
					maxLength={64}
					onChange={(e) => setGithub(e.target.value)}
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

function OwnsForm({
	steward,
	view,
	busy,
	onSave,
	onCancel,
}: {
	steward: StewardRow;
	view: StewardsView;
	busy: boolean;
	onSave: (keys: string[]) => Promise<void>;
	onCancel: () => void;
}) {
	const [chosen, setChosen] = useState(new Set(steward.owns.map((r) => r.key)));
	return (
		<Form onSubmit={() => onSave([...chosen])}>
			{view.responsibilities.map((r) => {
				const other =
					r.owner && r.owner.key !== steward.key ? r.owner.name : null;
				return (
					<Checkbox
						key={r.key}
						label={r.name}
						hint={
							other
								? `Owned by ${other} — ticking it moves it to ${steward.name}.`
								: r.owner
									? undefined
									: "Nobody owns it yet."
						}
						checked={chosen.has(r.key)}
						onChange={(on) => {
							const next = new Set(chosen);
							if (on) next.add(r.key);
							else next.delete(r.key);
							setChosen(next);
						}}
					/>
				);
			})}
			<Actions>
				<Button type="submit" disabled={busy}>
					{busy ? "Saving…" : "Save responsibilities"}
				</Button>
				<Button variant="secondary" onClick={onCancel}>
					Cancel
				</Button>
			</Actions>
		</Form>
	);
}

/** People who used an invitation and wait for the owner's yes or no (D52). */
function Waiting({
	invites,
	onDone,
}: {
	invites: InviteRow[];
	onDone: (message: string) => void;
}) {
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const waiting = invites.filter((i) => i.status === "waiting");
	if (waiting.length === 0) return null;
	const answer = async (id: string, yes: boolean) => {
		if (busy) return;
		setBusy(id);
		setError(null);
		try {
			onDone(
				(
					await api<ActionResult>(
						`/invites/${id}/${yes ? "approve" : "decline"}`,
						{ method: "POST", body: {} },
					)
				).message,
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(null);
		}
	};
	return (
		<Card tone="warn" title="Waiting for your answer">
			{error && <ErrorText>{error}</ErrorText>}
			{waiting.map((i) => (
				<Actions key={i.id}>
					<span>
						<strong>{i.candidate}</strong> used your invitation and wants to
						take <strong>{i.responsibility.name}</strong>.
					</span>
					<Button
						size="small"
						disabled={busy !== null}
						onClick={() => answer(i.id, true)}
					>
						Yes, welcome them
					</Button>
					<Button
						size="small"
						variant="secondary"
						disabled={busy !== null}
						onClick={() => answer(i.id, false)}
					>
						No
					</Button>
				</Actions>
			))}
		</Card>
	);
}

/**
 * Responsibilities nobody owns, and an invitation for each (D52): a code the
 * owner gives someone they know, who sends it to the company's bot.
 */
function OpenRoles({
	view,
	onDone,
}: {
	view: StewardsView;
	onDone: (message: string) => void;
}) {
	const [made, setMade] = useState<(RoleInviteCode & { role: string }) | null>(
		null,
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const open = view.responsibilities.filter((r) => !r.owner);
	if (open.length === 0) return null;
	const inviteFor = (key: string) =>
		view.invites.find((i) => i.responsibility.key === key);

	const invite = async (key: string, role: string) => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const code = await api<RoleInviteCode>(`/roles/${key}/invite`, {
				method: "POST",
				body: {},
			});
			setMade({ ...code, role });
			onDone(`Invitation ready for ${role}.`);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Card title="Open roles">
			<Muted block>
				Nobody owns these yet. Invite someone you know: they send the code to
				the company's bot, see the charter and the role, and you say yes or no.
			</Muted>
			{made && (
				<Notice>
					Send this to the person you're inviting for {made.role}:{" "}
					{made.bot ? (
						<>
							open{" "}
							<a
								href={`https://t.me/${made.bot}?start=${made.code}`}
								target="_blank"
								rel="noreferrer"
							>
								t.me/{made.bot}?start={made.code}
							</a>
							, or send <code>/join {made.code}</code> to @{made.bot}
						</>
					) : (
						<>
							they send <code>/join {made.code}</code> to the company's bot
						</>
					)}
					. It works once, until {when(made.expiresAt)}.
				</Notice>
			)}
			{error && <ErrorText>{error}</ErrorText>}
			<Table
				columns={[{ label: "Role" }, { label: "Invitation" }, { label: "" }]}
			>
				{open.map((r) => {
					const i = inviteFor(r.key);
					return (
						<Row key={r.key}>
							<Cell>{r.name}</Cell>
							<Cell small>
								{i?.status === "waiting" ? (
									<Badge tone="ok">{i.candidate} is waiting for you</Badge>
								) : i ? (
									<Muted>Sent · works until {when(i.expiresAt)}</Muted>
								) : (
									<Muted>None yet</Muted>
								)}
							</Cell>
							<Cell>
								{i?.status !== "waiting" && (
									<Button
										size="small"
										variant="secondary"
										disabled={busy}
										onClick={() => invite(r.key, r.name)}
									>
										{i ? "New code" : "Invite someone"}
									</Button>
								)}
							</Cell>
						</Row>
					);
				})}
			</Table>
		</Card>
	);
}
