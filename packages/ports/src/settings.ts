/** Company settings as JSON values by key: the model choice, the Telegram bot's
 *  username, survival thresholds. Never secrets — those go to the secret store. */
export interface SettingsStore {
	get<T = unknown>(key: string): Promise<T | null>;
	set(key: string, value: unknown): Promise<void>;
	delete(key: string): Promise<boolean>;
}
