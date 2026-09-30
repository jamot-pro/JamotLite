import { useCallback, useEffect, useState } from "react";
import { api, SignedOut } from "./api.js";
import { Approvals } from "./pages/Approvals.js";
import { CompanyMap } from "./pages/CompanyMap.js";
import { Login } from "./pages/Login.js";
import { OverviewPage } from "./pages/Overview.js";
import { People } from "./pages/People.js";
import { Runs } from "./pages/Runs.js";
import { Settings } from "./pages/Settings.js";

const PAGES = [
	{ path: "/", label: "Overview", Page: OverviewPage },
	{ path: "/map", label: "Company map", Page: CompanyMap },
	{ path: "/people", label: "People", Page: People },
	{ path: "/approvals", label: "Approvals", Page: Approvals },
	{ path: "/runs", label: "Agent runs", Page: Runs },
	{ path: "/settings", label: "Settings", Page: Settings },
] as const;

export function App() {
	const [path, setPath] = useState(location.pathname);
	const [signedIn, setSignedIn] = useState<boolean | null>(null);

	useEffect(() => {
		const onPop = () => setPath(location.pathname);
		addEventListener("popstate", onPop);
		api<{ signedIn: boolean }>("/me").then(
			(me) => setSignedIn(me.signedIn),
			() => setSignedIn(false),
		);
		return () => removeEventListener("popstate", onPop);
	}, []);

	const go = useCallback((to: string) => {
		history.pushState(null, "", to);
		setPath(to);
		scrollTo(0, 0);
	}, []);

	// Any request that finds the session gone sends us back to sign-in.
	useEffect(() => {
		const onRejection = (e: PromiseRejectionEvent) => {
			if (e.reason instanceof SignedOut) {
				e.preventDefault();
				setSignedIn(false);
			}
		};
		addEventListener("unhandledrejection", onRejection);
		return () => removeEventListener("unhandledrejection", onRejection);
	}, []);

	if (signedIn === null) return <main className="center muted">Loading…</main>;
	if (!signedIn) return <Login onSignedIn={() => setSignedIn(true)} />;

	const current =
		PAGES.find((p) => p.path === path) ??
		PAGES.find((p) => path.startsWith(p.path) && p.path !== "/") ??
		PAGES[0];
	const { Page } = current;
	return (
		<div className="shell">
			<nav className="nav">
				<div className="brand">💓 Jamot</div>
				{PAGES.map((p) => (
					<a
						key={p.path}
						href={p.path}
						className={p === current ? "active" : ""}
						onClick={(e) => {
							e.preventDefault();
							go(p.path);
						}}
					>
						{p.label}
					</a>
				))}
				<button
					type="button"
					className="link signout"
					onClick={async () => {
						await api("/logout", { method: "POST", body: {} });
						setSignedIn(false);
					}}
				>
					Sign out
				</button>
			</nav>
			<main className="page">
				<Page go={go} />
			</main>
		</div>
	);
}

export type PageProps = { go: (path: string) => void };
