import type { SetupQuestion } from "@jamot/contracts";

/**
 * The setup interview (VISION.md, RUNTIME D55): as few questions as give
 * Jamot what it needs to set the company up. Each one fills part of the
 * company — the charter, the people, what agents take first — and "I don't
 * know yet" is always an answer. The same questions, in the same order, on
 * the web and on Telegram.
 */
export const QUESTIONS: SetupQuestion[] = [
	{
		id: "name",
		title: "What's it called?",
		hint: "A working name is fine; you can change it later.",
		kind: "short",
		required: true,
		placeholder: "Sunrise Bakery",
	},
	{
		id: "founder",
		title: "And what's your name?",
		hint: "The company knows you as its founder.",
		kind: "short",
		required: true,
		placeholder: "Andrea",
	},
	{
		id: "what",
		title: "What does your business do, and for whom?",
		hint: "New or already running: a sentence or two.",
		kind: "text",
		required: true,
		placeholder:
			"Fresh bread every morning for the families of our neighbourhood, ordered on Telegram the night before.",
	},
	{
		id: "why",
		title: "Why does it matter to you? What's different if it works?",
		hint: "The world you're building toward: the company's vision.",
		kind: "text",
		required: false,
		placeholder:
			"Nobody in the neighbourhood eats factory bread, and the baker earns a fair living.",
	},
	{
		id: "goals",
		title: "What would make the next three months a success?",
		hint: "One goal per line. Numbers help.",
		kind: "lines",
		required: false,
		placeholder: "100 regular customers\nOrders open every day by 8 pm",
	},
	{
		id: "never",
		title: "What will the company never do, whatever happens?",
		hint: "One rule per line. Agents follow these too.",
		kind: "lines",
		required: false,
		placeholder:
			"Never sell yesterday's bread as fresh\nNever share a customer's details",
	},
	{
		id: "people",
		title: "Who's with you already, and who do you wish you had?",
		hint: "Names and what they do, and the roles nobody has yet.",
		kind: "text",
		required: false,
		placeholder:
			"Rio bakes with me at night. I need someone for deliveries and someone for the books.",
	},
	{
		id: "delegate",
		title: "What do you not want to do yourself?",
		hint: "Agents take these first; people get what agents can't do.",
		kind: "text",
		required: false,
		placeholder: "Answering orders, reminding people, keeping the accounts.",
	},
	{
		id: "successor",
		title: "Who should take over if you go quiet?",
		hint: "So the company outlives a bad month. Their name is enough for now.",
		kind: "short",
		required: false,
		placeholder: "Rio",
	},
];

/** The longest answer kept. */
export const ANSWER_LIMIT = 2000;

/** A "lines" answer as a list. */
export const lines = (answer: string | undefined): string[] =>
	(answer ?? "")
		.split("\n")
		.map((l) => l.replace(/^[-•*\s]+/, "").trim())
		.filter(Boolean);
