import {
	COMPANY_FILE_FORMAT,
	type CompanyEdge,
	CompanyFile,
	type CompanyNode,
	OrgEdgeRelation,
} from "@jamot/contracts";
import { isMap, parseDocument, stringify } from "yaml";

/**
 * `company.yaml` on disk.
 *
 * Nodes are grouped by kind (`teams:`, `agents:` …) and each item's extra
 * fields are its config, so a person can read and edit it. Edges are written
 * as one line each under `links:` — "founder member_of circle" — in the
 * order from, relation, to.
 */

const SECTIONS = [
	["teams", "team"],
	["humans", "human"],
	["agents", "agent"],
	["responsibilities", "responsibility"],
	["tools", "tool"],
	["heartbeats", "heartbeat"],
] as const;

const TOP_LEVEL = new Set([
	"jamot",
	"company",
	"dream",
	"founder",
	"links",
	...SECTIONS.map(([s]) => s),
]);
/** Config fields that would clash with an item's own fields go under an explicit `config:`. */
const RESERVED = new Set(["key", "name", "config"]);

export type ParseResult =
	| { ok: true; file: CompanyFile }
	| { ok: false; errors: string[] };

export function parseCompanyFile(text: string): ParseResult {
	const doc = parseDocument(text, { prettyErrors: false });
	if (doc.errors.length > 0)
		return { ok: false, errors: doc.errors.map((e) => `yaml: ${e.message}`) };
	if (!isMap(doc.contents))
		return { ok: false, errors: ["the file must be a YAML mapping"] };
	const raw = doc.toJS() as Record<string, unknown>;

	const errors: string[] = [];
	for (const key of Object.keys(raw)) {
		if (!TOP_LEVEL.has(key)) errors.push(`${key}: unknown section`);
	}
	if (raw.jamot !== COMPANY_FILE_FORMAT) {
		errors.push(
			`jamot: expected format ${COMPANY_FILE_FORMAT}, found ${JSON.stringify(raw.jamot)}`,
		);
	}

	// Build the normalized shape, remembering where each node and edge came
	// from so validation errors point at the line a person wrote.
	const nodes: unknown[] = [];
	const nodePaths: string[] = [];
	for (const [section, kind] of SECTIONS) {
		const items = raw[section] ?? [];
		if (!Array.isArray(items)) {
			errors.push(`${section}: must be a list`);
			continue;
		}
		items.forEach((item, i) => {
			const path = `${section}[${i}]`;
			if (typeof item !== "object" || item === null || Array.isArray(item)) {
				errors.push(`${path}: must be a mapping with key and name`);
				return;
			}
			const { key, name, config, ...rest } = item as Record<string, unknown>;
			if (
				config !== undefined &&
				(typeof config !== "object" || config === null || Array.isArray(config))
			) {
				errors.push(`${path}.config: must be a mapping`);
				return;
			}
			nodes.push({
				key,
				kind,
				name,
				config: { ...(config as object | undefined), ...rest },
			});
			nodePaths.push(path);
		});
	}

	const edges: unknown[] = [];
	const edgePaths: string[] = [];
	const links = raw.links ?? [];
	if (!Array.isArray(links)) errors.push("links: must be a list");
	else {
		links.forEach((line, i) => {
			const parts = typeof line === "string" ? line.trim().split(/\s+/) : [];
			if (parts.length !== 3) {
				errors.push(
					`links[${i}]: write it as "from relation to", e.g. "founder member_of circle"`,
				);
				return;
			}
			const [from, relation, to] = parts;
			edges.push({ from, relation, to });
			edgePaths.push(`links[${i}]`);
		});
	}
	if (errors.length > 0) return { ok: false, errors };

	const parsed = CompanyFile.safeParse({
		format: raw.jamot,
		company: raw.company,
		dream: raw.dream,
		founder: raw.founder,
		nodes,
		edges,
	});
	if (!parsed.success) {
		return {
			ok: false,
			errors: parsed.error.issues.map((issue) => {
				const [head, index, ...rest] = issue.path;
				let where = issue.path.join(".");
				if (head === "nodes" && typeof index === "number")
					where = [nodePaths[index], ...rest].join(".");
				if (head === "edges" && typeof index === "number")
					where = edgePaths[index] ?? where;
				if (head === "format") where = "jamot";
				if (head === "edges" && rest[0] === "relation") {
					return `${where}: unknown relation — use one of ${OrgEdgeRelation.options.join(", ")}`;
				}
				return `${where}: ${issue.message}`;
			}),
		};
	}
	return { ok: true, file: parsed.data };
}

export function stringifyCompanyFile(file: CompanyFile): string {
	const doc: Record<string, unknown> = {
		jamot: file.format,
		company: file.company,
		dream: file.dream,
	};
	if (file.founder) doc.founder = file.founder;
	for (const [section, kind] of SECTIONS) {
		const items = file.nodes.filter((n) => n.kind === kind).map(toItem);
		if (items.length > 0) doc[section] = items;
	}
	if (file.edges.length > 0) doc.links = file.edges.map(toLine);
	return stringify(doc, { lineWidth: 0 });
}

function toItem(node: CompanyNode): Record<string, unknown> {
	const clashes = Object.keys(node.config).some((k) => RESERVED.has(k));
	if (clashes) return { key: node.key, name: node.name, config: node.config };
	return { key: node.key, name: node.name, ...node.config };
}

function toLine(edge: CompanyEdge): string {
	return `${edge.from} ${edge.relation} ${edge.to}`;
}
