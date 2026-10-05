import type { ActionResult, MapNode, MapView } from "@jamot/contracts";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import {
	Badge,
	Bullet,
	Bullets,
	ButtonLink,
	Card,
	ErrorText,
	Grid,
	Item,
	Label,
	List,
	Loading,
	Muted,
	Notice,
	Page,
	Select,
	Small,
} from "../ui/index.js";

/**
 * The company map as the owner reads it: each team with the people and agents
 * in it and the responsibilities it holds; what nobody owns, with a way to
 * give it an owner; and the heartbeats that watch it all.
 */
export function CompanyMap() {
	const [map, setMap] = useState<MapView | null>(null);
	const [note, setNote] = useState<string | null>(null);
	const load = useCallback(() => api<MapView>("/map").then(setMap), []);
	useEffect(() => {
		load();
	}, [load]);
	if (!map) return <Loading />;

	const byId = new Map(map.nodes.map((n) => [n.id, n]));
	const of = (kind: MapNode["kind"]) =>
		map.nodes.filter((n) => n.kind === kind);
	const edgesTo = (id: string, relations: string[]) =>
		map.edges.filter((e) => e.to === id && relations.includes(e.relation));
	const ownersOf = (r: MapNode) =>
		edgesTo(r.id, ["owns", "responsible_for"])
			.map((e) => byId.get(e.from))
			.filter((n): n is MapNode => !!n);
	const candidates = map.nodes.filter(
		(n) => n.kind === "human" || n.kind === "agent" || n.kind === "team",
	);
	const unowned = of("responsibility").filter((r) => ownersOf(r).length === 0);

	const assign = async (responsibility: MapNode, ownerKey: string) => {
		const res = await api<ActionResult>(
			`/responsibilities/${responsibility.key}/owner`,
			{ method: "POST", body: { ownerKey } },
		);
		setNote(res.message);
		load();
	};

	return (
		<Page
			title="Company map"
			actions={
				<ButtonLink
					variant="secondary"
					href="/api/company.yaml"
					download="company.yaml"
				>
					Download company.yaml
				</ButtonLink>
			}
		>
			{note && <Notice>{note}</Notice>}

			{unowned.length > 0 && (
				<Card tone="warn" title="Nobody owns these yet">
					<List>
						{unowned.map((r) => (
							<Item key={r.id}>
								<strong>{r.name}</strong>
								<Select
									defaultValue=""
									onChange={(e) => {
										if (e.target.value) assign(r, e.target.value);
									}}
								>
									<option value="" disabled>
										Give it to…
									</option>
									{candidates.map((c) => (
										<option key={c.key} value={c.key}>
											{c.name} ({c.kind})
										</option>
									))}
								</Select>
							</Item>
						))}
					</List>
				</Card>
			)}

			<Grid>
				{of("team").map((team) => {
					const members = edgesTo(team.id, ["member_of"])
						.map((e) => byId.get(e.from))
						.filter((n): n is MapNode => !!n);
					const held = of("responsibility").filter((r) =>
						ownersOf(r).some(
							(o) => o.id === team.id || members.some((m) => m.id === o.id),
						),
					);
					const watchers = edgesTo(team.id, ["monitors"])
						.map((e) => byId.get(e.from))
						.filter((n): n is MapNode => !!n);
					return (
						<Card as="article" key={team.id} title={team.name}>
							{typeof team.config.purpose === "string" && (
								<Muted block>{team.config.purpose}</Muted>
							)}
							<Label>In it</Label>
							{members.length === 0 ? (
								<ErrorText small>Nobody yet</ErrorText>
							) : (
								<Bullets>
									{members.map((m) => (
										<Bullet key={m.id}>
											{m.kind === "agent" ? "🤖" : "🧑"} {m.name}
											{typeof m.config.role === "string" && (
												<Muted small> — {m.config.role}</Muted>
											)}
										</Bullet>
									))}
								</Bullets>
							)}
							<Label>Responsibilities</Label>
							<Bullets>
								{held.map((r) => (
									<Bullet key={r.id}>
										{r.name}{" "}
										<Muted small>
											·{" "}
											{ownersOf(r)
												.map((o) => o.name)
												.join(", ")}
										</Muted>
									</Bullet>
								))}
								{held.length === 0 && <Bullet muted>None</Bullet>}
							</Bullets>
							{watchers.map((h) => (
								<Small block key={h.id}>
									💓 {h.name} <code>{String(h.config.schedule)}</code>
								</Small>
							))}
						</Card>
					);
				})}
			</Grid>

			<Card title="Heartbeats">
				<List>
					{of("heartbeat").map((h) => (
						<Item key={h.id}>
							<span>
								💓 {h.name}
								<Muted small>
									{" "}
									— watches{" "}
									{map.edges
										.filter((e) => e.from === h.id && e.relation === "monitors")
										.map((e) => byId.get(e.to)?.name)
										.join(", ")}
								</Muted>
							</span>
							<code>{String(h.config.schedule)}</code>
						</Item>
					))}
				</List>
			</Card>

			<Card title="Tools">
				<Bullets>
					{of("tool").map((t) => (
						<Bullet key={t.id}>
							🔧 {t.name}
							{typeof t.config.purpose === "string" && (
								<Muted small> — {t.config.purpose}</Muted>
							)}
							{"mcp" in t.config && <Badge small>MCP</Badge>}
						</Bullet>
					))}
				</Bullets>
			</Card>
		</Page>
	);
}
