import type { MessageRow, PersonProfile, PersonRow } from "@jamot/contracts";
import { useCallback, useEffect, useState } from "react";
import { api, when } from "../api.js";
import {
	Bubble,
	Bullet,
	Bullets,
	Button,
	Card,
	Chat,
	Form,
	Input,
	Item,
	Label,
	List,
	Loading,
	Muted,
	Page,
	Split,
} from "../ui/index.js";

/** The company's CRM: everyone it talks to, and what it remembers about them. */
export function People() {
	const [search, setSearch] = useState("");
	const [people, setPeople] = useState<PersonRow[] | null>(null);
	const [selected, setSelected] = useState<string | null>(null);

	useEffect(() => {
		const t = setTimeout(
			() =>
				api<PersonRow[]>(`/people?search=${encodeURIComponent(search)}`).then(
					setPeople,
				),
			200,
		);
		return () => clearTimeout(t);
	}, [search]);

	return (
		<Page
			title="People"
			actions={
				<Input
					search
					placeholder="Search by name, email or phone"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
			}
		>
			<Split>
				<Card>
					{!people ? (
						<Loading />
					) : people.length === 0 ? (
						<Muted block>
							Nobody yet. When someone writes to the company's Telegram bot,
							they appear here.
						</Muted>
					) : (
						<List selectable>
							{people.map((p) => (
								<Item key={p.id} selected={p.id === selected}>
									<Button variant="link" onClick={() => setSelected(p.id)}>
										{p.name}
									</Button>
									<Muted small>{when(p.lastInteractionAt)}</Muted>
								</Item>
							))}
						</List>
					)}
				</Card>
				{selected && <PersonView id={selected} />}
			</Split>
		</Page>
	);
}

function PersonView({ id }: { id: string }) {
	const [profile, setProfile] = useState<PersonProfile | null>(null);
	const [messages, setMessages] = useState<MessageRow[] | null>(null);
	const [note, setNote] = useState("");
	const load = useCallback(
		() => api<PersonProfile>(`/people/${id}`).then(setProfile),
		[id],
	);
	useEffect(() => {
		setMessages(null);
		load();
	}, [load]);
	if (!profile) return <Card muted>Loading…</Card>;
	const { person } = profile;
	const facts = profile.memories.filter((m) => m.kind !== "interaction");

	return (
		<Card title={person.displayName}>
			<Muted small block>
				{[
					person.email,
					person.phone,
					...profile.identities.map((i) => `${i.provider} ${i.value}`),
				]
					.filter(Boolean)
					.join(" · ")}
			</Muted>

			<Label>What the company remembers</Label>
			{facts.length === 0 ? (
				<Muted block>Nothing noted yet.</Muted>
			) : (
				<Bullets>
					{facts.map((m) => (
						<Bullet key={m.id}>
							{m.content}{" "}
							<Muted small>
								· {m.source}, {when(m.createdAt)}
							</Muted>
						</Bullet>
					))}
				</Bullets>
			)}
			<Form
				layout="row"
				onSubmit={async () => {
					await api("/memory", {
						method: "POST",
						body: { note, personId: person.id },
					});
					setNote("");
					load();
				}}
			>
				<Input
					placeholder="Note something (an allergy, a birthday…)"
					value={note}
					onChange={(e) => setNote(e.target.value)}
				/>
				<Button type="submit" disabled={note.trim().length < 3}>
					Remember
				</Button>
			</Form>

			<Label>Conversations</Label>
			{profile.conversations.map((c) => (
				<Button
					key={c.id}
					variant="secondary"
					size="small"
					onClick={() =>
						api<MessageRow[]>(`/conversations/${c.id}/messages`).then(
							setMessages,
						)
					}
				>
					{c.channel} · {when(c.lastMessageAt)}
				</Button>
			))}
			{messages && (
				<Chat>
					{messages.map((m) => (
						<Bubble
							key={m.id}
							direction={m.direction}
							meta={
								<>
									{m.direction === "out"
										? (m.agentKey ?? "company")
										: person.displayName}{" "}
									· {when(m.createdAt)}
									{m.status === "failed" && " · not delivered"}
								</>
							}
						>
							{m.text}
						</Bubble>
					))}
				</Chat>
			)}
		</Card>
	);
}
