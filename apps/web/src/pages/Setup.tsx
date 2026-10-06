import type {
	ActionResult,
	Me,
	SetupDraft,
	SetupQuestion,
	SetupState,
} from "@jamot/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import {
	Actions,
	Badge,
	Bullet,
	Bullets,
	Button,
	Card,
	Cell,
	Center,
	ErrorText,
	Field,
	Form,
	Input,
	Label,
	Loading,
	Muted,
	Notice,
	Row,
	Select,
	Table,
	TextArea,
} from "../ui/index.js";

/**
 * The setup interview (RUNTIME D55): the only screen a runtime with no
 * company shows. One question at a time, then a review and "Start my
 * company". The same answers as on Telegram — the founder can switch.
 */
export function Setup({ onStarted }: { onStarted: () => void }) {
	const [state, setState] = useState<SetupState | null>(null);
	// Which screen: a question's index, or the review after the last one.
	const [at, setAt] = useState<number | "review" | null>(null);
	const [starting, setStarting] = useState<string | null>(null);

	const load = useCallback(
		() =>
			api<SetupState>("/setup").then((s) => {
				setState(s);
				return s;
			}),
		[],
	);
	useEffect(() => {
		load().then((s) => {
			const next = s.questions.findIndex(
				(q) => !s.answers[q.id] && !s.skipped.includes(q.id),
			);
			setAt(next === -1 ? "review" : next);
		});
	}, [load]);

	// Once started, wait for the company to come up, then show it.
	useEffect(() => {
		if (!starting) return;
		const timer = setInterval(async () => {
			try {
				const me = await api<Me>("/me");
				if (!me.setup) onStarted();
			} catch {
				// restarting: try again
			}
		}, 1500);
		return () => clearInterval(timer);
	}, [starting, onStarted]);

	if (starting)
		return (
			<Center>
				<Card title={starting}>
					<Muted block>
						Your agents are getting ready. This takes a moment.
					</Muted>
				</Card>
			</Center>
		);
	if (!state || at === null) return <Loading />;

	if (at === "review")
		return (
			<Review
				state={state}
				onChange={(i) => setAt(i)}
				onStarted={setStarting}
			/>
		);
	const q = state.questions[at] as SetupQuestion;
	return (
		<Question
			key={q.id}
			state={state}
			index={at}
			onBack={at > 0 ? () => setAt(at - 1) : undefined}
			onDone={(next) => {
				setState(next);
				setAt(at + 1 < next.questions.length ? at + 1 : "review");
			}}
		/>
	);
}

