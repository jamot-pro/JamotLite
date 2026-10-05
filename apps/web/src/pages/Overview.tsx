import type { ActionResult, OverviewView } from "@jamot/contracts";
import { useCallback, useEffect, useState } from "react";
import type { PageProps } from "../App.js";
import { api, usd, when } from "../api.js";
import {
	Badge,
	Bullet,
	Bullets,
	Button,
	Card,
	Item,
	Label,
	List,
	Loading,
	Muted,
	Notice,
	Page,
	Tile,
	Tiles,
} from "../ui/index.js";

const TIER = {
	normal: "Healthy",
	low_funding: "Low on money",
	critical: "Critical",
} as const;

export function OverviewPage({ go }: PageProps) {
	const [data, setData] = useState<OverviewView | null>(null);
	const [note, setNote] = useState<string | null>(null);
	const load = useCallback(
		() => api<OverviewView>("/overview").then(setData),
		[],
	);
	useEffect(() => {
		load();
	}, [load]);
	if (!data) return <Loading />;
	const { company, charter, vitals } = data;
	const readiness = vitals.people.readiness;
	const money = vitals.money;
	// The headline is what matters most — who owns what — not the average of
	// every dimension, which hides three missing key roles behind "96%".
	const owned = readiness.dimensions.find((d) => d.key === "responsibilities");

	return (
		<Page
			title={company?.name}
			subtitle={charter?.mission}
			actions={
				readiness.covered && <Badge tone="ok">JAMOT — fully covered</Badge>
			}
		>
			<Tiles>
				<Tile
					label="Responsibilities owned"
					value={`${Math.round((owned?.score ?? 0) * 100)}%`}
					hint={
						vitals.people.unowned.length === 0
							? "every one has an owner"
							: `${vitals.people.unowned.length} still without an owner`
					}
				/>
				<Tile
					label="Survival"
					value={TIER[vitals.tier]}
					tone={
						vitals.tier === "critical"
							? "bad"
							: vitals.tier === "low_funding"
								? "warn"
								: undefined
					}
					hint={
						money.currency && money.balance !== null
							? `${(money.balance / 100).toFixed(2)} ${money.currency}${money.runwayDays !== null ? ` · ${money.runwayDays} days of runway` : ""}`
							: "Money isn't tracked yet"
					}
				/>
				<Tile
					label="Waiting for an answer"
					value={vitals.work.waiting.length}
					hint={`${vitals.work.failedReplies24h} failed replies today`}
				/>
				<Tile
					label="Approvals"
					value={data.pendingApprovals}
					hint="waiting for you"
					onClick={() => go("/approvals")}
				/>
				<Tile
					label="Agents, last 30 days"
					value={usd(money.llmCostMicroUsd30d)}
					hint="model spend"
				/>
			</Tiles>

			{note && <Notice>{note}</Notice>}

			<Card title="Needs you">
				{vitals.people.unowned.length === 0 &&
				data.issues.length === 0 &&
				vitals.work.waiting.length === 0 ? (
					<Muted block>
						Nothing right now. Every responsibility has an owner and nobody is
						waiting.
					</Muted>
				) : (
					<List>
						{vitals.people.unowned.map((r) => (
							<Item key={r.key}>
								<span>
									Nobody owns <strong>{r.name}</strong>
								</span>
								{company?.founderKey && (
									<Button
										size="small"
										onClick={async () => {
											const res = await api<ActionResult>(
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
									</Button>
								)}
							</Item>
						))}
						{vitals.work.waiting.map((w) => (
							<Item key={w.conversationId}>
								<span>
									<strong>{w.personName}</strong> has been waiting since{" "}
									{when(w.since)}
								</span>
							</Item>
						))}
						{data.issues
							.filter(
								(i) =>
									!i.key.startsWith("unowned:") &&
									!i.key.startsWith("waiting:"),
							)
							.map((i) => (
								<Item key={i.key}>
									<span>{i.title}</span>
									<Muted small>since {when(i.since)}</Muted>
								</Item>
							))}
					</List>
				)}
			</Card>

			<Card title="How ready the company is">
				<List>
					{readiness.dimensions.map((d) => (
						<Item key={d.key}>
							<span>
								{d.score === 1 ? "✅" : "⚠️"} {d.label}
								{d.missing.length > 0 && (
									<Muted small>
										{" "}
										— {d.missing.map((m) => m.name).join(" · ")}
									</Muted>
								)}
							</span>
							<Muted small>{Math.round(d.score * 100)}%</Muted>
						</Item>
					))}
				</List>
			</Card>

			{charter && (
				<Card title="The charter">
					{charter.vision && (
						<>
							<Label>Vision</Label>
							<p>{charter.vision}</p>
						</>
					)}
					{charter.mission && (
						<>
							<Label>Mission</Label>
							<p>{charter.mission}</p>
						</>
					)}
					{charter.values.length > 0 && (
						<>
							<Label>Values — rules the company never breaks</Label>
							<Bullets>
								{charter.values.map((v) => (
									<Bullet key={v}>{v}</Bullet>
								))}
							</Bullets>
						</>
					)}
					{charter.goals.length > 0 && (
						<>
							<Label>Goals</Label>
							<Bullets>
								{charter.goals.map((g) => (
									<Bullet key={g}>{g}</Bullet>
								))}
							</Bullets>
						</>
					)}
				</Card>
			)}
		</Page>
	);
}
