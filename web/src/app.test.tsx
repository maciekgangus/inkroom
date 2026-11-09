import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "./app";
import type { SocketLike } from "./sync/sync";

const ID = "0123456789abcdef0123456789abcdef";

function fakeSocket(): SocketLike {
	return { send: vi.fn(), close: vi.fn(), onopen: null, onmessage: null, onclose: null };
}

interface Reply {
	status?: number;
	body?: unknown;
}

/** Stubs fetch with a table of "METHOD /path" -> reply (or a function of the request body). */
function mockApi(routes: Record<string, Reply | ((body: unknown) => Reply)>) {
	const calls: { key: string; body: unknown }[] = [];
	const fn = vi.fn(async (path: string, init?: RequestInit) => {
		const key = `${init?.method ?? "GET"} ${path}`;
		const body = init?.body ? JSON.parse(String(init.body)) : undefined;
		calls.push({ key, body });
		const route = routes[key];
		if (!route) return { ok: false, status: 404, json: async () => ({ error: "unmocked" }) };
		const reply = typeof route === "function" ? route(body) : route;
		const status = reply.status ?? 200;
		return { ok: status < 400, status, json: async () => reply.body ?? {} };
	});
	vi.stubGlobal("fetch", fn);
	return { calls, fn, called: (key: string) => calls.filter((c) => c.key === key) };
}

const LOGGED_OUT: Reply = { status: 401, body: { error: "not logged in" } };
const LOGGED_IN: Reply = { body: { email: "ola@example.com" } };