function Question({
	state,
	index,
	onBack,
	onDone,
}: {
	state: SetupState;
	index: number;
	onBack?: () => void;
	onDone: (next: SetupState) => void;
}) {
	const q = state.questions[index] as SetupQuestion;
	const [value, setValue] = useState(state.answers[q.id] ?? "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const send = async (answer: string) => {
		setBusy(true);
		setError(null);
		try {
			onDone(
				await api<SetupState>("/setup/answer", {
					method: "PUT",
					body: { id: q.id, value: answer },
				}),
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};
	const t = state.telegram;

	return (
		<Center>
			<Form card onSubmit={() => send(value)}>
				<Muted small>
					Setting up your company · question {index + 1} of{" "}
					{state.questions.length}
				</Muted>
				<h1>{q.title}</h1>
				<Muted block>{q.hint}</Muted>
				<Field label={q.kind === "lines" ? "One per line" : "Your answer"}>
					{q.kind === "short" ? (
						<Input
							autoFocus
							value={value}
							maxLength={200}
							placeholder={q.placeholder}
							onChange={(e) => setValue(e.target.value)}
						/>
					) : (
						<TextArea
							autoFocus
							rows={q.kind === "lines" ? 4 : 3}
							value={value}
							maxLength={2000}
							placeholder={q.placeholder}
							onChange={(e) => setValue(e.target.value)}
						/>
					)}
				</Field>
				{error && <ErrorText>{error}</ErrorText>}
				<Actions>
					<Button
						type="submit"
						disabled={busy || (q.required && !value.trim())}
					>
						{busy ? "Saving…" : "Next"}
					</Button>
					{!q.required && (
						<Button
							variant="secondary"
							disabled={busy}
							onClick={() => send("")}
						>
							I don't know yet
						</Button>
					)}
					{onBack && (
						<Button variant="link" onClick={onBack}>
							Back
						</Button>
					)}
				</Actions>
				{index === 0 && t.bot && t.code && (
					<Notice>
						Rather answer on your phone?{" "}
						<a
							href={`https://t.me/${t.bot}?start=${t.code}`}
							target="_blank"
							rel="noreferrer"
						>
							Continue on Telegram
						</a>{" "}
						— it's the same setup.
					</Notice>
				)}
				{t.owner && (
					<Muted small block>
						Also open on Telegram as {t.owner}: answers made there show here.
					</Muted>
				)}
			</Form>
			<SoFar state={state} />
		</Center>
	);
}

/** The company taking shape as the founder answers (D56). */
function SoFar({ state }: { state: SetupState }) {
	const a = state.answers;
	const list = (v: string | undefined) =>
		(v ?? "")
			.split("\n")
			.map((l) => l.replace(/^[-•*\s]+/, "").trim())
			.filter(Boolean);
	if (!a.name && !a.what) return null;
	return (
		<Card muted title={a.name ? `${a.name}, so far` : "Your company, so far"}>
			{a.why && (
				<>
					<Label>Why it exists</Label>
					<p>{a.why}</p>
				</>
			)}
			{a.what && (
				<>
					<Label>Its mission</Label>
					<p>{a.what}</p>
				</>
			)}
			{list(a.never).length > 0 && (
				<>
					<Label>What it holds to</Label>
					<Bullets>
						{list(a.never).map((v) => (
							<Bullet key={v}>{v}</Bullet>
						))}
					</Bullets>
				</>
			)}
			{list(a.goals).length > 0 && (
				<>
					<Label>Three months from now</Label>
					<Bullets>
						{list(a.goals).map((g) => (
							<Bullet key={g}>{g}</Bullet>
						))}
					</Bullets>
				</>
			)}
			{a.founder && (
				<Muted small block>
					Founded by {a.founder}
				</Muted>
			)}
		</Card>
	);
}

function Review({
	state: initial,
	onChange,
	onStarted,
}: {
	state: SetupState;
	onChange: (index: number) => void;
	onStarted: (message: string) => void;
}) {
	const [state, setState] = useState(initial);
	const [template, setTemplate] = useState("");
	const [busy, setBusy] = useState(false);
	const [drafting, setDrafting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Without a model, or when drafting failed: the founder picks a template.
	const [pick, setPick] = useState(!initial.canDraft);
	const chosen = state.templates.find((t) => t.id === template);

	// Drafting takes a while: the founder may leave the review meanwhile.
	const mounted = useRef(true);
	useEffect(
		() => () => {
			mounted.current = false;
		},
		[],
	);
	const draft = useCallback(async (again: boolean) => {
		setDrafting(true);
		setError(null);
		try {
			const next = await api<SetupState>("/setup/draft", {
				method: "POST",
				body: { again },
			});
			if (mounted.current) setState(next);
		} catch (err) {
			if (!mounted.current) return;
			setError(err instanceof Error ? err.message : String(err));
			setPick(true);
		} finally {
			if (mounted.current) setDrafting(false);
		}
	}, []);
	useEffect(() => {
		if (initial.canDraft && initial.ready && !initial.draft) draft(false);
	}, [initial, draft]);

	const start = async () => {
		setBusy(true);
		setError(null);
		try {
			const { message } = await api<ActionResult>("/setup/finish", {
				method: "POST",
				body: pick ? { template } : {},
			});
			onStarted(message);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setBusy(false);
		}
	};
	const d = state.draft;

	return (
		<Center>
			<Form card="wide" onSubmit={start}>
				<Muted small>Setting up your company · review</Muted>
				<h1>Here's your company</h1>
				{drafting && (
					<Notice>
						Drafting your company from your answers… about half a minute.
					</Notice>
				)}
				{d && !pick && <DraftView draft={d} />}
				{pick && (
					<>
						<Field
							label="Closest starting point"
							hint="(Jamot starts from it and fits it to your answers; you can change everything later)"
						>
							<Select
								value={template}
								onChange={(e) => setTemplate(e.target.value)}
							>
								<option value="">Choose one</option>
								{state.templates.map((t) => (
									<option key={t.id} value={t.id}>
										{t.name}
									</option>
								))}
							</Select>
						</Field>
						{chosen && <Muted block>{chosen.summary}</Muted>}
					</>
				)}
				{!state.ready && (
					<ErrorText>Answer the first three questions to start.</ErrorText>
				)}
				{error && <ErrorText>{error}</ErrorText>}
				<Actions>
					<Button
						type="submit"
						disabled={
							busy || drafting || !state.ready || (pick ? !template : !d)
						}
					>
						{busy ? "Starting…" : "Start my company"}
					</Button>
					{state.canDraft && (
						<Button
							variant="secondary"
							disabled={busy || drafting}
							onClick={() => {
								setPick(false);
								draft(true);
							}}
						>
							{d || pick ? "Draft again" : "Draft it"}
						</Button>
					)}
				</Actions>
				<Label>Your answers</Label>
				<Table
					columns={[
						{ label: "Question" },
						{ label: "Your answer" },
						{ label: "" },
					]}
				>
					{state.questions.map((q, i) => (
						<Row key={q.id}>
							<Cell small>{q.title}</Cell>
							<Cell>{state.answers[q.id] ?? <Muted>Later</Muted>}</Cell>
							<Cell>
								<Button size="small" variant="link" onClick={() => onChange(i)}>
									Change
								</Button>
							</Cell>
						</Row>
					))}
				</Table>
			</Form>
		</Center>
	);
}

/** The drafted company, as the founder reviews it. */
function DraftView({ draft: d }: { draft: SetupDraft }) {
	const owner = (r: SetupDraft["responsibilities"][number]) =>
		r.owner.kind === "open" ? (
			<Badge tone="bad">Open — you'll invite someone</Badge>
		) : r.owner.kind === "founder" ? (
			"You"
		) : r.owner.kind === "agent" ? (
			<>
				{r.owner.name} <Badge>agent</Badge>
			</>
		) : (
			r.owner.name
		);
	return (
		<>
			{d.charter.vision && (
				<>
					<Label>Why it exists</Label>
					<p>{d.charter.vision}</p>
				</>
			)}
			<Label>Its mission</Label>
			<p>{d.charter.mission}</p>
			{d.charter.values.length > 0 && (
				<>
					<Label>What it holds to</Label>
					<Bullets>
						{d.charter.values.map((v) => (
							<Bullet key={v}>{v}</Bullet>
						))}
					</Bullets>
				</>
			)}
			{d.charter.goals.length > 0 && (
				<>
					<Label>Three months from now</Label>
					<Bullets>
						{d.charter.goals.map((g) => (
							<Bullet key={g}>{g}</Bullet>
						))}
					</Bullets>
				</>
			)}
			<Label>Who does what</Label>
			<Table
				columns={[
					{ label: "Responsibility" },
					{ label: "Team" },
					{ label: "Owner" },
				]}
			>
				{d.responsibilities.map((r) => (
					<Row key={r.name}>
						<Cell>{r.name}</Cell>
						<Cell small>{r.team}</Cell>
						<Cell>{owner(r)}</Cell>
					</Row>
				))}
			</Table>
			{d.agents.length > 0 && (
				<>
					<Label>Agents</Label>
					<Bullets>
						{d.agents.map((a) => (
							<Bullet key={a.name}>
								<strong>{a.name}</strong> — {a.role}
							</Bullet>
						))}
					</Bullets>
				</>
			)}
			{d.people.length > 0 && (
				<>
					<Label>People</Label>
					<Bullets>
						{d.people.map((p) => (
							<Bullet key={p.name}>
								<strong>{p.name}</strong> — {p.role}
							</Bullet>
						))}
					</Bullets>
				</>
			)}
			{d.successor && (
				<Muted block>Takes over if you go quiet: {d.successor}</Muted>
			)}
		</>
	);
}
