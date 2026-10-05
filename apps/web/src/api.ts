/** The runtime's JSON API. Every call sends the session cookie; a 401 means "sign in". */
export class SignedOut extends Error {}

export async function api<T>(
	path: string,
	init: { method?: string; body?: unknown } = {},
): Promise<T> {
	const res = await fetch(`/api${path}`, {
		method: init.method ?? "GET",
		credentials: "same-origin",
		headers:
			init.body !== undefined ? { "content-type": "application/json" } : {},
		...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
	});
	if (res.status === 401 && path !== "/login") throw new SignedOut();
	const type = res.headers.get("content-type") ?? "";
	const data = type.includes("json") ? await res.json() : await res.text();
	if (!res.ok)
		throw new Error(
			(data as { error?: string }).error ?? `request failed (${res.status})`,
		);
	return data as T;
}

// The shapes the API returns live in @jamot/contracts, shared with the
// runtime: pages import them from there, never declare their own.

export const usd = (micro: number) =>
	`$${(micro / 1_000_000).toFixed(micro < 10_000 ? 4 : 2)}`;
export const when = (iso: string | null) =>
	iso ? new Date(iso).toLocaleString() : "—";
