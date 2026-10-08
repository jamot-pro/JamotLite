import { LogOut, Moon, Sun } from "lucide-react";
import type {
	ButtonHTMLAttributes,
	FormEvent,
	InputHTMLAttributes,
	ReactNode,
	SelectHTMLAttributes,
	TextareaHTMLAttributes,
} from "react";
import { useEffect, useRef, useState } from "react";

/**
 * The console's building blocks. Pages are made only of these (and plain
 * text elements: p, strong, em, code, br), never with class names or styles
 * of their own — so a new look is a change to `tokens.css`, `components.css`
 * and this file, not to every page (apps/web/DESIGN.md, RUNTIME D46).
 *
 * Every component is shown, in each of its states, on `/dev/ui`.
 */

const cx = (...names: (string | false | null | undefined)[]) =>
	names.filter(Boolean).join(" ");

type Children = { children?: ReactNode };

/* ── Page frame ─────────────────────────────────────────────────────────── */

/** A page: its title, an optional line under it, actions on the right. */
export function Page({
	title,
	subtitle,
	actions,
	children,
}: Children & { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
	return (
		<>
			<header className="head">
				{subtitle ? (
					<div>
						<h1>{title}</h1>
						<p className="dream">{subtitle}</p>
					</div>
				) : (
					<h1>{title}</h1>
				)}
				{actions}
			</header>
			{children}
		</>
	);
}

/** A card: one subject on a page. `tone="warn"` when it needs attention. */
export function Card({
	title,
	tone,
	muted,
	as = "section",
	children,
}: Children & {
	title?: ReactNode;
	tone?: "warn";
	muted?: boolean;
	as?: "section" | "article";
}) {
	const Tag = as;
	return (
		<Tag className={cx("card", tone, muted && "muted")}>
			{title !== undefined && <h2>{title}</h2>}
			{children}
		</Tag>
	);
}

/** A small heading inside a card. */
export function Label({ children }: Children) {
	return <h3>{children}</h3>;
}

/* ── Numbers at a glance ────────────────────────────────────────────────── */

export function Tiles({ children }: Children) {
	return <section className="tiles">{children}</section>;
}

/** One number, with what it is and a line of context. Clickable with onClick. */
export function Tile({
	label,
	value,
	hint,
	tone,
	onClick,
}: {
	label: ReactNode;
	value: ReactNode;
	hint?: ReactNode;
	tone?: "warn" | "bad";
	onClick?: () => void;
}) {
	const toneClass =
		tone === "warn"
			? "tier-low_funding"
			: tone === "bad"
				? "tier-critical"
				: "";
	const body = (
		<>
			<span className="label">{label}</span>
			<span className="value">{value}</span>
			{hint !== undefined && <span className="muted small">{hint}</span>}
		</>
	);
	return onClick ? (
		<button
			type="button"
			className={cx("tile clickable", toneClass)}
			onClick={onClick}
		>
			{body}
		</button>
	) : (
		<div className={cx("tile", toneClass)}>{body}</div>
	);
}

/* ── Lists and tables ───────────────────────────────────────────────────── */

/** Rows with something on the left and something on the right. */
export function List({
	selectable,
	children,
}: Children & { selectable?: boolean }) {
	return <ul className={cx("list", selectable && "selectable")}>{children}</ul>;
}
export function Item({
	selected,
	children,
}: Children & { selected?: boolean }) {
	return <li className={selected ? "selected" : undefined}>{children}</li>;
}

/** A plain bulleted list. */
export function Bullets({ children }: Children) {
	return <ul className="plain">{children}</ul>;
}
export function Bullet({ muted, children }: Children & { muted?: boolean }) {
	return <li className={muted ? "muted" : undefined}>{children}</li>;
}

export function Table({
	columns,
	children,
}: Children & { columns: { label: string; numeric?: boolean }[] }) {
	return (
		<table>
			<thead>
				<tr>
					{columns.map((c) => (
						<th key={c.label} className={c.numeric ? "num" : undefined}>
							{c.label}
						</th>
					))}
				</tr>
			</thead>
			<tbody>{children}</tbody>
		</table>
	);
}
export function Row({ children }: Children) {
	return <tr>{children}</tr>;
}
export function Cell({
	numeric,
	small,
	children,
}: Children & { numeric?: boolean; small?: boolean }) {
	return (
		<td className={cx(numeric && "num", small && "small") || undefined}>
			{children}
		</td>
	);
}

/* ── Text ───────────────────────────────────────────────────────────────── */

/** Secondary text. `small` for the smallest size; `block` for a paragraph. */
export function Muted({
	small,
	block,
	children,
}: Children & { small?: boolean; block?: boolean }) {
	const className = cx("muted", small && "small");
	return block ? (
		<p className={className}>{children}</p>
	) : (
		<span className={className}>{children}</span>
	);
}

/** Small text in the normal colour. */
export function Small({ block, children }: Children & { block?: boolean }) {
	return block ? (
		<p className="small">{children}</p>
	) : (
		<span className="small">{children}</span>
	);
}

/** A sentence about something that went wrong. */
export function ErrorText({ small, children }: Children & { small?: boolean }) {
	return <p className={cx("error", small && "small")}>{children}</p>;
}

/** What an action just did, at the top of the page. */
export function Notice({ children }: Children) {
	return <p className="notice">{children}</p>;
}

/** A page-wide warning, such as the demo banner. */
export function Banner({ children }: Children) {
	return (
		<p className="demo-banner" role="status">
			{children}
		</p>
	);
}

export function Badge({
	tone,
	small,
	children,
}: Children & { tone?: "ok" | "bad"; small?: boolean }) {
	return (
		<span className={cx("badge", tone, small && "small")}>{children}</span>
	);
}

/** Preformatted text, such as a tool call's arguments. */
export function Pre({ children }: Children) {
	return <pre>{children}</pre>;
}

/** A secret shown once: it wraps anywhere. */
export function Secret({ children }: Children) {
	return <code className="secret">{children}</code>;
}

export function Loading() {
	return <p className="muted">Loading…</p>;
}

/* ── Actions and forms ──────────────────────────────────────────────────── */

type ButtonProps = Omit<
	ButtonHTMLAttributes<HTMLButtonElement>,
	"className"
> & {
	variant?: "primary" | "secondary" | "link";
	size?: "small";
};
export function Button({
	variant = "primary",
	size,
	type = "button",
	...rest
}: ButtonProps) {
	return (
		<button
			type={type}
			className={
				cx(variant !== "primary" && variant, size === "small" && "small") ||
				undefined
			}
			{...rest}
		/>
	);
}

/** A link that looks like a button (downloads, other sites). */
export function ButtonLink({
	href,
	download,
	variant = "primary",
	children,
}: Children & {
	href: string;
	download?: string;
	variant?: "primary" | "secondary";
}) {
	return (
		<a
			className={cx("button", variant === "secondary" && "secondary")}
			href={href}
			download={download}
		>
			{children}
		</a>
	);
}

/** A link inside the console: changes the page without reloading. */
export function PageLink({
	to,
	go,
	children,
}: Children & { to: string; go: (path: string) => void }) {
	return (
		<a
			href={to}
			onClick={(e) => {
				e.preventDefault();
				go(to);
			}}
		>
			{children}
		</a>
	);
}

/** A form: fields stacked (`stack`, the default) or on one line (`row`). */
export function Form({
	layout = "stack",
	card,
	onSubmit,
	children,
}: Children & {
	layout?: "stack" | "row";
	/** The form is the card (the sign-in box); "wide" for a longer read. */
	card?: boolean | "wide";
	onSubmit: (e: FormEvent<HTMLFormElement>) => void | Promise<void>;
}) {
	return (
		<form
			className={card ? `card login${card === "wide" ? " wide" : ""}` : layout}
			onSubmit={(e) => {
				e.preventDefault();
				void onSubmit(e);
			}}
		>
			{children}
		</form>
	);
}

/** A labelled field: the label, an optional hint after it, then the control. */
export function Field({
	label,
	hint,
	children,
}: Children & { label: ReactNode; hint?: ReactNode }) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the control is `children`, wrapped by the label
		<label>
			{label}
			{hint !== undefined && (
				<>
					{" "}
					<span className="muted small">{hint}</span>
				</>
			)}
			{children}
		</label>
	);
}

