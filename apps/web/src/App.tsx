import type { Me } from "@jamot/contracts";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api, SignedOut } from "./api.js";
import { Agents } from "./pages/Agents.js";
import { Approvals } from "./pages/Approvals.js";
import { CompanyMap } from "./pages/CompanyMap.js";
import { Login } from "./pages/Login.js";
import { OverviewPage } from "./pages/Overview.js";
import { People } from "./pages/People.js";
import { Runs } from "./pages/Runs.js";
import { Settings } from "./pages/Settings.js";
import { Stewards } from "./pages/Stewards.js";
import {
	Banner,
	Brand,
	Center,
	NavLink,
	PageLink,
	Shell,
	SignOut,
} from "./ui/index.js";

const PAGES = [
	{ path: "/", label: "Overview", Page: OverviewPage },
	{ path: "/map", label: "Company map", Page: CompanyMap },
	{ path: "/stewards", label: "Stewards", Page: Stewards },
	{ path: "/agents", label: "Agents", Page: Agents },
	{ path: "/people", label: "People", Page: People },
	{ path: "/approvals", label: "Approvals", Page: Approvals },
	{ path: "/runs", label: "Agent runs", Page: Runs },
	{ path: "/settings", label: "Settings", Page: Settings },
] as const;

// Every component in every state, for building and restyling the console.
// Only in development: a production build leaves it out entirely.
const Gallery = import.meta.env.DEV
	? lazy(() => import("./dev/Gallery.js").then((m) => ({ default: m.Gallery })))
	: null;

export function App() {
	const [path, setPath] = useState(location.pathname);
	const [signedIn, setSignedIn] = useState<boolean | null>(null);
	const [demo, setDemo] = useState(false);

	useEffect(() => {
		const onPop = () => setPath(location.pathname);
		addEventListener("popstate", onPop);
		api<Me>("/me").then(
			(me) => {
				setSignedIn(me.signedIn);
				setDemo(me.demo === true);
			},
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

	if (Gallery && path === "/dev/ui")
		return (
			<Suspense fallback={<Center muted>Loading…</Center>}>
				<Gallery />
			</Suspense>
		);
	if (signedIn === null) return <Center muted>Loading…</Center>;
	if (!signedIn) return <Login onSignedIn={() => setSignedIn(true)} />;

	const current =
		PAGES.find((p) => p.path === path) ??
		PAGES.find((p) => path.startsWith(p.path) && p.path !== "/") ??
		PAGES[0];
	const { Page } = current;
	return (
		<Shell
			nav={
				<>
					<Brand>💓 Jamot</Brand>
					{PAGES.map((p) => (
						<NavLink key={p.path} to={p.path} active={p === current} go={go}>
							{p.label}
						</NavLink>
					))}
					<SignOut
						onClick={async () => {
							await api("/logout", { method: "POST", body: {} });
							setSignedIn(false);
						}}
					/>
				</>
			}
		>
			{demo && (
				<Banner>
					This is a demo company: its agents answer with a scripted demo model,
					and nothing reaches real people. Add a real model in{" "}
					<PageLink to="/settings" go={go}>
						Settings
					</PageLink>{" "}
					to make it real.
				</Banner>
			)}
			<Page go={go} />
		</Shell>
	);
}

export type PageProps = { go: (path: string) => void };
