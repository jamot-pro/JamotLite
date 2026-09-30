/**
 * People — everyone the company talks to or works with: customers, staff,
 * suppliers, supporters. One person, many identities (a Telegram account, an
 * email, a phone). Every conversation resolves to a person first (AGENTS.md
 * rule 2).
 */

export interface Person {
	id: string;
	displayName: string;
	email: string | null;
	phone: string | null;
	/** What the person agreed to, e.g. { marketing: false, photos: true }. */
	consent: Record<string, unknown>;
	profile: Record<string, unknown>;
	/** A short summary of what the company knows about them, kept up to date by an agent. */
	contextSummary: string | null;
	lastInteractionAt: string | null;
	createdAt: string;
	updatedAt: string;
}

/** "telegram" (user id), "email" or "phone"; other channels add their own. */
export type IdentityProvider = "telegram" | "email" | "phone" | (string & {});

export interface Identity {
	id: string;
	personId: string;
	provider: IdentityProvider;
	/** Normalized: emails lower-cased, phones as +digits. */
	value: string;
	verified: boolean;
	confidence: number;
	/** How we learned it: seen on a channel, told by the person, or imported. */
	source: "observed" | "stated" | "imported";
	createdAt: string;
}

export interface NewPerson {
	displayName: string;
	email?: string | null;
	phone?: string | null;
	consent?: Record<string, unknown>;
	profile?: Record<string, unknown>;
}

export type PersonPatch = Partial<
	Pick<
		Person,
		| "displayName"
		| "email"
		| "phone"
		| "consent"
		| "profile"
		| "contextSummary"
		| "lastInteractionAt"
	>
>;

export interface NewIdentity {
	provider: IdentityProvider;
	value: string;
	verified?: boolean;
	confidence?: number;
	source?: Identity["source"];
}

export interface PeopleStore {
	create(input: NewPerson): Promise<Person>;
	get(id: string): Promise<Person | null>;
	/** Most recently active first. `search` matches name, email or phone. */
	list(opts?: { search?: string; limit?: number }): Promise<Person[]>;
	update(id: string, patch: PersonPatch): Promise<Person | null>;
	/** Removes the person and their identities. Their messages and memories stay, unlinked. */
	delete(id: string): Promise<boolean>;
	findByIdentity(
		provider: IdentityProvider,
		value: string,
	): Promise<Person | null>;
	/** Links an identity. Returns the existing one if already linked to this person;
	 *  throws if it belongs to someone else (merge them instead). */
	addIdentity(personId: string, identity: NewIdentity): Promise<Identity>;
	listIdentities(personId: string): Promise<Identity[]>;
	removeIdentity(identityId: string): Promise<boolean>;
	/** Folds `dropId` into `keepId`: identities, conversations, messages and
	 *  memories move over, empty fields are filled in, and `dropId` is deleted. */
	merge(keepId: string, dropId: string): Promise<Person>;
}
