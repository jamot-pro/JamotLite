import { useState } from "react";
import { api } from "../api.js";

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	return (
		<main className="center">
			<form
				className="card login"
				onSubmit={async (e) => {
					e.preventDefault();
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
				<p className="muted">
					The organization that doesn't die when people leave.
				</p>
				<label>
					Password
					<input
						type="password"
						autoComplete="current-password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
					/>
				</label>
				{error && <p className="error">{error}</p>}
				<button type="submit" disabled={busy || password.length === 0}>
					{busy ? "Signing in…" : "Sign in"}
				</button>
				<p className="muted small">
					Forgot it? Run <code>jamot password</code> on the machine.
				</p>
			</form>
		</main>
	);
}
