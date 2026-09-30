import { useCallback, useEffect, useState } from "react";
import { api, type MapEdge, type MapNode } from "../api.js";

/**
 * The company map as the owner reads it: each team with the people and agents
 * in it and the responsibilities it holds; what nobody owns, with a way to
 * give it an owner; and the heartbeats that watch it all.
 */
export function CompanyMap() {
	const [map, setMap] = useState<{ nodes: MapNode[]; edges: MapEdge[] } | null>(
		null,
	);
	const [note, setNote] = useState<string | null>(null);
	const load = useCallback(
		() => api<{ nodes: MapNode[]; edges: MapEdge[] }>("/map").then(setMap),
		[],
	);
	useEffect(() => {
		load();
	}, [load]);
	if (!map) return <p className="muted">Loading…</p>;

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
		const res = await api<{ message: string }>(
			`/responsibilities/${responsibility.key}/owner`,
			{ method: "POST", body: { ownerKey } },
		);
		setNote(res.message);
		load();
	};

	return (
		<>
			<header className="head">
				<h1>Company map</h1>
				<a
					className="button secondary"
					href="/api/company.yaml"
					download="company.yaml"
				>
					Download company.yaml
				</a>
			</header>
			{note && <p className="notice">{note}</p>}

			{unowned.length > 0 && (
				<section className="card warn">
					<h2>Nobody owns these yet</h2>
					<ul className="list">
						{unowned.map((r) => (
							<li key={r.id}>
								<strong>{r.name}</strong>
								<select
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
								</select>
							</li>
						))}
					</ul>
				</section>
			)}

			<section className="grid">
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
						<article className="card" key={team.id}>
							<h2>{team.name}</h2>
							{typeof team.config.purpose === "string" && (
								<p className="muted">{team.config.purpose}</p>
							)}
							<h3>In it</h3>
							{members.length === 0 ? (
								<p className="error small">Nobody yet</p>
							) : (
								<ul className="plain">
									{members.map((m) => (
										<li key={m.id}>
											{m.kind === "agent" ? "🤖" : "🧑"} {m.name}
											{typeof m.config.role === "string" && (
												<span className="muted small"> — {m.config.role}</span>
											)}
										</li>
									))}
								</ul>
							)}
							<h3>Responsibilities</h3>
							<ul className="plain">
								{held.map((r) => (
									<li key={r.id}>
										{r.name}{" "}
										<span className="muted small">
											·{" "}
											{ownersOf(r)
												.map((o) => o.name)
												.join(", ")}
										</span>
									</li>
								))}
								{held.length === 0 && <li className="muted">None</li>}
							</ul>
							{watchers.map((h) => (
								<p key={h.id} className="small">
									💓 {h.name} <code>{String(h.config.schedule)}</code>
								</p>
							))}
						</article>
					);
				})}
			</section>

			<section className="card">
				<h2>Heartbeats</h2>
				<ul className="list">
					{of("heartbeat").map((h) => (
						<li key={h.id}>
							<span>
								💓 {h.name}
								<span className="muted small">
									{" "}
									— watches{" "}
									{map.edges
										.filter((e) => e.from === h.id && e.relation === "monitors")
										.map((e) => byId.get(e.to)?.name)
										.join(", ")}
								</span>
							</span>
							<code>{String(h.config.schedule)}</code>
						</li>
					))}
				</ul>
			</section>

			<section className="card">
				<h2>Tools</h2>
				<ul className="plain">
					{of("tool").map((t) => (
						<li key={t.id}>
							🔧 {t.name}
							{typeof t.config.purpose === "string" && (
								<span className="muted small"> — {t.config.purpose}</span>
							)}
							{"mcp" in t.config && <span className="badge small">MCP</span>}
						</li>
					))}
				</ul>
			</section>
		</>
	);
}
