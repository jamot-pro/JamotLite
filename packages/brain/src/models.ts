import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
	type Api,
	createModels,
	createProvider,
	type Model,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { ModelAccess } from "./types.js";

export type ModelProvider = "anthropic" | "openai" | "openrouter" | "ollama";

export interface ModelChoice {
	provider: ModelProvider;
	/** The provider's model id, e.g. "claude-sonnet-5", or "llama3" for Ollama. */
	modelId: string;
	/** From the secret store; never logged or stored in settings. Ignored by Ollama. */
	apiKey?: string;
	/** Where to send requests: Ollama's address (default http://127.0.0.1:11434/v1),
	 *  or a proxy / gateway in front of a hosted provider. */
	baseUrl?: string;
}

/**
 * Connects to a model through pi-ai. Prices come from pi's catalog, so every
 * run gets a cost; local Ollama models cost nothing.
 */
export function connectModel(choice: ModelChoice): ModelAccess {
	const models = createModels();
	let model: Model<Api> | undefined;

	if (choice.provider === "ollama") {
		const baseUrl = choice.baseUrl ?? "http://127.0.0.1:11434/v1";
		models.setProvider(
			createProvider({
				id: "ollama",
				name: "Ollama",
				baseUrl,
				// Ollama needs no key, but pi requires one to be present (O1 spike, item 9).
				auth: {
					apiKey: {
						name: "Ollama",
						resolve: async () => ({ auth: { apiKey: "ollama" } }),
					},
				},
				models: [
					{
						id: choice.modelId,
						name: choice.modelId,
						api: "openai-completions",
						provider: "ollama",
						baseUrl,
						reasoning: false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 32_768,
						maxTokens: 4096,
					},
				],
				api: openAICompletionsApi(),
			}),
		);
	} else {
		const provider = {
			anthropic: anthropicProvider,
			openai: openaiProvider,
			openrouter: openrouterProvider,
		}[choice.provider];
		models.setProvider(provider());
	}
	model = models.getModel(choice.provider, choice.modelId);
	if (!model)
		throw new Error(`${choice.provider} has no model "${choice.modelId}"`);
	if (choice.baseUrl && choice.provider !== "ollama")
		model = { ...model, baseUrl: choice.baseUrl };

	const apiKey = choice.apiKey;
	const streamFn: StreamFn = (m, context, options) =>
		models.streamSimple(
			m,
			context,
			apiKey && choice.provider !== "ollama" ? { ...options, apiKey } : options,
		);
	return {
		label: `${choice.provider}/${choice.modelId}`,
		model: model as Model<never>,
		streamFn,
	};
}

/**
 * One question, one answer, outside an agent run — for the setup's draft of
 * a new company (RUNTIME D56). Returns the model's text.
 */
export async function complete(
	access: ModelAccess,
	input: { system: string; prompt: string },
): Promise<string> {
	// streamSimple takes a plain context and normalizes it itself.
	const context = {
		systemPrompt: input.system,
		messages: [{ role: "user", content: input.prompt, timestamp: Date.now() }],
	} as unknown as Parameters<StreamFn>[1];
	const stream = await access.streamFn(access.model, context, {});
	const reply = await stream.result();
	return reply.content.map((c) => (c.type === "text" ? c.text : "")).join("");
}
