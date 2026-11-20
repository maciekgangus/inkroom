import type { PreviewData } from "./board/preview";

/** Error from the server API; `status` is the HTTP status. */
class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

/** The message of a failed call, for showing to the user. */
export const errorMessage = (e: unknown) =>
	e instanceof Error ? e.message : "Błąd";

export interface BoardSummary {
	id: string;
	name: string;
	updatedAt: string;
	/** The owner's username; given for other people's boards only (R-051). */
	owner?: string;
	/** What the board's strokes and images take, in bytes (R-091). */
	bytes?: number;
}

export interface BoardList {
	owned: BoardSummary[];
	visited: BoardSummary[];
}

async function request<T>(
	method: string,
	path: string,
	body?: unknown,
): Promise<T> {
	const res = await fetch(path, {
		method,
		// What the server knows now, never a copy kept by the browser (a board list shown again
		// after "back" must not be an old one).
		cache: method === "GET" ? "no-store" : undefined,
		headers:
			body === undefined ? undefined : { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	if (res.status === 204) return undefined as T;
	let data: { error?: string } = {};
	try {
		data = await res.json();
	} catch {
		// Non-JSON error page: fall through to the generic message.
	}
	if (!res.ok)
		throw new ApiError(res.status, data.error ?? `Błąd ${res.status}`);
	return data as T;
}

/** A logged-in account: the e-mail (private to its owner) and the public username (R-053). */
export interface Account {
	email: string;
	username: string;
	/** False for an account that signs in only with Google (R-063, R-085). */
	hasPassword?: boolean;
}

/** The logged-in account, or null when logged out. */
export async function me(): Promise<Account | null> {
	try {
		return await request<Account>("GET", "/api/me");
	} catch (e) {
		if (e instanceof ApiError && e.status === 401) return null;
		throw e;
	}
}

/** What a new account needs; `captcha` is the token of the Turnstile widget (R-054). */
export interface Registration {
	email: string;
	username: string;
	password: string;
	captcha: string;
}

export const register = (r: Registration) =>
	request<Account>("POST", "/api/register", r);

/** `login` is an e-mail or a username (R-055). */
export const login = (login: string, password: string) =>
	request<Account>("POST", "/api/login", { login, password });

/**
 * Public settings of the server: the site key of the registration captcha ("" when closed) and
 * whether signing in with Google is on (R-063), and the release the server runs (R-099).
 */
export const config = () =>
	request<{ turnstileSiteKey: string; google?: boolean; version?: string }>(
		"GET",
		"/api/config",
	);

/** Sets a new password after checking the current one (R-085). */
export const changePassword = (current: string, next: string) =>
	request<void>("POST", "/api/account/password", { current, new: next });

/** Deletes the logged-in account with its boards; `confirm` is its username (R-085). */
export const deleteAccount = (confirm: string) =>
	request<void>("POST", "/api/account/delete", { confirm });

/** The account's own keyboard shortcuts, by tool name (R-086). */
export const getShortcuts = () =>
	request<{ shortcuts: Record<string, string> }>(
		"GET",
		"/api/account/shortcuts",
	);

export const putShortcuts = (shortcuts: Record<string, string>) =>
	request<void>("PUT", "/api/account/shortcuts", { shortcuts });

export const logout = () => request<void>("POST", "/api/logout", {});

export const listBoards = () => request<BoardList>("GET", "/api/boards");

export const createBoard = (name: string) =>
	request<{ id: string; name: string }>("POST", "/api/boards", { name });

export const renameBoard = (id: string, name: string) =>
	request<void>("PATCH", `/api/boards/${id}`, { name });

export const deleteBoard = (id: string) =>
	request<void>("DELETE", `/api/boards/${id}`);

export const copyBoard = (id: string) =>
	request<{ id: string; name: string }>("POST", `/api/boards/${id}/copy`, {});

/** What a client needs to draw a small picture of a board, and the tag of that version of it. */
export async function boardPreview(
	id: string,
): Promise<{ etag: string; data: PreviewData }> {
	// Not no-store: the server answers "not modified" cheaply and the browser keeps the body.
	const res = await fetch(`/api/boards/${id}/preview`);
	if (!res.ok) throw new ApiError(res.status, `Błąd ${res.status}`);
	return { etag: res.headers.get("ETag") ?? "", data: await res.json() };
}

/** Turns a Blob into a data URL, the form a picture is kept in for a tile. */
const blobToDataUrl = (blob: Blob) =>
	new Promise<string>((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve(String(r.result));
		r.onerror = () => reject(r.error);
		r.readAsDataURL(blob);
	});

/**
 * The picture of a board the server kept for its tile (R-088) with the tag of the version it
 * shows, or null when it has none for the current version (the client then draws it itself).
 */
export async function boardPreviewPicture(
	id: string,
): Promise<{ etag: string; url: string } | null> {
	const res = await fetch(`/api/boards/${id}/preview.png`);
	if (res.status === 404) return null;
	if (!res.ok) throw new ApiError(res.status, `Błąd ${res.status}`);
	return {
		etag: res.headers.get("ETag") ?? "",
		url: await blobToDataUrl(await res.blob()),
	};
}

/** Hands the owner's picture of a board version to the server, so the next tile skips drawing. */
export async function storePreviewPicture(
	id: string,
	tag: string,
	dataUrl: string,
): Promise<void> {
	const body = await (await fetch(dataUrl)).blob();
	const res = await fetch(
		`/api/boards/${id}/preview.png?tag=${encodeURIComponent(tag)}`,
		{ method: "PUT", headers: { "Content-Type": "image/png" }, body },
	);
	if (!res.ok) throw new ApiError(res.status, `Błąd ${res.status}`);
}

/** Takes a board off my list of boards I was invited to; the board itself stays (R-051). */
export const forgetBoard = (id: string) =>
	request<void>("DELETE", `/api/boards/${id}/visit`, {});

export const setBackground = (id: string, background: string) =>
	request<void>("PUT", `/api/boards/${id}/background`, { background });

/**
 * Whether we own the board, or null when the server says it does not exist.
 * Other failures count as an existing board that is not ours.
 */
export async function boardInfo(
	id: string,
): Promise<{ owner: boolean; name: string } | null> {
	try {
		const b = await request<{ owner?: boolean; name?: string }>(
			"GET",
			`/api/boards/${id}`,
		);
		return { owner: b.owner === true, name: b.name ?? "" };
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return null;
		return { owner: false, name: "" };
	}
}

/** Where the user last looked on a board (null when never saved, or when logged out). */
export async function loadView(
	id: string,
): Promise<{ x: number; y: number; scale: number } | null> {
	try {
		const v = await request<
			{ x: number; y: number; scale: number } | undefined
		>("GET", `/api/boards/${id}/view`);
		return v ?? null;
	} catch {
		return null;
	}
}

/** Remembers where the user is looking; it survives the page being closed (`keepalive`). */
export async function saveView(
	id: string,
	view: { x: number; y: number; scale: number },
): Promise<void> {
	try {
		await fetch(`/api/boards/${id}/view`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(view),
			keepalive: true,
		});
	} catch {
		// Not being able to save a position is not worth an error.
	}
}

/** Sends a note from the feedback button (R-062), with where the person was and on what screen. */
export function sendFeedback(note: {
	message: string;
	page: string;
	screen: string;
}): Promise<void> {
	return request("POST", "/api/feedback", note);
}
