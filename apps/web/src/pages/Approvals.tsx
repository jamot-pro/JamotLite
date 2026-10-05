import type { ApprovalRow, ApprovalsView } from "@jamot/contracts";
import { useCallback, useEffect, useState } from "react";
import { api, when } from "../api.js";
import {
	Actions,
	Button,
	Card,
	Loading,
	Muted,
	Notice,
	Page,
	Pre,
} from "../ui/index.js";

/** What agents are waiting for a person to decide. */
export function Approvals() {
	const [pending, setPending] = useState<ApprovalRow[] | null>(null);
	const [note, setNote] = useState<string | null>(null);
	const load = useCallback(
		() => api<ApprovalsView>("/approvals").then((r) => setPending(r.pending)),
		[],
	);
	useEffect(() => {
		load();
	}, [load]);

	const decide = async (a: ApprovalRow, approved: boolean) => {
		await api(`/approvals/${a.id}`, { method: "POST", body: { approved } });
		setNote(
			`${approved ? "Approved" : "Declined"}: ${a.tool}. The agent carries on.`,
		);
		load();
	};

	return (
		<Page title="Approvals">
			{note && <Notice>{note}</Notice>}
			{!pending ? (
				<Loading />
			) : pending.length === 0 ? (
				<Card muted>Nothing is waiting for you.</Card>
			) : (
				pending.map((a) => (
					<Card key={a.id} title={`${a.agentKey} wants to use ${a.tool}`}>
						<Pre>{JSON.stringify(a.args, null, 2)}</Pre>
						<Muted small block>
							Waiting since {when(a.createdAt)}
						</Muted>
						<Actions>
							<Button onClick={() => decide(a, true)}>Approve</Button>
							<Button variant="secondary" onClick={() => decide(a, false)}>
								Decline
							</Button>
						</Actions>
					</Card>
				))
			)}
		</Page>
	);
}
