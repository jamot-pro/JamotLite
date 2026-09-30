import {
	createModels,
	type fauxAssistantMessage,
	fauxProvider,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { ModelAccess } from "./types.js";

export {
	fauxAssistantMessage,
	fauxText,
	fauxToolCall,
} from "@earendil-works/pi-ai";

export type FakeReply = (
	ctx: TranscriptContext,
) => ReturnType<typeof fauxAssistantMessage>;

/** A model for tests: `reply` reads the transcript and decides what to answer.
 *  Priced like a real model, so usage and cost are exercised too. */
export function fakeModel(
	reply: FakeReply,
	opts: { tokensPerSecond?: number } = {},
): ModelAccess & { calls: () => number } {
	const faux = fauxProvider({
		provider: "faux",
		...(opts.tokensPerSecond ? { tokensPerSecond: opts.tokensPerSecond } : {}),
		models: [
			{
				id: "fake-1",
				cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
			},
		],
	});
	const models = createModels();
	models.setProvider(faux.provider);
	faux.appendResponses(
		Array.from({ length: 1000 }, () => (ctx: TranscriptContext) => reply(ctx)),
	);
	return {
		label: "faux/fake-1",
		model: faux.getModel() as ModelAccess["model"],
		streamFn: models.streamSimple.bind(models),
		calls: () => faux.state.callCount,
	};
}
