import { z } from "zod";

/**
 * The Dream — what a company exists to achieve. It sits at the root of the org
 * graph and in the `dream:` section of the company file. Carried over from
 * J-Nesys `packages/contracts/src/dream.ts`.
 */
export const DreamConfig = z
	.object({
		/** The vision: the world the company builds toward. Optional — older
		 * company files don't have it, and adding it keeps file format 1. */
		vision: z.string().min(1).optional(),
		/** The objective in plain words ("Run the restaurant the neighbourhood comes back to"). */
		objective: z.string().min(1),
		/** Measurable outcomes. */
		outcomes: z.array(z.string()).default([]),
		kpis: z
			.array(
				z
					.object({
						name: z.string().min(1),
						target: z.string(),
						unit: z.string().default(""),
					})
					.strict(),
			)
			.default([]),
		/** Rules the company never breaks (budget, law, safety, what agents may not do). */
		constraints: z.array(z.string()).default([]),
		timeline: z
			.array(
				z.object({ milestone: z.string().min(1), by: z.string() }).strict(),
			)
			.default([]),
		requiredCapabilities: z.array(z.string()).default([]),
		/** Every one of these should be a responsibility with an owner. */
		requiredResponsibilities: z.array(z.string()).default([]),
	})
	.strict();
export type DreamConfig = z.infer<typeof DreamConfig>;
