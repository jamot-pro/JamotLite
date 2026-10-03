import { useCallback, useEffect, useState } from "react";
import type { PageProps } from "../App.js";
import { api, type Overview, usd, when } from "../api.js";

const TIER = {
	normal: "Healthy",
	low_funding: "Low on money",
	critical: "Critical",
} as const;

export function OverviewPage({ go }: PageProps) {
	const [data, setData] = useState<Overview | null>(null);
	const [note, setNote] = useState<string | null>(null);
	const load = useCallback(() => api<Overview>("/overview").then(setData), []);
	useEffect(() => {
		load();
	}, [load]);
	if (!data) return <p className="muted">Loading…</p>;
	const { company, charter, vitals } = data;
	const readiness = vitals.people.readiness;
	const money = vitals.money;
	// The headline is what matters most — who owns what — not the average of
	// every dimension, which hides three missing key roles behind "96%".
	const owned = readiness.dimensions.find((d) => d.key === "responsibilities");

	return (
		<>
			<header className="head">
				<div>
					<h1>{company.name}</h1>
					{charter?.mission && <p className="dream">{charter.mission}</p>}
				</div>
				{readiness.covered && (
					<span className="badge ok">JAMOT — fully covered</span>
				)}
			</header>

			<section className="tiles">
				<div className="tile">
					<span className="label">Responsibilities owned</span>
					<span className="value">
						{Math.round((owned?.score ?? 0) * 100)}%
					</span>
					<span className="muted small">
						{vitals.people.unowned.length === 0
							? "every one has an owner"
							: `${vitals.people.unowned.length} still without an owner`}
					</span>
				</div>
				<div className={`tile tier-${vitals.tier}`}>
					<span className="label">Survival</span>
					<span className="value">{TIER[vitals.tier]}</span>
					<span className="muted small">
						{money.currency && money.balance !== null
							? `${(money.balance / 100).toFixed(2)} ${money.currency}${money.runwayDays !== null ? ` · ${money.runwayDays} days of runway` : ""}`
							: "Money isn't tracked yet"}
					</span>
				</div>
				<div className="tile">
					<span className="label">Waiting for an answer</span>
					<span className="value">{vitals.work.waiting.length}</span>
					<span className="muted small">
						{vitals.work.failedReplies24h} failed replies today
					</span>
				</div>
				<button
					type="button"
					className="tile clickable"
					onClick={() => go("/approvals")}
				>
					<span className="label">Approvals</span>
					<span className="value">{data.pendingApprovals}</span>
					<span className="muted small">waiting for you</span>
				</button>
				<div className="tile">
					<span className="label">Agents, last 30 days</span>
					<span className="value">{usd(money.llmCostMicroUsd30d)}</span>
					<span className="muted small">model spend</span>
				</div>
			</section>

			{note && <p className="notice">{note}</p>}

			<section className="card">
				<h2>Needs you</h2>
				{vitals.people.unowned.length === 0 &&
				data.issues.length === 0 &&
				vitals.work.waiting.length === 0 ? (
					<p className="muted">
						Nothing right now. Every responsibility has an owner and nobody is
						waiting.
					</p>
				) : (
					<ul className="list">
						{vitals.people.unowned.map((r) => (
							<li key={r.key}>
								<span>
									Nobody owns <strong>{r.name}</strong>
								</span>
								{company.founderKey && (
									<button
										type="button"
										className="small"
										onClick={async () => {
											const res = await api<{ message: string }>(
												`/responsibilities/${r.key}/owner`,
												{
													method: "POST",
													body: { ownerKey: company.founderKey },
												},
											);
											setNote(res.message);
											load();
										}}
									>
										I'll take it
									</button>
								)}
							</li>
						))}
						{vitals.work.waiting.map((w) => (
							<li key={w.conversationId}>
								<span>
									<strong>{w.personName}</strong> has been waiting since{" "}
									{when(w.since)}
								</span>
							</li>
						))}
						{data.issues
							.filter(
								(i) =>
									!i.key.startsWith("unowned:") &&
									!i.key.startsWith("waiting:"),
							)
							.map((i) => (
								<li key={i.key}>
									<span>{i.title}</span>
									<span className="muted small">since {when(i.since)}</span>
								</li>
							))}
					</ul>
				)}
			</section>

			<section className="card">
				<h2>How ready the company is</h2>
				<ul className="list">
					{readiness.dimensions.map((d) => (
						<li key={d.key}>
							<span>
								{d.score === 1 ? "✅" : "⚠️"} {d.label}
								{d.missing.length > 0 && (
									<span className="muted small">
										{" "}
										— {d.missing.map((m) => m.name).join(" · ")}
									</span>
								)}
							</span>
							<span className="muted small">{Math.round(d.score * 100)}%</span>
						</li>
					))}
				</ul>
			</section>

			{charter && (
				<section className="card">
					<h2>The charter</h2>
					{charter.vision && (
						<>
							<h3>Vision</h3>
							<p>{charter.vision}</p>
						</>
					)}
					{charter.mission && (
						<>
							<h3>Mission</h3>
							<p>{charter.mission}</p>
						</>
					)}
					{charter.values.length > 0 && (
						<>
							<h3>Values — rules the company never breaks</h3>
							<ul className="plain">
								{charter.values.map((v) => (
									<li key={v}>{v}</li>
								))}
							</ul>
						</>
					)}
					{charter.goals.length > 0 && (
						<>
							<h3>Goals</h3>
							<ul className="plain">
								{charter.goals.map((g) => (
									<li key={g}>{g}</li>
								))}
							</ul>
						</>
					)}
				</section>
			)}
		</>
	);
}
