import { useEffect, useState } from "react";
import {
	Actions,
	Badge,
	Banner,
	Brand,
	Bubble,
	Bullet,
	Bullets,
	Button,
	ButtonLink,
	Card,
	Cell,
	Chat,
	Checkbox,
	ErrorText,
	Field,
	Form,
	Grid,
	Input,
	Item,
	Label,
	List,
	Loading,
	Muted,
	NavLink,
	Notice,
	Page,
	Pre,
	Row,
	Secret,
	Select,
	Shell,
	SignOut,
	Small,
	Split,
	Table,
	TextArea,
	Tile,
	Tiles,
} from "../ui/index.js";

/**
 * `/dev/ui` (development only): every component in each of its states —
 * empty, long text, warning, error, disabled — in light and dark. This is
 * the page to look at when building or restyling the console: if it looks
 * right here, it looks right everywhere (apps/web/DESIGN.md).
 */

const LONG =
	"A very long name that a real company will certainly have one day, written without any thought for the width of the screen it lands on";

export function Gallery() {
	const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
	useEffect(() => {
		if (theme === "system")
			document.documentElement.removeAttribute("data-theme");
		else document.documentElement.setAttribute("data-theme", theme);
	}, [theme]);
	const noop = () => {};

	return (
		<Shell
			nav={
				<>
					<Brand>💓 Jamot</Brand>
					<NavLink to="/dev/ui" active go={noop}>
						Components
					</NavLink>
					<NavLink to="/dev/ui" active={false} go={noop}>
						Another page
					</NavLink>
					<SignOut onClick={noop} />
				</>
			}
		>
			<Page
				title="Components"
				subtitle="Every building block of the console, in each state. Pages are made only of these."
				actions={
					<Select
						aria-label="Theme"
						value={theme}
						onChange={(e) => setTheme(e.target.value as typeof theme)}
					>
						<option value="system">System theme</option>
						<option value="light">Light</option>
						<option value="dark">Dark</option>
					</Select>
				}
			>
				<Banner>
					A banner: this is a demo company, and nothing reaches real people.
				</Banner>
				<Notice>
					A notice: what an action just did. "Lucia now owns Bar."
				</Notice>

				<Tiles>
					<Tile label="Plain" value="72%" hint="a line of context" />
					<Tile
						label="Clickable"
						value={3}
						hint="opens a page"
						onClick={noop}
					/>
					<Tile
						label="Warning"
						value="Low on money"
						tone="warn"
						hint="12 days"
					/>
					<Tile label="Bad" value="Critical" tone="bad" hint="3 days" />
					<Tile label="No hint" value="$0.0042" />
				</Tiles>

				<Grid>
					<Card title="A card">
						<Muted block>Muted text, as a paragraph.</Muted>
						<p>
							Normal text with <strong>strong</strong>, <em>emphasis</em> and{" "}
							<code>code</code>. <Muted small>Small muted.</Muted>{" "}
							<Small>Small.</Small>
						</p>
						<Label>A label inside a card</Label>
						<Bullets>
							<Bullet>A bullet</Bullet>
							<Bullet>{LONG}</Bullet>
							<Bullet muted>A muted bullet (None)</Bullet>
						</Bullets>
					</Card>
					<Card tone="warn" title="A card that needs attention">
						<ErrorText small>An error, small: nobody yet.</ErrorText>
						<ErrorText>An error: that password is wrong.</ErrorText>
					</Card>
					<Card muted>A muted card: nothing is waiting for you.</Card>
					<Card as="article" title={LONG}>
						<Muted block>A card with a very long title.</Muted>
					</Card>
				</Grid>

				<Card title="Badges">
					<Actions>
						<Badge>neutral</Badge>
						<Badge tone="ok">done</Badge>
						<Badge tone="bad">error</Badge>
						<Badge small>MCP</Badge>
						<Badge tone="ok">JAMOT — fully covered</Badge>
					</Actions>
				</Card>

				<Card title="Buttons">
					<Actions>
						<Button>Primary</Button>
						<Button variant="secondary">Secondary</Button>
						<Button size="small">Small</Button>
						<Button variant="secondary" size="small">
							Small secondary
						</Button>
						<Button disabled>Disabled</Button>
						<Button variant="link">A link button</Button>
						<ButtonLink href="#" variant="secondary">
							A link that looks like a button
						</ButtonLink>
					</Actions>
				</Card>

				<Card title="Lists">
					<List>
						<Item>
							<span>
								Nobody owns <strong>Bar</strong>
							</span>
							<Button size="small">I'll take it</Button>
						</Item>
						<Item>
							<span>{LONG}</span>
							<Muted small>since yesterday</Muted>
						</Item>
						<Item>
							<span>A row with a select</span>
							<Select defaultValue="">
								<option value="" disabled>
									Give it to…
								</option>
								<option>Lucia (human)</option>
							</Select>
						</Item>
					</List>
					<Label>Selectable</Label>
					<List selectable>
						<Item selected>
							<Button variant="link">Selected person</Button>
							<Muted small>today</Muted>
						</Item>
						<Item>
							<Button variant="link">Another person</Button>
							<Muted small>last week</Muted>
						</Item>
					</List>
				</Card>

				<Card title="A table">
					<Table
						columns={[
							{ label: "When" },
							{ label: "Agent" },
							{ label: "Status" },
							{ label: "What happened" },
							{ label: "Cost", numeric: true },
						]}
					>
						<Row>
							<Cell small>5 Oct, 10:02</Cell>
							<Cell>host</Cell>
							<Cell>
								<Badge tone="ok">done</Badge>
							</Cell>
							<Cell small>Replied to Mrs. Rossi about the booking.</Cell>
							<Cell numeric>$0.0042</Cell>
						</Row>
						<Row>
							<Cell small>5 Oct, 09:40</Cell>
							<Cell>keeper</Cell>
							<Cell>
								<Badge tone="bad">error</Badge>
							</Cell>
							<Cell small>{LONG}</Cell>
							<Cell numeric>$0.00</Cell>
						</Row>
					</Table>
				</Card>

				<Split>
					<Card title="Forms">
						<Form onSubmit={noop}>
							<Field label="A field">
								<Input placeholder="A placeholder" />
							</Field>
							<Field label="With a hint" hint="(one is stored — leave empty)">
								<Input type="password" />
							</Field>
							<Field label="A select">
								<Select defaultValue="a">
									<option value="a">Anthropic</option>
								</Select>
							</Field>
							<Field label="Several lines" hint="(at most 8000 characters)">
								<TextArea defaultValue={LONG} rows={3} />
							</Field>
							<Checkbox label="A checkbox" checked onChange={noop} />
							<Checkbox
								label="With a line under it"
								hint="Every action waits for your approval."
								checked={false}
								onChange={noop}
							/>
							<Checkbox
								label="Disabled: given through a team"
								checked
								disabled
							/>
							<Button type="submit">Save</Button>
						</Form>
						<Form layout="row" onSubmit={noop}>
							<Input placeholder="On one line" />
							<Button type="submit">Remember</Button>
						</Form>
						<Input search placeholder="The search box in a header" />
					</Card>
					<Card title="Text blocks">
						<Pre>
							{JSON.stringify({ to: "Mrs. Rossi", text: LONG }, null, 2)}
						</Pre>
						<p>
							A secret, shown once: <Secret>jmt_3f9a…_kQ2x9VbLr8Tz</Secret>
						</p>
						<Loading />
						<Chat>
							<Bubble direction="in" meta="Mrs. Rossi · 10:01">
								Do you have a table for four tonight?
							</Bubble>
							<Bubble direction="out" meta="host · 10:02">
								We do — 8pm, under Rossi. See you then!
							</Bubble>
							<Bubble direction="out" meta="host · 10:03 · not delivered">
								{LONG}
							</Bubble>
						</Chat>
					</Card>
				</Split>
			</Page>
		</Shell>
	);
}
