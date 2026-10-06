import type {
	ActionResult,
	ContributionRow,
	ContributionsView,
} from "@jamot/contracts";
import { useCallback, useEffect, useState } from "react";
import { api, when } from "../api.js";
import {
	Actions,
	Badge,
	Button,
	Card,
	Cell,
	ErrorText,
	Field,
	Form,
	Input,
	Loading,
	Muted,
	Notice,
	Page,
	Row,
	Select,
	Table,
	Tile,
	Tiles,
} from "../ui/index.js";

/**
 * The contribution record (RUNTIME D54): what everyone did, the claims that
 * wait for the founder, the rewards the founder recorded, and the numbers
 * the experiment in VISION.md watches.
 */
export function Contributions() {
	const [view, setView] = useState<ContributionsView | null>(null);
	const [note, setNote] = useState<string | null>(null);
	const load = useCallback(
		() => api<ContributionsView>("/contributions").then(setView),
		[],
	);
	useEffect(() => {
		load();
	}, [load]);
	if (!view) return <Loading />;
	const done = (message: string) => {
		setNote(message);
		load();
	};
	const claims = view.contributions.filter((c) => c.status === "claimed");
	const record = view.contributions.filter((c) => c.status !== "claimed");

	return (
		<Page title="Contributions">
			<Muted block>
				What each person did for the company, on the record. People add to it
				with <code>/did</code> on Telegram and see their own with{" "}
				<code>/ledger</code>; you confirm, and you decide the rewards.
			</Muted>
			{note && <Notice>{note}</Notice>}
			<Experiment view={view} />
			{claims.length > 0 && <Claims claims={claims} onDone={done} />}
			<Card title="The record">
				{record.length === 0 ? (
					<Muted>Nothing yet.</Muted>
				) : (
					<Table
						columns={[{ label: "When" }, { label: "Who" }, { label: "What" }]}
					>
						{record.map((c) => (
							<Row key={c.id}>
								<Cell small>{when(c.at)}</Cell>
								<Cell>{c.who.name}</Cell>
								<Cell>
									{c.what}{" "}
									{c.status === "declined" && <Badge>Not confirmed</Badge>}
								</Cell>
							</Row>
						))}
					</Table>
				)}
				<RecordForm view={view} onDone={done} />
			</Card>
			<Card title="Rewards">
				<Muted block>
					A reward here is a note of what you gave or promised — never a
					payment. Jamot doesn't move money.
				</Muted>
				{view.rewards.length > 0 && (
					<Table
						columns={[{ label: "When" }, { label: "Who" }, { label: "Reward" }]}
					>
						{view.rewards.map((r) => (
							<Row key={r.id}>
								<Cell small>{when(r.at)}</Cell>
								<Cell>{r.who.name}</Cell>
								<Cell>{r.note}</Cell>
							</Row>
						))}
					</Table>
				)}
				<RewardForm view={view} onDone={done} />
			</Card>
		</Page>
	);
}

/** The experiment's numbers (VISION.md), as plain counts. */
function Experiment({ view }: { view: ContributionsView }) {
	const e = view.experiment;
	return (
		<Tiles>
			<Tile
				label="Joined"
				value={e.joined}
				hint={`of ${e.invited} invitation${e.invited === 1 ? "" : "s"}`}
			/>
			<Tile
				label="First work in 2 weeks"
				value={e.joined ? `${e.firstWorkIn2Weeks} of ${e.joined}` : "—"}
				hint="confirmed within two weeks of joining"
			/>
			<Tile
				label="Active after 6 weeks"
				value={
					e.joinedSixWeeksAgo
						? `${e.activeAfterSixWeeks} of ${e.joinedSixWeeksAgo}`
						: "—"
				}
				hint={
					e.joinedSixWeeksAgo
						? "heard from in the last 2 weeks"
						: "too early to tell"
				}
			/>
			<Tile
				label="Work, last 30 days"
				value={`${e.agentRuns30d} · ${e.peopleContributions30d}`}
				hint="agent runs · people's contributions"
			/>
			<Tile
				label="Roles picked up again"
				value={e.handedOver ? `${e.pickedUpAgain} of ${e.handedOver}` : "—"}
				hint="after someone handed them over"
			/>
		</Tiles>
	);
}

