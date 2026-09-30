import { useEffect, useState } from "react";
import { api, type Run, usd, when } from "../api.js";

interface Totals {
	runs: number;
	inputTokens: number;
	outputTokens: number;
	costMicroUsd: number;
}

/** Every agent run, with what it cost. */
export function Runs() {
	const [data, setData] = useState<{ last30Days: Totals; runs: Run[] } | null>(
		null,
	);
	useEffect(() => {
		api<{ last30Days: Totals; runs: Run[] }>("/runs").then(setData);
	}, []);
	if (!data) return <p className="muted">Loading…</p>;
	const t = data.last30Days;
	return (
		<>
			<header className="head">
				<h1>Agent runs</h1>
			</header>
			<section className="tiles">
				<div className="tile">
					<span className="label">Runs, 30 days</span>
					<span className="value">{t.runs}</span>
				</div>
				<div className="tile">
					<span className="label">Tokens</span>
					<span className="value">
						{(t.inputTokens + t.outputTokens).toLocaleString()}
					</span>
				</div>
				<div className="tile">
					<span className="label">Cost</span>
					<span className="value">{usd(t.costMicroUsd)}</span>
				</div>
			</section>
			<section className="card">
				{data.runs.length === 0 ? (
					<p className="muted">No runs yet.</p>
				) : (
					<table>
						<thead>
							<tr>
								<th>When</th>
								<th>Agent</th>
								<th>Status</th>
								<th>What happened</th>
								<th className="num">Tokens</th>
								<th className="num">Cost</th>
							</tr>
						</thead>
						<tbody>
							{data.runs.map((r) => (
								<tr key={r.id}>
									<td className="small">{when(r.startedAt)}</td>
									<td>{r.agentKey}</td>
									<td>
										<span
											className={`badge ${r.status === "done" ? "ok" : r.status === "awaiting_approval" ? "" : "bad"}`}
										>
											{r.status.replace("_", " ")}
										</span>
									</td>
									<td className="small">{r.error ?? r.output ?? "—"}</td>
									<td className="num">
										{(r.inputTokens + r.outputTokens).toLocaleString()}
									</td>
									<td className="num">{usd(r.costMicroUsd)}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</section>
		</>
	);
}