describe("App", () => {
	let root: HTMLElement;

	const mount = async (props: Parameters<typeof App>[0]) => {
		await act(async () => {
			render(<App {...props} />, root);
		});
	};
	const text = () => root.textContent ?? "";
	const waitText = (s: string) => vi.waitFor(() => expect(text()).toContain(s));
	const button = (label: string) =>
		[...root.querySelectorAll("button")].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
	const click = async (label: string) => {
		await act(async () => {
			button(label).click();
		});
	};
	const fill = (name: string, value: string) => {
		(root.querySelector(`input[name="${name}"]`) as HTMLInputElement).value = value;
	};
	const submit = async () => {
		await act(async () => {
			root.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true }));
		});
	};

	beforeEach(() => {
		localStorage.clear();
		sessionStorage.clear();
		root = document.createElement("div");
		document.body.append(root);
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
	});

	afterEach(() => {
		render(null, root);
		root.remove();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	describe("home page, logged out", () => {
		test("registering shows the panel", async () => {
			const api = mockApi({
				"GET /api/me": LOGGED_OUT,
				"POST /api/register": { status: 201, body: { email: "ola@example.com" } },
				"GET /api/boards": { body: { owned: [], visited: [] } },
			});
			await mount({ path: "/" });
			await waitText("Zarejestruj");

			fill("email", "ola@example.com");
			fill("password", "password1");
			await click("Zarejestruj");

			await waitText("ola@example.com");
			expect(api.called("POST /api/register")[0].body).toEqual({ email: "ola@example.com", password: "password1" });
		});

		test("a failed login shows the server's message", async () => {
			mockApi({
				"GET /api/me": LOGGED_OUT,
				"POST /api/login": { status: 401, body: { error: "wrong e-mail or password" } },
			});
			await mount({ path: "/" });
			await waitText("Zaloguj");
			fill("email", "ola@example.com");
			fill("password", "nope");
			await click("Zaloguj");
			await waitText("wrong e-mail or password");
		});
	});

	describe("home page, logged in", () => {
		const boards = {
			owned: [{ id: ID, name: "Matma", updatedAt: "2026-11-09T10:00:00Z" }],
			visited: [{ id: "f".repeat(32), name: "Cudza", updatedAt: "2026-11-08T10:00:00Z" }],
		};

		test("lists my boards and boards I have access to", async () => {
			mockApi({ "GET /api/me": LOGGED_IN, "GET /api/boards": { body: boards } });
			await mount({ path: "/" });
			await waitText("Matma");
			expect(text()).toContain("Moje tablice");
			expect(text()).toContain("Tablice, do których mam dostęp");
			expect(text()).toContain("Cudza");
		});

		test("creates a board with a name and opens it", async () => {
			const api = mockApi({
				"GET /api/me": LOGGED_IN,
				"GET /api/boards": { body: { owned: [], visited: [] } },
				"POST /api/boards": { status: 201, body: { id: ID, name: "Fizyka" } },
			});
			const navigate = vi.fn();
			await mount({ path: "/", navigate });
			await waitText("Nowa tablica");
			fill("name", "Fizyka");
			await click("Utwórz");
			await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(`/b/${ID}`));
			expect(api.called("POST /api/boards")[0].body).toEqual({ name: "Fizyka" });
		});

		test("copies a board's link", async () => {
			mockApi({ "GET /api/me": LOGGED_IN, "GET /api/boards": { body: boards } });
			const writeText = vi.fn().mockResolvedValue(undefined);
			vi.stubGlobal("navigator", { clipboard: { writeText } });
			await mount({ path: "/" });
			await waitText("Matma");
			await click("Kopiuj link");
			expect(writeText).toHaveBeenCalledWith(`${location.origin}/b/${ID}`);
		});

		test("deleting needs a second click to confirm", async () => {
			const api = mockApi({
				"GET /api/me": LOGGED_IN,
				"GET /api/boards": { body: boards },
				[`DELETE /api/boards/${ID}`]: { status: 204 },
			});
			await mount({ path: "/" });
			await waitText("Matma");
			await click("Usuń");
			expect(api.called(`DELETE /api/boards/${ID}`)).toHaveLength(0);
			expect(text()).toContain("Na pewno");
			await click("Na pewno");
			await vi.waitFor(() => expect(text()).not.toContain("Matma"));
			expect(api.called(`DELETE /api/boards/${ID}`)).toHaveLength(1);
		});

		test("renames a board", async () => {
			const api = mockApi({
				"GET /api/me": LOGGED_IN,
				"GET /api/boards": { body: boards },
				[`PATCH /api/boards/${ID}`]: { status: 204 },
			});
			await mount({ path: "/" });
			await waitText("Matma");
			await click("Zmień nazwę");
			fill("rename", "Algebra");
			await submit();
			await waitText("Algebra");
			expect(api.called(`PATCH /api/boards/${ID}`)[0].body).toEqual({ name: "Algebra" });
		});

		test("logging out returns to the login forms", async () => {
			const api = mockApi({
				"GET /api/me": LOGGED_IN,
				"GET /api/boards": { body: boards },
				"POST /api/logout": { status: 204 },
			});
			await mount({ path: "/" });
			await waitText("Matma");
			await click("Wyloguj");
			await waitText("Zaloguj");
			expect(api.called("POST /api/logout")).toHaveLength(1);
		});
	});

	describe("board page", () => {
		test("an unknown board shows a message and never connects", async () => {
			mockApi({ "GET /api/me": LOGGED_OUT, [`GET /api/boards/${ID}`]: { status: 404 } });
			const createSocket = vi.fn(fakeSocket);
			await mount({ path: `/b/${ID}`, createSocket });
			await waitText("Nie ma takiej tablicy");
			expect(createSocket).not.toHaveBeenCalled();
		});

		test("a guest is asked for a name, which is remembered", async () => {
			mockApi({ "GET /api/me": LOGGED_OUT, [`GET /api/boards/${ID}`]: { body: { id: ID, name: "Matma" } } });
			const createSocket = vi.fn(fakeSocket);
			await mount({ path: `/b/${ID}`, createSocket });
			await vi.waitFor(() => expect(root.querySelector('input[name="name"]')).not.toBeNull());
			expect(root.querySelector("canvas")).toBeNull();

			fill("name", "Ola");
			await submit();

			expect(localStorage.getItem("inkroom.name")).toBe("Ola");
			await vi.waitFor(() => expect(root.querySelector("canvas")).not.toBeNull());
			expect(createSocket).toHaveBeenCalledOnce();
		});

		test("a remembered guest name skips the prompt", async () => {
			localStorage.setItem("inkroom.name", "Ola");
			mockApi({ "GET /api/me": LOGGED_OUT, [`GET /api/boards/${ID}`]: { body: { id: ID, name: "Matma" } } });
			const createSocket = vi.fn(fakeSocket);
			await mount({ path: `/b/${ID}`, createSocket });
			await vi.waitFor(() => expect(root.querySelectorAll("canvas")).toHaveLength(2));
			expect(createSocket).toHaveBeenCalledWith(expect.stringContaining(`/ws/${ID}`));
		});

		test("a logged-in user is not asked for a name", async () => {
			mockApi({ "GET /api/me": LOGGED_IN, [`GET /api/boards/${ID}`]: { body: { id: ID, name: "Matma" } } });
			const createSocket = vi.fn(fakeSocket);
			await mount({ path: `/b/${ID}`, createSocket });
			await vi.waitFor(() => expect(root.querySelectorAll("canvas")).toHaveLength(2));
			expect(root.querySelector('input[name="name"]')).toBeNull();
			expect(createSocket).toHaveBeenCalledOnce();
		});
	});
});
