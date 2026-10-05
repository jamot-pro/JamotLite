import type {
	ButtonHTMLAttributes,
	FormEvent,
	InputHTMLAttributes,
	ReactNode,
	SelectHTMLAttributes,
} from "react";

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
	/** The form is the card (the sign-in box). */
	card?: boolean;
	onSubmit: (e: FormEvent<HTMLFormElement>) => void | Promise<void>;
}) {
	return (
		<form
			className={card ? "card login" : layout}
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

export function Chat({ children }: Children) {
	return <div className="chat">{children}</div>;
}
export function Bubble({
	direction,
	meta,
	children,
}: Children & { direction: "in" | "out"; meta: ReactNode }) {
	return (
		<div className={cx("bubble", direction)}>
			<div>{children}</div>
			<div className="muted small">{meta}</div>
		</div>
	);
}

/* ── The console's frame ────────────────────────────────────────────────── */

export function Shell({ nav, children }: Children & { nav: ReactNode }) {
	return (
		<div className="shell">
			<nav className="nav">{nav}</nav>
			<main className="page">{children}</main>
		</div>
	);
}
export function Brand({ children }: Children) {
	return <div className="brand">{children}</div>;
}
export function NavLink({
	to,
	active,
	go,
	children,
}: Children & { to: string; active: boolean; go: (path: string) => void }) {
	return (
		<a
			href={to}
			className={active ? "active" : ""}
			onClick={(e) => {
				e.preventDefault();
				go(to);
			}}
		>
			{children}
		</a>
	);
}
export function SignOut({ onClick }: { onClick: () => void }) {
	return (
		<button type="button" className="link signout" onClick={onClick}>
			Sign out
		</button>
	);
}