/** What people said they did, waiting for the founder. */
function Claims({
	claims,
	onDone,
}: {
	claims: ContributionRow[];
	onDone: (message: string) => void;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const decide = async (id: string, yes: boolean) => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			onDone(
				(
					await api<ActionResult>(
						`/contributions/${id}/${yes ? "confirm" : "decline"}`,
						{ method: "POST", body: {} },
					)
				).message,
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};
	return (
		<Card tone="warn" title="Waiting for you">
			{error && <ErrorText>{error}</ErrorText>}
			{claims.map((c) => (
				<Actions key={c.id}>
					<span>
						<strong>{c.who.name}</strong> says they did: {c.what}{" "}
						<Muted small>· {when(c.at)}</Muted>
					</span>
					<Button
						size="small"
						disabled={busy}
						onClick={() => decide(c.id, true)}
					>
						Confirm
					</Button>
					<Button
						size="small"
						variant="secondary"
						disabled={busy}
						onClick={() => decide(c.id, false)}
					>
						Not this
					</Button>
				</Actions>
			))}
		</Card>
	);
}

function PersonSelect({
	view,
	value,
	onChange,
}: {
	view: ContributionsView;
	value: string;
	onChange: (key: string) => void;
}) {
	return (
		<Select value={value} onChange={(e) => onChange(e.target.value)}>
			<option value="">Choose someone</option>
			{view.people.map((p) => (
				<option key={p.key} value={p.key}>
					{p.name}
				</option>
			))}
		</Select>
	);
}

/** The founder records something someone did, confirmed at once. */
function RecordForm({
	view,
	onDone,
}: {
	view: ContributionsView;
	onDone: (message: string) => void;
}) {
	const [nodeKey, setNodeKey] = useState("");
	const [what, setWhat] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	return (
		<Form
			layout="row"
			onSubmit={async () => {
				setBusy(true);
				setError(null);
				try {
					const { message } = await api<ActionResult>("/contributions", {
						method: "POST",
						body: { nodeKey, what },
					});
					setWhat("");
					onDone(message);
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setBusy(false);
				}
			}}
		>
			<Field label="Who">
				<PersonSelect view={view} value={nodeKey} onChange={setNodeKey} />
			</Field>
			<Field label="What they did">
				<Input
					value={what}
					maxLength={280}
					onChange={(e) => setWhat(e.target.value)}
				/>
			</Field>
			<Button
				type="submit"
				variant="secondary"
				disabled={busy || !nodeKey || !what.trim()}
			>
				Record it
			</Button>
			{error && <ErrorText>{error}</ErrorText>}
		</Form>
	);
}

/** The founder records a reward: a note, never a payment. */
function RewardForm({
	view,
	onDone,
}: {
	view: ContributionsView;
	onDone: (message: string) => void;
}) {
	const [nodeKey, setNodeKey] = useState("");
	const [reward, setReward] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	return (
		<Form
			layout="row"
			onSubmit={async () => {
				setBusy(true);
				setError(null);
				try {
					const { message } = await api<ActionResult>("/rewards", {
						method: "POST",
						body: { nodeKey, note: reward },
					});
					setReward("");
					onDone(message);
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setBusy(false);
				}
			}}
		>
			<Field label="Who">
				<PersonSelect view={view} value={nodeKey} onChange={setNodeKey} />
			</Field>
			<Field label="Reward" hint="(what you gave or promised)">
				<Input
					value={reward}
					maxLength={280}
					placeholder="€50 for the opening menu"
					onChange={(e) => setReward(e.target.value)}
				/>
			</Field>
			<Button
				type="submit"
				variant="secondary"
				disabled={busy || !nodeKey || !reward.trim()}
			>
				Record reward
			</Button>
			{error && <ErrorText>{error}</ErrorText>}
		</Form>
	);
}
