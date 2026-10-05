import type { RunsView } from "@jamot/contracts";
import { useEffect, useState } from "react";
import { api, usd, when } from "../api.js";
import {
	Badge,
	Card,
	Cell,
	Loading,
	Muted,
	Page,
	Row,
	Table,
	Tile,
	Tiles,
} from "../ui/index.js";

/** Every agent run, with what it cost. */
export function Runs() {
	const [data, setData] = useState<RunsView | null>(null);
	useEffect(() => {
		api<RunsView>("/runs").then(setData);
	}, []);
	if (!data) return <Loading />;
	const t = data.last30Days;
	return (
		<Page title="Agent runs">
			<Tiles>
				<Tile label="Runs, 30 days" value={t.runs} />
				<Tile
					label="Tokens"
					value={(t.inputTokens + t.outputTokens).toLocaleString()}
				/>
				<Tile label="Cost" value={usd(t.costMicroUsd)} />
			</Tiles>
			<Card>
				{data.runs.length === 0 ? (
					<Muted block>No runs yet.</Muted>
				) : (
					<Table
						columns={[
							{ label: "When" },
							{ label: "Agent" },
							{ label: "Status" },
							{ label: "What happened" },
							{ label: "Tokens", numeric: true },
							{ label: "Cost", numeric: true },
						]}
					>
						{data.runs.map((r) => (
							<Row key={r.id}>
								<Cell small>{when(r.startedAt)}</Cell>
								<Cell>{r.agentKey}</Cell>
								<Cell>
									<Badge
										tone={
											r.status === "done"
												? "ok"
												: r.status === "awaiting_approval"
													? undefined
													: "bad"
										}
									>
										{r.status.replace("_", " ")}
									</Badge>
								</Cell>
								<Cell small>{r.error ?? r.output ?? "—"}</Cell>
								<Cell numeric>
									{(r.inputTokens + r.outputTokens).toLocaleString()}
								</Cell>
								<Cell numeric>{usd(r.costMicroUsd)}</Cell>
							</Row>
						))}
					</Table>
				)}
			</Card>
		</Page>
	);
}
