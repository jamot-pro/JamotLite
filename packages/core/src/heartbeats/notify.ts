/**
 * How the runtime reaches people outside a conversation — the owner, and the
 * successor when the owner has gone silent. Telegram implements it; core only
 * knows this interface.
 */
export interface OwnerAction {
	label: string;
	/** Sent back when pressed, e.g. "assign:r-chef:founder". At most 64 bytes (Telegram's limit). */
	action: string;
}

export interface Notifier {
	/** Returns false when there is nobody to deliver to (no owner paired yet). */
	toOwner(message: { text: string; actions?: OwnerAction[] }): Promise<boolean>;
	toSuccessor(message: {
		text: string;
		actions?: OwnerAction[];
	}): Promise<boolean>;
	/**
	 * Tells people of the company map who linked their Telegram (D48) — a
	 * team's stewards about their team's heartbeat. No buttons: deciding stays
	 * with the owner. Returns how many it reached.
	 */
	toMembers?(nodeKeys: string[], message: { text: string }): Promise<number>;
	/**
	 * Posts to the company's group — the stewards' group (D49) — when it has
	 * one. No buttons. Returns false when there's no group.
	 */
	toGroup?(message: { text: string }): Promise<boolean>;
	/**
	 * Asks one person of the map something only they can answer, with buttons
	 * only they can press — a check-in when they've gone quiet (D53). Returns
	 * false when they aren't linked on Telegram.
	 */
	toMember?(
		nodeKey: string,
		message: { text: string; actions?: OwnerAction[] },
	): Promise<boolean>;
}

/** Settings the channel keeps current and the heartbeats read. */
export const OWNER_LAST_SEEN = "owner.lastSeenAt";
export const SUCCESSION = "succession.active";
