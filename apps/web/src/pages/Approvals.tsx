import { useCallback, useEffect, useState } from "react";
import { type Approval, api, when } from "../api.js";

/** What agents are waiting for a person to decide. */
export function Approvals() {
	const [pending, setPending] = useState<Approval[] | null>(null);
	const [note, setNote] = useState<string | null>(null);
	const load = useCallback(
		() =>
			api<{ pending: Approval[] }>("/approvals").then((r) =>
				setPending(r.pending),
			),
		[],
	);
	useEffect(() => {
		load();
	}, [load]);

	const decide = async (a: Approval, approved: boolean) => {
		await api(`/approvals/${a.id}`, { method: "POST", body: { approved } });
		setNote(
			`${approved ? "Approved" : "Declined"}: ${a.tool}. The agent carries on.`,
		);
		load();
	};

	return (
		<>
			<header className="head">
				<h1>Approvals</h1>
			</header>
			{note && <p className="notice">{note}</p>}
			{!pending ? (
				<p className="muted">Loading…</p>
			) : pending.length === 0 ? (
				<section className="card muted">Nothing is waiting for you.</section>
			) : (
				pending.map((a) => (
					<section className="card" key={a.id}>
						<h2>
							{a.agentKey} wants to use {a.tool}
						</h2>
						<pre>{JSON.stringify(a.args, null, 2)}</pre>
						<p className="muted small">Waiting since {when(a.createdAt)}</p>
						<div className="row">
							<button type="button" onClick={() => decide(a, true)}>
								Approve
							</button>
							<button
								type="button"
								className="secondary"
								onClick={() => decide(a, false)}
							>
								Decline
							</button>
						</div>
					</section>
				))
			)}
		</>
	);
}
