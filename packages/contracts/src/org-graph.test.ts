import { describe, expect, it } from "vitest";
import { OrgEdgeRelation, OrgNodeKind } from "./index.js";

describe("org graph contracts", () => {
	it("knows every node kind a company file may contain", () => {
		expect(OrgNodeKind.options).toEqual([
			"dream",
			"team",
			"human",
			"agent",
			"responsibility",
			"tool",
			"heartbeat",
		]);
	});

	it("refuses kinds and relations that don't exist", () => {
		expect(OrgNodeKind.safeParse("bot").success).toBe(false);
		expect(OrgEdgeRelation.safeParse("reports_to").success).toBe(false);
		expect(OrgEdgeRelation.parse("monitors")).toBe("monitors");
	});
});
