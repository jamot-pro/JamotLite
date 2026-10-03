import {
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { ModelAccess } from "./types.js";

/**
 * The demo model (BLUEPRINT S6): what `jamot demo` runs on, so anyone can talk
 * to a company with no keys and no network. It answers from the company's own
 * words — its name, summary and vision — with scripted replies that always
 * say they're a demo. It costs nothing.
 *
 * It only runs a demo company: a runtime with it won't start Telegram at
 * all, the console can't select it (RUNTIME D41), and a reply is refused
 * too if it ever got that far.
 */

export const DEMO_PROVIDER = "demo";

export interface DemoCompany {
	name: string;
	summary: string;
	vision: string | null;
}

export const DEMO_NOTE =
	"(Demo model — scripted. Add a real model in Settings for real answers.)";

/** What the visitor wrote, from the last user turn of the transcript. */
function lastQuestion(ctx: TranscriptContext): string {
	const user = [...ctx.messages].reverse().find((m) => m.role === "user");
	const content = user?.content;
	const textOf =
		typeof content === "string"
			? content
			: Array.isArray(content)
				? content
						.map((c) =>
							"text" in c && typeof c.text === "string" ? c.text : "",
						)
						.join(" ")
				: "";
	// The reply job writes "<name> wrote on <channel>:\n<their message>\n…".
	const lines = textOf.split("\n");
	return (/ wrote on /.test(lines[0] ?? "") ? lines[1] : lines[0]) ?? "";
}

export function demoReply(company: DemoCompany, question: string): string {
	const q = question.toLowerCase();
	let answer: string;
	if (/\b(open|hours?|when|time|today|tonight|tomorrow)\b/.test(q))
		answer = `Running for real, the company would check its calendar and tell you. As a demo, I can only say what we're about: ${company.summary}`;
	else if (/\b(who|what|about|do you|are you)\b/.test(q))
		answer = `We're ${company.name}. ${company.summary}${company.vision ? ` What we're working towards: ${company.vision}` : ""}`;
	else if (/\b(price|cost|how much|book|order|reserve|buy)\b/.test(q))
		answer = `I'd pass that to the right person at ${company.name}, and they'd answer you here. In this demo nobody is on the other end yet.`;
	else
		answer = `Thanks for writing to ${company.name}. I've noted it — every message becomes part of what the company remembers about you.`;
	return `${answer}\n\n${DEMO_NOTE}`;
}

export function demoModel(company: DemoCompany): ModelAccess {
	const faux = fauxProvider({
		provider: DEMO_PROVIDER,
		models: [
			{
				id: "demo",
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			},
		],
	});
	const models = createModels();
	models.setProvider(faux.provider);
	const reply = (ctx: TranscriptContext) =>
		fauxAssistantMessage([fauxText(demoReply(company, lastQuestion(ctx)))]);
	// Enough scripted turns for any demo; each is the same small closure.
	faux.appendResponses(Array.from({ length: 100_000 }, () => reply));
	return {
		label: "demo/demo",
		model: faux.getModel() as ModelAccess["model"],
		streamFn: models.streamSimple.bind(models),
	};
}
