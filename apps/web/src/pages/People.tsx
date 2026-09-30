import { useCallback, useEffect, useState } from "react";
import { api, type Person, when } from "../api.js";

interface Profile {
	person: {
		id: string;
		displayName: string;
		email: string | null;
		phone: string | null;
		lastInteractionAt: string | null;
	};
	identities: { id: string; provider: string; value: string }[];
	memories: {
		id: string;
		kind: string;
		content: string;
		source: string;
		createdAt: string;
	}[];
	conversations: {
		id: string;
		channel: string;
		lastMessageAt: string | null;
	}[];
}
interface Message {
	id: string;
	direction: "in" | "out";
	text: string;
	agentKey: string | null;
	status: string;
	createdAt: string;
}

/** The company's CRM: everyone it talks to, and what it remembers about them. */
export function People() {
	const [search, setSearch] = useState("");
	const [people, setPeople] = useState<Person[] | null>(null);
	const [selected, setSelected] = useState<string | null>(null);

	useEffect(() => {
		const t = setTimeout(
			() =>
				api<Person[]>(`/people?search=${encodeURIComponent(search)}`).then(
					setPeople,
				),
			200,
		);
		return () => clearTimeout(t);
	}, [search]);

	return (
		<>
			<header className="head">
				<h1>People</h1>
				<input
					className="search"
					placeholder="Search by name, email or phone"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
			</header>
			<div className="split">
				<section className="card">
					{!people ? (
						<p className="muted">Loading…</p>
					) : people.length === 0 ? (
						<p className="muted">
							Nobody yet. When someone writes to the company's Telegram bot,
							they appear here.
						</p>
					) : (
						<ul className="list selectable">
							{people.map((p) => (
								<li key={p.id} className={p.id === selected ? "selected" : ""}>
									<button
										type="button"
										className="link"
										onClick={() => setSelected(p.id)}
									>
										{p.name}
									</button>
									<span className="muted small">
										{when(p.lastInteractionAt)}
									</span>
								</li>
							))}
						</ul>
					)}
				</section>
				{selected && <PersonView id={selected} />}
			</div>
		</>
	);
}

function PersonView({ id }: { id: string }) {
	const [profile, setProfile] = useState<Profile | null>(null);
	const [messages, setMessages] = useState<Message[] | null>(null);
	const [note, setNote] = useState("");
	const load = useCallback(
		() => api<Profile>(`/people/${id}`).then(setProfile),
		[id],
	);
	useEffect(() => {
		setMessages(null);
		load();
	}, [load]);
	if (!profile) return <section className="card muted">Loading…</section>;
	const { person } = profile;
	const facts = profile.memories.filter((m) => m.kind !== "interaction");

	return (
		<section className="card">
			<h2>{person.displayName}</h2>
			<p className="muted small">
				{[
					person.email,
					person.phone,
					...profile.identities.map((i) => `${i.provider} ${i.value}`),
				]
					.filter(Boolean)
					.join(" · ")}
			</p>

			<h3>What the company remembers</h3>
			{facts.length === 0 ? (
				<p className="muted">Nothing noted yet.</p>
			) : (
				<ul className="plain">
					{facts.map((m) => (
						<li key={m.id}>
							{m.content}{" "}
							<span className="muted small">
								· {m.source}, {when(m.createdAt)}
							</span>
						</li>
					))}
				</ul>
			)}
			<form
				className="row"
				onSubmit={async (e) => {
					e.preventDefault();
					await api("/memory", {
						method: "POST",
						body: { note, personId: person.id },
					});
					setNote("");
					load();
				}}
			>
				<input
					placeholder="Note something (an allergy, a birthday…)"
					value={note}
					onChange={(e) => setNote(e.target.value)}
				/>
				<button type="submit" disabled={note.trim().length < 3}>
					Remember
				</button>
			</form>

			<h3>Conversations</h3>
			{profile.conversations.map((c) => (
				<button
					key={c.id}
					type="button"
					className="secondary small"
					onClick={() =>
						api<Message[]>(`/conversations/${c.id}/messages`).then(setMessages)
					}
				>
					{c.channel} · {when(c.lastMessageAt)}
				</button>
			))}
			{messages && (
				<div className="chat">
					{messages.map((m) => (
						<div key={m.id} className={`bubble ${m.direction}`}>
							<div>{m.text}</div>
							<div className="muted small">
								{m.direction === "out"
									? (m.agentKey ?? "company")
									: person.displayName}{" "}
								· {when(m.createdAt)}
								{m.status === "failed" && " · not delivered"}
							</div>
						</div>
					))}
				</div>
			)}
		</section>
	);
}