export function Input({
	search,
	...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
	/** The search box in a page's header. */
	search?: boolean;
}) {
	return <input className={search ? "search" : undefined} {...rest} />;
}

export function Select(
	props: Omit<SelectHTMLAttributes<HTMLSelectElement>, "className">,
) {
	return <select {...props} />;
}

/** Several lines of text, such as an agent's instructions. */
export function TextArea(
	props: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className">,
) {
	return <textarea rows={8} {...props} />;
}

/** A checkbox with its label beside it, and an optional line under it. */
export function Checkbox({
	label,
	hint,
	checked,
	disabled,
	onChange,
}: {
	label: ReactNode;
	hint?: ReactNode;
	checked: boolean;
	disabled?: boolean;
	onChange?: (checked: boolean) => void;
}) {
	return (
		<label className="check">
			<input
				type="checkbox"
				checked={checked}
				disabled={disabled}
				onChange={(e) => onChange?.(e.target.checked)}
			/>
			<span>
				{label}
				{hint !== undefined && (
					<span className="muted small check-hint">{hint}</span>
				)}
			</span>
		</label>
	);
}

/* ── Layout ─────────────────────────────────────────────────────────────── */

/** Things side by side, wrapping on small screens. */
export function Actions({ children }: Children) {
	return <div className="row">{children}</div>;
}

/** Cards in a responsive grid. */
export function Grid({ children }: Children) {
	return <section className="grid">{children}</section>;
}

