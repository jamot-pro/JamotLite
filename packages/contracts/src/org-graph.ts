import { z } from "zod";

/**
 * The org graph — the shape of a company.
 *
 * A company is a graph of typed nodes and typed edges around its Dream (its
 * mission). Teams, humans, agents, responsibilities, tools and heartbeats all
 * exist to make the Dream achievable. Carried over from J-Nesys
 * `packages/contracts/src/dream.ts`; the company file (M1) serializes this graph.
 */

/** Node kinds. There is no separate "bot" kind: `agent` covers every AI or
 *  software actor, and a robot is an agent with a body. */
export const OrgNodeKind = z.enum([
	"dream",
	"team",
	"human",
	"agent",
	"responsibility",
	"tool",
	"heartbeat",
]);
export type OrgNodeKind = z.infer<typeof OrgNodeKind>;

/** Typed edges between nodes. `responsible_for` and `owns` make a node the
 *  owner of a responsibility; `monitors` points a heartbeat at what it watches. */
export const OrgEdgeRelation = z.enum([
	"requires",
	"owns",
	"member_of",
	"responsible_for",
	"uses",
	"has_access_to",
	"monitors",
	"invokes",
	"depends_on",
]);
export type OrgEdgeRelation = z.infer<typeof OrgEdgeRelation>;
