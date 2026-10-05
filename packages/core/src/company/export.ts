import {
	COMPANY_FILE_FORMAT,
	CompanyFile,
	DreamConfig,
} from "@jamot/contracts";
import type { GraphStore } from "@jamot/ports";
import { isRetired } from "./retired.js";

/**
 * Reads a running company back into a company file: its structure as it is
 * now. Only current edges are exported; the history of who owned what stays
 * in the database.
 */
export async function exportCompanyFile(
	store: GraphStore,
): Promise<CompanyFile> {
	const company = await store.getCompany();
	if (!company) throw new Error("this database holds no company yet");

	const all = await store.listNodes();
	const dream = all.find((n) => n.kind === "dream");
	if (!dream)
		throw new Error("the company has no charter (its dream node is missing)");
	const keys = new Map(all.map((n) => [n.id, n.key]));

	const edges = (await store.listEdges()).map((e) => ({
		from: keys.get(e.fromNodeId) ?? e.fromNodeId,
		to: keys.get(e.toNodeId) ?? e.toNodeId,
		relation: e.relation,
	}));

	return CompanyFile.parse({
		format: COMPANY_FILE_FORMAT,
		company: {
			id: company.id,
			name: company.name,
			summary: company.summary,
			timezone: company.timezone,
		},
		dream: DreamConfig.parse(dream.config),
		...(company.founderKey ? { founder: company.founderKey } : {}),
		nodes: all
			.filter((n) => n.kind !== "dream" && !isRetired(n))
			.map((n) => ({
				key: n.key,
				kind: n.kind,
				name: n.name,
				config: n.config,
			})),
		edges,
	});
}