/** A narrow column and a wide one (a list and its detail). */
export function Split({ children }: Children) {
	return <div className="split">{children}</div>;
}

/** A centred screen, for sign-in and loading. */
export function Center({ muted, children }: Children & { muted?: boolean }) {
	return <main className={cx("center", muted && "muted")}>{children}</main>;
}

/* ── Conversations ──────────────────────────────────────────────────────── */

/** A conversation; `follow` keeps the newest message in view as it grows. */
export function Chat({ children, follow }: Children & { follow?: boolean }) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
	});
	return (
		<div className="chat" ref={ref}>
			{children}
		</div>
	);
}
export function Bubble({
	direction,
	meta,
	children,
}: Children & { direction: "in" | "out"; meta?: ReactNode }) {
	return (
		<div className={cx("bubble", direction)}>
			<div>{children}</div>
			{meta !== undefined && <div className="muted small">{meta}</div>}
		</div>
	);
}

/* ── The console's frame ────────────────────────────────────────────────── */

/**
 * The frame, as in J-Nesys's console (D50): an icon rail and a workspace,
 * flat cards on the grey ground. `foot` holds the rail's bottom tools (theme,
 * sign out); on a phone the rail becomes a bottom bar and they move to the
 * workspace's header. `title` names what the workspace shows.
 */
export function Shell({
	nav,
	foot,
	title,
	children,
}: Children & { nav: ReactNode; foot?: ReactNode; title?: ReactNode }) {
	return (
		<div className="shell">
			<nav className="rail" aria-label="Sections">
				<Brand />
				<div className="rail-items">{nav}</div>
				{foot && <div className="rail-foot">{foot}</div>}
			</nav>
			<main className="workspace">
				<header className="workspace-head">
					<span>{title}</span>
					{foot && <span className="workspace-tools">{foot}</span>}
				</header>
				<div className="page">{children}</div>
			</main>
		</div>
	);
}

/** The Jamot mark, light or dark with the theme. */
export function Brand() {
	return (
		<div className="brand">
			<img
				className="brand-mark on-light"
				src="/brand/jamot-logo.png"
				alt="Jamot"
			/>
			<img
				className="brand-mark on-dark"
				src="/brand/jamot-logo-white.webp"
				alt=""
				aria-hidden="true"
			/>
		</div>
	);
}

/** The J mark and the name, as a page title. */
export function Wordmark() {
	return (
		<h1 className="wordmark">
			<img className="brand-mark on-light" src="/brand/jamot-logo.png" alt="" />
			<img
				className="brand-mark on-dark"
				src="/brand/jamot-logo-white.webp"
				alt=""
				aria-hidden="true"
			/>
			Jamot
		</h1>
	);
}

/** A section in the rail: its icon, and its name as a tooltip. */
export function NavLink({
	to,
	active,
	go,
	icon,
	children,
}: Children & {
	to: string;
	active: boolean;
	go: (path: string) => void;
	icon: ReactNode;
}) {
	return (
		<a
			href={to}
			className={cx("rail-item", active && "active")}
			aria-current={active ? "page" : undefined}
			onClick={(e) => {
				e.preventDefault();
				go(to);
			}}
		>
			{icon}
			<span className="rail-label">{children}</span>
		</a>
	);
}

/** A tool at the foot of the rail. */
export function RailButton({
	label,
	icon,
	onClick,
}: {
	label: string;
	icon: ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className="rail-item"
			aria-label={label}
			onClick={onClick}
		>
			{icon}
			<span className="rail-label">{label}</span>
		</button>
	);
}

const THEME_KEY = "jamot:theme";

/** Applies the theme chosen before (the browser may not keep it: that's fine). */
export function applySavedTheme(): void {
	try {
		const saved = localStorage.getItem(THEME_KEY);
		if (saved === "light" || saved === "dark")
			document.documentElement.setAttribute("data-theme", saved);
	} catch {
		// no storage: follow the system
	}
}

/** Switches light and dark, and remembers the choice in this browser. */
export function ThemeSwitch() {
	const isDark = () =>
		document.documentElement.getAttribute("data-theme") === "dark" ||
		(!document.documentElement.hasAttribute("data-theme") &&
			matchMedia("(prefers-color-scheme: dark)").matches);
	const [dark, setDark] = useState(isDark);
	return (
		<RailButton
			label={dark ? "Light theme" : "Dark theme"}
			icon={dark ? <Sun /> : <Moon />}
			onClick={() => {
				const next = dark ? "light" : "dark";
				document.documentElement.setAttribute("data-theme", next);
				try {
					localStorage.setItem(THEME_KEY, next);
				} catch {
					// not kept: it still applies now
				}
				setDark(!dark);
			}}
		/>
	);
}

export function SignOut({ onClick }: { onClick: () => void }) {
	return <RailButton label="Sign out" icon={<LogOut />} onClick={onClick} />;
}
