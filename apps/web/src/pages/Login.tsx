import { useState } from "react";
import { api } from "../api.js";
import {
	Button,
	Center,
	ErrorText,
	Field,
	Form,
	Input,
	Muted,
} from "../ui/index.js";

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	return (
		<Center>
			<Form
				card
				onSubmit={async () => {
					setBusy(true);
					setError(null);
					try {
						await api("/login", { method: "POST", body: { password } });
						onSignedIn();
					} catch (err) {
						setError(err instanceof Error ? err.message : String(err));
					} finally {
						setBusy(false);
					}
				}}
			>
				<h1>💓 Jamot</h1>
				<Muted block>
					The organization that doesn't die when people leave.
				</Muted>
				<Field label="Password">
					<Input
						type="password"
						autoComplete="current-password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
					/>
				</Field>
				{error && <ErrorText>{error}</ErrorText>}
				<Button type="submit" disabled={busy || password.length === 0}>
					{busy ? "Signing in…" : "Sign in"}
				</Button>
				<Muted small block>
					Forgot it? Run <code>jamot password</code> on the machine.
				</Muted>
			</Form>
		</Center>
	);
}
