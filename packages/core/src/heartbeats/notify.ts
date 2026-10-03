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
}

/** Settings the channel keeps current and the heartbeats read. */
export const OWNER_LAST_SEEN = "owner.lastSeenAt";
export const SUCCESSION = "succession.active";
