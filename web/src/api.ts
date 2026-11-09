/** Error from the server API; `status` is the HTTP status. */
export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

export interface BoardSummary {
	id: string;
	name: string;
	updatedAt: string;
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

/** The logged-in user's e-mail, or null when logged out. */
export async function me(): Promise<string | null> {
	try {
		return (await request<{ email: string }>("GET", "/api/me")).email;
	} catch (e) {
		if (e instanceof ApiError && e.status === 401) return null;
		throw e;
	}
}

export const register = (email: string, password: string) =>
	request<{ email: string }>("POST", "/api/register", { email, password }).then(
		(u) => u.email,
	);

export const login = (email: string, password: string) =>
	request<{ email: string }>("POST", "/api/login", { email, password }).then(
		(u) => u.email,
	);

export const logout = () => request<void>("POST", "/api/logout", {});

export const listBoards = () => request<BoardList>("GET", "/api/boards");

export const createBoard = (name: string) =>
	request<{ id: string; name: string }>("POST", "/api/boards", { name });

export const renameBoard = (id: string, name: string) =>
	request<void>("PATCH", `/api/boards/${id}`, { name });

export const deleteBoard = (id: string) =>
	request<void>("DELETE", `/api/boards/${id}`);

/** False only when the server says the board does not exist; other failures count as "exists". */
export async function boardExists(id: string): Promise<boolean> {
	try {
		await request("GET", `/api/boards/${id}`);
		return true;
	} catch (e) {
		return !(e instanceof ApiError && e.status === 404);
	}
}
