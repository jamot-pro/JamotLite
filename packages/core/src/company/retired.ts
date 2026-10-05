import type { StoredNode } from "@jamot/ports";

/**
 * A retired agent stays in the map as history — its runs, its name in old
 * conversations — but nothing picks it any more: it answers no channel, owns
 * nothing, can't be connected to, and isn't exported (RUNTIME D47).
 */
export const isRetired = (node: Pick<StoredNode, "config">): boolean =>
	typeof node.config.retiredAt === "string";
