import { z } from "zod";
import { DreamConfig } from "./dream.js";
import { OrgEdgeRelation, OrgNodeKind } from "./org-graph.js";

/**
 * The company file (`company.yaml`) — a company's structure, as data.
 *
 * This is the normalized, in-memory shape. The YAML on disk groups nodes by
 * kind and writes links as "from relation to" lines so people can read and
 * fork it; `@jamot/company-file` converts between the two.
 *
 * Versioning: `format` changes only on a breaking change, with a migration.
 * Adding an optional field keeps the same format.
 */
export const COMPANY_FILE_FORMAT = 1;

/** A node key: lowercase letters, digits and dashes. "dream" is reserved for the Dream node. */
export const NodeKey = z
	.string()
	.regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes")
	.refine((k) => k !== "dream", "'dream' is reserved for the Dream itself");

function isTimeZone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat("en", { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

export const CompanyInfo = z
	.object({
		/** Stable id of the company or template, e.g. "bali-cafe". */
		id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
		name: z.string().min(1),
		/** One line for the template picker. */
		summary: z.string().default(""),
		/** IANA time zone the heartbeats run in. */
		timezone: z
			.string()
			.refine(isTimeZone, "not a known IANA time zone")
			.default("UTC"),
	})
	.strict();
export type CompanyInfo = z.infer<typeof CompanyInfo>;

export const CompanyNode = z
	.object({
		key: NodeKey,
		kind: OrgNodeKind.exclude(["dream"]),
		name: z.string().min(1),
		config: z.record(z.string(), z.unknown()).default({}),
	})
	.strict();
export type CompanyNode = z.infer<typeof CompanyNode>;

/** An edge. `from` / `to` are node keys, or "dream" for the Dream node. */
export const CompanyEdge = z
	.object({
		from: z.string().min(1),
		to: z.string().min(1),
		relation: OrgEdgeRelation,
	})
	.strict();
export type CompanyEdge = z.infer<typeof CompanyEdge>;

export const CompanyFile = z
	.object({
		format: z.literal(COMPANY_FILE_FORMAT),
		company: CompanyInfo,
		dream: DreamConfig,
		/** The human node the person who starts the company becomes. */
		founder: NodeKey.optional(),
		nodes: z.array(CompanyNode),
		edges: z.array(CompanyEdge),
	})
	.strict()
	.superRefine((file, ctx) => {
		const keys = new Set<string>();
		file.nodes.forEach((n, i) => {
			if (keys.has(n.key))
				ctx.addIssue({
					code: "custom",
					path: ["nodes", i, "key"],
					message: `duplicate key '${n.key}'`,
				});
			keys.add(n.key);
		});
		file.edges.forEach((e, i) => {
			for (const end of ["from", "to"] as const) {
				if (e[end] !== "dream" && !keys.has(e[end])) {
					ctx.addIssue({
						code: "custom",
						path: ["edges", i, end],
						message: `unknown node '${e[end]}'`,
					});
				}
			}
		});
		if (
			file.founder &&
			file.nodes.find((n) => n.key === file.founder)?.kind !== "human"
		) {
			ctx.addIssue({
				code: "custom",
				path: ["founder"],
				message: "founder must be the key of a human node",
			});
		}
	});
export type CompanyFile = z.infer<typeof CompanyFile>;
