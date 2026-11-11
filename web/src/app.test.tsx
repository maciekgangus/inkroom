import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "./app";
import type { SocketLike } from "./sync/sync";

const ID = "0123456789abcdef0123456789abcdef";

function fakeSocket(): SocketLike {
	return {
		send: vi.fn(),
		close: vi.fn(),
		onopen: null,
		onmessage: null,
		onclose: null,
	};
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
		if (!route)
			return {
				ok: false,
				status: 404,
				json: async () => ({ error: "unmocked" }),
			};
		const reply = typeof route === "function" ? route(body) : route;
		const status = reply.status ?? 200;
		return { ok: status < 400, status, json: async () => reply.body ?? {} };
	});
	vi.stubGlobal("fetch", fn);
	return {
		calls,
		fn,
		called: (key: string) => calls.filter((c) => c.key === key),
	};
}

const LOGGED_OUT: Reply = { status: 401, body: { error: "not logged in" } };
const LOGGED_IN: Reply = {
	body: { email: "ola@example.com", username: "ola.k" },
};

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
		[...root.querySelectorAll("button")].find((b) =>
			b.textContent?.includes(label),
		) as HTMLButtonElement;
	const click = async (label: string) => {
		await act(async () => {
			button(label).click();
		});
	};
	const fill = (name: string, value: string) => {
		(root.querySelector(`input[name="${name}"]`) as HTMLInputElement).value =
			value;
	};
	/** Submits the form that contains the named input. */
	const submit = async (field: string) => {
		await act(async () => {
			const input = root.querySelector(
				`input[name="${field}"]`,
			) as HTMLInputElement;
			input.form?.dispatchEvent(new Event("submit", { cancelable: true }));
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
		test("logging in with a username shows the panel with that name", async () => {
			const api = mockApi({
				"GET /api/me": LOGGED_OUT,
				"POST /api/login": {
					body: { email: "ola@example.com", username: "ola.k" },
				},
				"GET /api/boards": { body: { owned: [], visited: [] } },
			});
			await mount({ path: "/" });
			await waitText("Zaloguj");
			fill("login", "Ola.K");
			fill("password", "password1");
			await click("Zaloguj");
			await waitText("ola.k");
			expect(api.called("POST /api/login")[0].body).toEqual({
				login: "Ola.K",
				password: "password1",
			});
			expect(text()).not.toContain("ola@example.com"); // the e-mail is not shown
		});

		test("a failed login shows the server's message", async () => {
			mockApi({
				"GET /api/me": LOGGED_OUT,
				"POST /api/login": {
					status: 401,
					body: { error: "wrong login or password" },
				},
			});
			await mount({ path: "/" });
			await waitText("Zaloguj");
			fill("login", "ola");
			fill("password", "nope");
			await click("Zaloguj");
			await waitText("wrong login or password");
		});

		test("registering is not on this page: a link leads to /register", async () => {
			mockApi({ "GET /api/me": LOGGED_OUT });
			const navigate = vi.fn();
			await mount({ path: "/", navigate });
			await waitText("Zaloguj");
			expect(button("Zarejestruj")).toBeUndefined();
			await click("Załóż konto");
			expect(navigate).toHaveBeenCalledWith("/register");
		});
	});

	describe("register page (R-054)", () => {
		/** A stand-in for Cloudflare's widget: `solve` plays the person solving it. */
		const widget = () => {
			let callback: ((token: string) => void) | undefined;
			const turnstile = {
				render: vi.fn(
					(_el: HTMLElement, o: { callback: (t: string) => void }) => {
						callback = o.callback;
						return "w1";
					},
				),
				reset: vi.fn(),
				remove: vi.fn(),
			};
			vi.stubGlobal("turnstile", turnstile);
			return {
				turnstile,
				solve: () => act(async () => callback?.("tok-123")),
			};
		};
		const open = async (navigate = vi.fn()) => {
			const api = mockApi({
				"GET /api/me": LOGGED_OUT,
				"GET /api/config": { body: { turnstileSiteKey: "site-key" } },
				"POST /api/register": {
					status: 201,
					body: { email: "ola@example.com", username: "ola.k" },
				},
			});
			const w = widget();
			await mount({ path: "/register", navigate });
			await vi.waitFor(() => expect(w.turnstile.render).toHaveBeenCalled());
			return { api, navigate, ...w };
		};
		const fillAll = () => {
			fill("email", "ola@example.com");
			fill("username", "ola.k");
			fill("password", "password1");
		};

		test("renders the widget with the site key the server gave", async () => {
			const { turnstile } = await open();
			expect(turnstile.render.mock.calls[0][1]).toMatchObject({
				sitekey: "site-key",
			});
		});

		test("the form cannot be sent before the captcha is solved", async () => {
			const { api, solve } = await open();
			fillAll();
			expect(button("Załóż konto")?.disabled).toBe(true);
			await submit("email");
			expect(api.called("POST /api/register")).toHaveLength(0);
			await solve();
			expect(button("Załóż konto")?.disabled).toBe(false);
		});

		test("registering sends the name and the captcha token, then goes home", async () => {
			const { api, solve, navigate } = await open();
			fillAll();
			await solve();
			await click("Załóż konto");
			await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
			expect(api.called("POST /api/register")[0].body).toEqual({
				email: "ola@example.com",
				username: "ola.k",
				password: "password1",
				captcha: "tok-123",
			});
		});

		test("a refusal is shown and the widget starts over (a token works once)", async () => {
			const api = mockApi({
				"GET /api/me": LOGGED_OUT,
				"GET /api/config": { body: { turnstileSiteKey: "site-key" } },
				"POST /api/register": {
					status: 409,
					body: { error: "Ta nazwa użytkownika jest zajęta" },
				},
			});
			const w = widget();
			await mount({ path: "/register" });
			await vi.waitFor(() => expect(w.turnstile.render).toHaveBeenCalled());
			fillAll();
			await w.solve();
			await click("Załóż konto");
			await waitText("Ta nazwa użytkownika jest zajęta");
			expect(w.turnstile.reset).toHaveBeenCalled();
			expect(button("Załóż konto")?.disabled).toBe(true); // needs a new token
			expect(api.called("POST /api/register")).toHaveLength(1);
		});

		test("a link leads back to the login page", async () => {
			const { navigate } = await open();
			await click("Mam już konto");
			expect(navigate).toHaveBeenCalledWith("/");
		});

		test("without a site key the page says registration is closed", async () => {
			mockApi({
				"GET /api/me": LOGGED_OUT,
				"GET /api/config": { body: { turnstileSiteKey: "" } },
			});
			await mount({ path: "/register" });
			await waitText("niedostępna");
			expect(button("Załóż konto")).toBeUndefined();
		});
	});

	describe("home page, logged in", () => {
		const boards = {
			owned: [{ id: ID, name: "Matma", updatedAt: "2026-11-09T10:00:00Z" }],
			visited: [
				{
					id: "f".repeat(32),
					name: "Cudza",
					updatedAt: "2026-11-08T10:00:00Z",
				},
			],
		};

		test("lists my boards and boards I have access to", async () => {
			mockApi({
				"GET /api/me": LOGGED_IN,
				"GET /api/boards": { body: boards },
			});
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
			expect(api.called("POST /api/boards")[0].body).toEqual({
				name: "Fizyka",
			});
		});

		test("copies a board's link", async () => {
			mockApi({
				"GET /api/me": LOGGED_IN,
				"GET /api/boards": { body: boards },
			});
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
			await submit("rename");
			await waitText("Algebra");
			expect(api.called(`PATCH /api/boards/${ID}`)[0].body).toEqual({
				name: "Algebra",
			});
		});

		test("copies a board and shows the copy at the top of my boards", async () => {
			const api = mockApi({
				"GET /api/me": LOGGED_IN,
				"GET /api/boards": { body: boards },
				[`POST /api/boards/${ID}/copy`]: {
					status: 201,
					body: { id: "c".repeat(32), name: "Matma (kopia)" },
				},
			});
			await mount({ path: "/" });
			await waitText("Matma");
			await click("Utwórz kopię");
			await waitText("Matma (kopia)");
			expect(api.called(`POST /api/boards/${ID}/copy`)).toHaveLength(1);
			const names = [...root.querySelectorAll(".boards .name")].map(
				(n) => n.textContent,
			);
			expect(names.slice(0, 2)).toEqual(["Matma (kopia)", "Matma"]);
		});

		test("a board that is not mine cannot be copied", async () => {
			mockApi({
				"GET /api/me": LOGGED_IN,
				"GET /api/boards": { body: boards },
			});
			await mount({ path: "/" });
			await waitText("Cudza");
			expect(
				[...root.querySelectorAll("button")].filter((b) =>
					b.textContent?.includes("Utwórz kopię"),
				),
			).toHaveLength(1); // only the one under "Moje tablice"
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
			mockApi({
				"GET /api/me": LOGGED_OUT,
				[`GET /api/boards/${ID}`]: { status: 404 },
			});
			const createSocket = vi.fn(fakeSocket);
			await mount({ path: `/b/${ID}`, createSocket });
			await waitText("Nie ma takiej tablicy");
			expect(createSocket).not.toHaveBeenCalled();
		});

		test("a guest is asked for a name, which is remembered", async () => {
			mockApi({
				"GET /api/me": LOGGED_OUT,
				[`GET /api/boards/${ID}`]: { body: { id: ID, name: "Matma" } },
			});
			const createSocket = vi.fn(fakeSocket);
			await mount({ path: `/b/${ID}`, createSocket });
			await vi.waitFor(() =>
				expect(root.querySelector('input[name="name"]')).not.toBeNull(),
			);
			expect(root.querySelector("canvas")).toBeNull();

			fill("name", "Ola");
			await submit("name");

			expect(localStorage.getItem("inkroom.name")).toBe("Ola");
			await vi.waitFor(() =>
				expect(root.querySelector("canvas")).not.toBeNull(),
			);
			expect(createSocket).toHaveBeenCalledOnce();
		});

		test("a remembered guest name skips the prompt", async () => {
			localStorage.setItem("inkroom.name", "Ola");
			mockApi({
				"GET /api/me": LOGGED_OUT,
				[`GET /api/boards/${ID}`]: { body: { id: ID, name: "Matma" } },
			});
			const createSocket = vi.fn(fakeSocket);
			await mount({ path: `/b/${ID}`, createSocket });
			await vi.waitFor(() =>
				expect(
					root.querySelectorAll('canvas:not([aria-label="board map"])'),
				).toHaveLength(2),
			);
			expect(createSocket).toHaveBeenCalledWith(
				expect.stringContaining(`/ws/${ID}`),
			);
		});

		test("a logged-in user is known by their username, not by their e-mail", async () => {
			mockApi({
				"GET /api/me": LOGGED_IN,
				[`GET /api/boards/${ID}`]: { body: { id: ID, name: "Matma" } },
			});
			const createSocket = vi.fn((_url: string) => fakeSocket());
			await mount({ path: `/b/${ID}`, createSocket });
			await vi.waitFor(() => expect(createSocket).toHaveBeenCalledOnce());
			const url = createSocket.mock.calls[0][0];
			expect(url).toContain("name=ola.k");
			expect(url).not.toContain("example.com");
		});

		test("a logged-in user is not asked for a name", async () => {
			mockApi({
				"GET /api/me": LOGGED_IN,
				[`GET /api/boards/${ID}`]: { body: { id: ID, name: "Matma" } },
			});
			const createSocket = vi.fn(fakeSocket);
			await mount({ path: `/b/${ID}`, createSocket });
			await vi.waitFor(() =>
				expect(
					root.querySelectorAll('canvas:not([aria-label="board map"])'),
				).toHaveLength(2),
			);
			expect(root.querySelector('input[name="name"]')).toBeNull();
			expect(createSocket).toHaveBeenCalledOnce();
		});

		describe("background", () => {
			const open = async (owner: boolean) => {
				const api = mockApi({
					"GET /api/me": LOGGED_IN,
					[`GET /api/boards/${ID}`]: { body: { id: ID, name: "Matma", owner } },
					[`PUT /api/boards/${ID}/background`]: { status: 204 },
				});
				const socket = fakeSocket();
				await mount({ path: `/b/${ID}`, createSocket: () => socket });
				await vi.waitFor(() =>
					expect(
						root.querySelectorAll('canvas:not([aria-label="board map"])'),
					).toHaveLength(2),
				);
				return { api, socket };
			};
			const shown = () =>
				root.querySelector(".board-bg")?.getAttribute("data-background");
			const pick = (name: string) =>
				root.querySelector(
					`[aria-label="background ${name}"]`,
				) as HTMLButtonElement | null;

			test("everyone sees the background the server sends", async () => {
				const { socket } = await open(false);
				expect(shown()).toBe("plain");
				await act(async () => {
					socket.onmessage?.({
						data: JSON.stringify({
							t: "snapshot",
							strokes: [],
							background: "grid",
						}),
					});
				});
				expect(shown()).toBe("grid");
				await act(async () => {
					socket.onmessage?.({
						data: JSON.stringify({ t: "background", value: "lines" }),
					});
				});
				expect(shown()).toBe("lines");
			});

			test("only the owner gets the background buttons", async () => {
				await open(false);
				expect(pick("grid")).toBeNull();
			});

			test("the owner picks a background and it is saved", async () => {
				const { api } = await open(true);
				await act(async () => {
					pick("dots")?.click();
				});
				expect(shown()).toBe("dots");
				expect(pick("dots")?.getAttribute("aria-pressed")).toBe("true");
				expect(api.called(`PUT /api/boards/${ID}/background`)[0].body).toEqual({
					background: "dots",
				});
			});
		});
	});
});
