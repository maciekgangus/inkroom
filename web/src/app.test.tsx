import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "./app";
import { forgetPreviews } from "./preview-cache";
import type { SocketLike } from "./sync/sync";

// The preview is drawn on a canvas, which the test DOM does not have: only its use is checked.
vi.mock("./board/preview", async (orig) => ({
	...(await orig<typeof import("./board/preview")>()),
	renderPreview: vi.fn(() => "data:image/png;base64,DRAWN"),
}));

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
	headers?: Record<string, string>;
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
		return {
			ok: status < 400,
			status,
			json: async () => reply.body ?? {},
			headers: { get: (name: string) => reply.headers?.[name] ?? null },
		};
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
	// A button is found by its text or, for an icon, by its label.
	const button = (label: string) =>
		[...root.querySelectorAll("button")].find(
			(b) =>
				b.textContent?.includes(label) ||
				b.getAttribute("aria-label")?.includes(label),
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
		forgetPreviews(true); // memory is not cleared with the storage
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
		describe("legal pages (R-096)", () => {
			const legalLinks = () =>
				[...root.querySelectorAll("a")]
					.map((a) => a.getAttribute("href"))
					.filter((h) => h === "/privacy" || h === "/terms");

			test("the login page links to the privacy policy and the terms", async () => {
				mockApi({ "GET /api/me": LOGGED_OUT, "GET /api/config": { body: {} } });
				await mount({ path: "/" });
				await waitText("Zaloguj");
				expect(legalLinks()).toEqual(["/privacy", "/terms"]);
			});

			test("the registration page says that signing up accepts both", async () => {
				mockApi({
					"GET /api/me": LOGGED_OUT,
					"GET /api/config": { body: { turnstileSiteKey: "k" } },
				});
				await mount({ path: "/register" });
				await waitText("Rejestrując się, akceptujesz");
				expect(legalLinks()).toEqual(["/terms", "/privacy"]);
			});
		});

		describe("Google (R-063)", () => {
			const googleLink = () =>
				root.querySelector('a[href="/api/auth/google/start"]');

			test("the login page offers Google when the server has it", async () => {
				mockApi({
					"GET /api/me": LOGGED_OUT,
					"GET /api/config": {
						body: { turnstileSiteKey: "k", google: true },
					},
				});
				await mount({ path: "/" });
				await vi.waitFor(() => expect(googleLink()).not.toBeNull());
				expect(googleLink()?.textContent).toContain("Google");
			});

			test("the login page has no Google link when the server lacks it", async () => {
				const api = mockApi({
					"GET /api/me": LOGGED_OUT,
					"GET /api/config": {
						body: { turnstileSiteKey: "k", google: false },
					},
				});
				await mount({ path: "/" });
				await vi.waitFor(() =>
					expect(api.called("GET /api/config").length).toBe(1),
				);
				await waitText("Zaloguj");
				expect(googleLink()).toBeNull();
			});

			test("an unreachable config does not break the login page", async () => {
				mockApi({ "GET /api/me": LOGGED_OUT });
				await mount({ path: "/" });
				await waitText("Zaloguj");
				expect(googleLink()).toBeNull();
			});

			test("the registration page offers Google, even where the captcha is off", async () => {
				mockApi({
					"GET /api/me": LOGGED_OUT,
					"GET /api/config": {
						body: { turnstileSiteKey: "", google: true },
					},
				});
				await mount({ path: "/register" });
				await vi.waitFor(() => expect(googleLink()).not.toBeNull());
			});

			test("coming back from a refused sign-in explains it", async () => {
				mockApi({ "GET /api/me": LOGGED_OUT, "GET /api/config": { body: {} } });
				await mount({ path: "/", search: "?google=denied" });
				await waitText("Google");
				expect(root.querySelector('[role="alert"]')?.textContent).toContain(
					"Google",
				);
			});

			test("an error from Google is reported", async () => {
				mockApi({ "GET /api/me": LOGGED_OUT, "GET /api/config": { body: {} } });
				await mount({ path: "/", search: "?google=error" });
				await vi.waitFor(() =>
					expect(root.querySelector('[role="alert"]')).not.toBeNull(),
				);
			});
		});

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
			owned: [
				{
					id: ID,
					name: "Matma",
					updatedAt: "2026-11-09T10:00:00Z",
					bytes: 419430,
				},
			],
			visited: [
				{
					id: "f".repeat(32),
					name: "Cudza",
					updatedAt: "2026-11-08T10:00:00Z",
					owner: "pani.anna",
				},
			],
		};

		const boardItem = (name: string) =>
			[...root.querySelectorAll(".boards .board")].find((r) =>
				r.textContent?.includes(name),
			) as HTMLElement;
		const openCardMenu = async (name: string) => {
			const more = boardItem(name).querySelector(
				'button[aria-label="Więcej akcji"]',
			) as HTMLButtonElement;
			await act(async () => {
				more.click();
			});
		};
		const clickMenu = async (label: string) => {
			const item = [...root.querySelectorAll(".action-popover button")].find(
				(b) => b.textContent?.includes(label),
			) as HTMLButtonElement;
			await act(async () => {
				item.click();
			});
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
			await waitText("Utwórz tablicę");
			fill("name", "Fizyka");
			await click("Utwórz tablicę");
			await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(`/b/${ID}`));
			expect(api.called("POST /api/boards")[0].body).toEqual({
				name: "Fizyka",
			});
		});

		test("copies a board's link via the card overflow menu", async () => {
			mockApi({
				"GET /api/me": LOGGED_IN,
				"GET /api/boards": { body: boards },
			});
			const writeText = vi.fn().mockResolvedValue(undefined);
			vi.stubGlobal("navigator", { clipboard: { writeText } });
			await mount({ path: "/" });
			await waitText("Matma");
			await openCardMenu("Matma");
			await clickMenu("Kopiuj link");
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
			await openCardMenu("Matma");
			await clickMenu("Usuń");
			expect(api.called(`DELETE /api/boards/${ID}`)).toHaveLength(0);
			expect(text()).toContain("Na pewno");
			await clickMenu("Na pewno");
			await vi.waitFor(() => expect(boardItem("Matma")).toBeUndefined());
			expect(api.called(`DELETE /api/boards/${ID}`)).toHaveLength(1);
		});

		test("renames a board via menu and via double-click on the title", async () => {
			const api = mockApi({
				"GET /api/me": LOGGED_IN,
				"GET /api/boards": { body: boards },
				[`PATCH /api/boards/${ID}`]: { status: 204 },
			});
			await mount({ path: "/" });
			await waitText("Matma");
			await openCardMenu("Matma");
			await clickMenu("Zmień nazwę");
			const renameForm = root.querySelector(".rename-form");
			const renameSaveBtn = renameForm?.querySelector(
				'button[aria-label="Zapisz"]',
			);
			const renameCancelBtn = renameForm?.querySelector(
				'button[aria-label="Anuluj"]',
			);
			expect(renameSaveBtn?.textContent?.trim()).toBe("");
			expect(renameSaveBtn?.querySelector("svg")).not.toBeNull();
			expect(renameCancelBtn?.textContent?.trim()).toBe("");
			expect(renameCancelBtn?.querySelector("svg")).not.toBeNull();
			await act(async () => {
				const el = root.querySelector(
					'input[name="rename"]',
				) as HTMLInputElement;
				el.value = "Algebra";
				el.dispatchEvent(new Event("input", { bubbles: true }));
			});
			await submit("rename");
			await waitText("Algebra");
			expect(api.called(`PATCH /api/boards/${ID}`)[0].body).toEqual({
				name: "Algebra",
			});

			// Double-clicking an owned board's title also enters inline rename.
			await act(async () => {
				boardItem("Algebra")
					.querySelector(".name-editable")
					?.dispatchEvent(
						new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
					);
			});
			expect(root.querySelector('input[name="rename"]')).not.toBeNull();
			await click("Anuluj");
			expect(root.querySelector('input[name="rename"]')).toBeNull();
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
			await openCardMenu("Matma");
			await clickMenu("Utwórz kopię");
			await waitText("Matma (kopia)");
			expect(api.called(`POST /api/boards/${ID}/copy`)).toHaveLength(1);
			const names = [...root.querySelectorAll(".boards .name")].map(
				(n) => n.textContent,
			);
			expect(names.slice(0, 2)).toEqual(["Matma (kopia)", "Matma"]);
		});

		describe("the lists follow the server (they went stale after coming back)", () => {
			const FRESH = {
				owned: [
					{
						id: "a".repeat(32),
						name: "Nowa z drugiej karty",
						updatedAt: "2026-11-11T10:00:00Z",
					},
					...boards.owned,
				],
				visited: boards.visited,
			};
			/** A panel whose second answer from the server has one more board in it. */
			const open = async () => {
				let calls = 0;
				const api = mockApi({
					"GET /api/me": LOGGED_IN,
					"GET /api/boards": () => ({ body: ++calls === 1 ? boards : FRESH }),
				});
				await mount({ path: "/" });
				await waitText("Matma");
				expect(text()).not.toContain("Nowa z drugiej karty");
				return api;
			};
			const shows = () =>
				vi.waitFor(() => expect(text()).toContain("Nowa z drugiej karty"));
			const visibility = (state: string) =>
				act(async () => {
					Object.defineProperty(document, "visibilityState", {
						value: state,
						configurable: true,
					});
					document.dispatchEvent(new Event("visibilitychange"));
				});

			test("a page shown again from the back-forward cache is refreshed", async () => {
				const api = await open();
				await act(async () => {
					const e = new Event("pageshow");
					Object.defineProperty(e, "persisted", { value: true });
					window.dispatchEvent(e);
				});
				await shows();
				expect(api.called("GET /api/boards")).toHaveLength(2);
			});

			test("an ordinary page show (the first load) does not fetch twice", async () => {
				const api = await open();
				await act(async () => {
					const e = new Event("pageshow");
					Object.defineProperty(e, "persisted", { value: false });
					window.dispatchEvent(e);
				});
				expect(api.called("GET /api/boards")).toHaveLength(1);
			});

			test("coming back to the tab refreshes the lists", async () => {
				await open();
				await visibility("visible");
				await shows();
			});

			test("a hidden tab does not fetch", async () => {
				const api = await open();
				await visibility("hidden");
				expect(api.called("GET /api/boards")).toHaveLength(1);
			});

			test("focusing the window refreshes the lists", async () => {
				await open();
				await act(async () => {
					window.dispatchEvent(new Event("focus"));
				});
				await shows();
			});

			test("a failed refresh keeps what is shown", async () => {
				let calls = 0;
				mockApi({
					"GET /api/me": LOGGED_IN,
					"GET /api/boards": () =>
						++calls === 1
							? { body: boards }
							: { status: 500, body: { error: "x" } },
				});
				await mount({ path: "/" });
				await waitText("Matma");
				await act(async () => {
					window.dispatchEvent(new Event("focus"));
				});
				await new Promise((r) => setTimeout(r, 50));
				expect(text()).toContain("Matma");
			});
		});

		test("a board that is somebody else's says whose it is (R-051)", async () => {
			mockApi({
				"GET /api/me": LOGGED_IN,
				"GET /api/boards": { body: boards },
			});
			await mount({ path: "/" });
			await waitText("Cudza");
			const rows = [...root.querySelectorAll(".boards .board")];
			const theirs = rows.find((r) => r.textContent?.includes("Cudza"));
			const mine = rows.find((r) => r.textContent?.includes("Matma"));
			expect(theirs?.textContent).toContain("Tablica: pani.anna");
			expect(mine?.textContent).not.toContain("Tablica:");
		});

		test("a joined board can be dropped from the list without a question", async () => {
			const FID = "f".repeat(32);
			const api = mockApi({
				"GET /api/me": LOGGED_IN,
				"GET /api/boards": { body: boards },
				[`DELETE /api/boards/${FID}/visit`]: { status: 204 },
			});
			await mount({ path: "/", navigate: vi.fn() });
			await waitText("Cudza");
			await openCardMenu("Cudza");
			await clickMenu("Usuń z listy");
			await vi.waitFor(() => expect(boardItem("Cudza")).toBeUndefined());
			expect(api.called(`DELETE /api/boards/${FID}/visit`)).toHaveLength(1);
			expect(text()).toContain("Matma"); // my own board is still there
			expect(api.called(`DELETE /api/boards/${ID}`)).toHaveLength(0);
		});

		test("my own board has no 'drop from the list', only a delete", async () => {
			mockApi({
				"GET /api/me": LOGGED_IN,
				"GET /api/boards": { body: { owned: boards.owned, visited: [] } },
			});
			await mount({ path: "/" });
			await waitText("Matma");
			await openCardMenu("Matma");
			const items = [...root.querySelectorAll(".action-popover button")].map(
				(b) => b.textContent?.trim(),
			);
			expect(items).not.toContain("Usuń z listy");
			expect(items).toContain("Usuń");
		});

		describe("search and filter of the boards (R-091)", () => {
			const open = async () => {
				mockApi({
					"GET /api/me": LOGGED_IN,
					"GET /api/boards": { body: boards },
				});
				await mount({ path: "/" });
				await waitText("Matma");
			};
			const search = async (q: string) => {
				await act(async () => {
					const el = root.querySelector(
						'input[name="search"]',
					) as HTMLInputElement;
					el.value = q;
					el.dispatchEvent(new Event("input", { bubbles: true }));
				});
			};
			const filterBtn = (label: string) =>
				[...root.querySelectorAll(".filter-menu button")].find((b) =>
					b.textContent?.includes(label),
				) as HTMLButtonElement;

			test("search is always visible while advanced filters stay folded until opened", async () => {
				await open();
				expect(root.querySelector('input[name="search"]')).not.toBeNull();
				expect(root.querySelector(".filter-menu")).toBeNull();
				await click("Filtr");
				expect(root.querySelector(".filter-menu")).not.toBeNull();
				await click("Filtr");
				expect(root.querySelector(".filter-menu")).toBeNull();
			});

			test("searching by owner leaves only that person's boards, and a name search the matching one", async () => {
				await open();
				await search("anna");
				expect(text()).toContain("Cudza");
				expect(text()).not.toContain("Matma");
				await search("matm");
				expect(text()).toContain("Matma");
				expect(text()).not.toContain("Cudza");
			});

			test("a tile shows the board's size beside its date", async () => {
				await open();
				const tile = [...root.querySelectorAll(".boards .board")].find((r) =>
					r.textContent?.includes("Matma"),
				);
				expect(tile?.querySelector(".size")?.textContent).toBe("0,4 MB");
			});

			test("a date typed as 08.11 finds the board changed that day", async () => {
				await open();
				await search("08.11");
				expect(text()).toContain("Cudza");
				expect(text()).not.toContain("Matma");
			});

			test("says so when nothing matches, and Wyczyść brings everything back", async () => {
				await open();
				await search("zzz");
				expect(text()).toContain("Żadna tablica nie pasuje");
				await click("Wyczyść");
				expect(text()).toContain("Matma");
				expect(text()).toContain("Cudza");
				expect(text()).not.toContain("Żadna tablica nie pasuje");
			});

			test("'Udostępnione' hides my own boards and shows as the pressed pill", async () => {
				await open();
				await click("Filtr");
				await act(async () => {
					filterBtn("Udostępnione").click();
				});
				expect(text()).toContain("Cudza");
				expect(text()).not.toContain("Matma");
				expect(filterBtn("Udostępnione").getAttribute("aria-pressed")).toBe(
					"true",
				);
				expect(filterBtn("Wszystkie").getAttribute("aria-pressed")).toBe(
					"false",
				);
				expect(root.querySelector("select")).toBeNull();
			});

			test("the pills are labelled groups: who, when, order, group", async () => {
				await open();
				await click("Filtr");
				const groups = [...root.querySelectorAll(".filter-menu fieldset")].map(
					(g) => g.getAttribute("aria-label"),
				);
				expect(groups).toEqual([
					"Czyje",
					"Zmieniona",
					"Kolejność",
					"Grupowanie",
				]);
			});

			test("the cross in the search field clears the text and only shows when there is some", async () => {
				await open();
				expect(button("Skasuj tekst")).toBeUndefined();
				await search("zzz");
				expect(text()).toContain("Żadna tablica nie pasuje");
				await click("Skasuj tekst");
				expect(
					(root.querySelector('input[name="search"]') as HTMLInputElement)
						.value,
				).toBe("");
				expect(text()).toContain("Matma");
				expect(button("Skasuj tekst")).toBeUndefined();
			});

			test("a time range pill narrows the lists and the filter button shows that a filter is on", async () => {
				await open();
				await click("Filtr");
				expect(button("Filtr").getAttribute("aria-pressed")).toBe("false");
				await act(async () => {
					filterBtn("Dziś").click();
				});
				expect(filterBtn("Dziś").getAttribute("aria-pressed")).toBe("true");
				expect(text()).not.toContain("Cudza");
				expect(button("Filtr").getAttribute("aria-pressed")).toBe("true");
			});
		});

		describe("list or tiles with previews (R-052)", () => {
			const FID = "f".repeat(32);
			const preview = (id: string, etag = '"1-plain"') => ({
				[`GET /api/boards/${id}/preview`]: {
					headers: { ETag: etag },
					body: { background: "plain", strokes: [] },
				},
			});
			const openPanel = async (extra = {}, navigate = vi.fn()) => {
				const api = mockApi({
					"GET /api/me": LOGGED_IN,
					"GET /api/boards": { body: boards },
					...preview(ID),
					...preview(FID),
					...extra,
				});
				await mount({ path: "/", navigate });
				await waitText("Matma");
				return api;
			};
			const tileOf = (name: string) =>
				[...root.querySelectorAll(".boards .board")].find((r) =>
					r.textContent?.includes(name),
				) as HTMLElement;
			const lists = () => [...root.querySelectorAll(".boards")];
			const pressed = (label: string) =>
				button(label)?.getAttribute("aria-pressed") === "true";

			test("starts as tiles for everyone, each with a placeholder until its picture is there", async () => {
				localStorage.removeItem("inkroom.boardView"); // no choice made on this device
				// A tile that is not yet in view has not asked for its picture: only the placeholder.
				vi.stubGlobal(
					"IntersectionObserver",
					class {
						observe() {}
						disconnect() {}
					},
				);
				const api = await openPanel();
				expect(pressed("Kafelki")).toBe(true);
				expect(pressed("Lista")).toBe(false);
				expect(lists().every((l) => l.classList.contains("tiles"))).toBe(true);
				expect(root.querySelectorAll(".preview-box.loading")).toHaveLength(2);
				expect(root.querySelector("img.preview")).toBeNull();
				expect(api.called(`GET /api/boards/${ID}/preview`)).toHaveLength(0);
				vi.unstubAllGlobals();
			});

			test("a tile loses its placeholder when the picture arrives", async () => {
				localStorage.removeItem("inkroom.boardView");
				const api = await openPanel();
				await vi.waitFor(() =>
					expect(root.querySelectorAll("img.preview")).toHaveLength(2),
				);
				expect(root.querySelectorAll(".preview-box.loading")).toHaveLength(0);
				expect(api.called(`GET /api/boards/${ID}/preview`)).toHaveLength(1);
			});

			test("the list stays available and fetches no previews", async () => {
				const api = await openPanel();
				await click("Lista");
				expect(lists().every((l) => !l.classList.contains("tiles"))).toBe(true);
				expect(root.querySelector(".preview-box")).toBeNull();
				expect(api.called(`GET /api/boards/${ID}/preview`).length).toBeLessThan(
					2,
				);
			});

			test("tiles show a picture of each board, in both lists", async () => {
				const api = await openPanel();
				await click("Kafelki");
				expect(lists().every((l) => l.classList.contains("tiles"))).toBe(true);
				await vi.waitFor(() =>
					expect(root.querySelectorAll("img.preview")).toHaveLength(2),
				);
				expect(root.querySelector("img.preview")?.getAttribute("src")).toBe(
					"data:image/png;base64,DRAWN",
				);
				expect(api.called(`GET /api/boards/${ID}/preview`)).toHaveLength(1);
				expect(api.called(`GET /api/boards/${FID}/preview`)).toHaveLength(1);
			});

			test("a tile keeps the name, the date, the owner and the quiet controls", async () => {
				await openPanel();
				await click("Kafelki");
				const tile = [...root.querySelectorAll(".boards .board")].find((r) =>
					r.textContent?.includes("Cudza"),
				);
				expect(tile?.textContent).toContain("Tablica: pani.anna");
				expect(
					tile?.querySelector('button[aria-label="Więcej akcji"]'),
				).not.toBeNull();
				expect(tile?.querySelector("a.open-link")).not.toBeNull();
			});

			test("the choice of the list is remembered on the device", async () => {
				await openPanel();
				await click("Lista");
				expect(localStorage.getItem("inkroom.boardView")).toBe("list");
				render(null, root);
				await openPanel();
				expect(pressed("Lista")).toBe(true);
				expect(lists().every((l) => !l.classList.contains("tiles"))).toBe(true);
				await click("Kafelki");
				expect(localStorage.getItem("inkroom.boardView")).toBe("tiles");
			});

			test("a picture already drawn for this version is not drawn again", async () => {
				const { renderPreview } = await import("./board/preview");
				const drawn = vi.mocked(renderPreview);
				drawn.mockClear();
				localStorage.setItem(
					`inkroom.preview.${ID}`,
					JSON.stringify({
						tag: '"1-plain"',
						url: "data:image/png;base64,KEPT",
						at: 1,
					}),
				);
				await openPanel();
				await click("Kafelki");
				await vi.waitFor(() =>
					expect(root.querySelectorAll("img.preview")).toHaveLength(2),
				);
				const mine = [...root.querySelectorAll(".boards .board")]
					.find((r) => r.textContent?.includes("Matma"))
					?.querySelector("img.preview");
				expect(mine?.getAttribute("src")).toBe("data:image/png;base64,KEPT");
				expect(drawn).toHaveBeenCalledTimes(1); // only the other board
			});

			test("the whole tile opens the board, and there is no 'Otwórz' button", async () => {
				const navigate = vi.fn();
				await openPanel({}, navigate);
				await click("Kafelki");
				expect(button("Otwórz")).toBeUndefined();
				const link = tileOf("Matma").querySelector(
					"a.open-link",
				) as HTMLAnchorElement;
				expect(link.getAttribute("href")).toBe(`/b/${ID}`);
				expect(link.getAttribute("aria-label")).toBe("Matma");
				await act(async () => {
					link
						.querySelector(".preview-box")
						?.dispatchEvent(
							new MouseEvent("click", { bubbles: true, cancelable: true }),
						);
				});
				expect(navigate).toHaveBeenCalledWith(`/b/${ID}`);
			});

			test("a click with a modifier is left to the browser (a new tab)", async () => {
				const navigate = vi.fn();
				await openPanel({}, navigate);
				await click("Kafelki");
				const link = tileOf("Matma").querySelector(
					"a.open-link",
				) as HTMLAnchorElement;
				const e = new MouseEvent("click", {
					bubbles: true,
					cancelable: true,
					ctrlKey: true,
				});
				await act(async () => {
					link.dispatchEvent(e);
				});
				expect(navigate).not.toHaveBeenCalled();
				expect(e.defaultPrevented).toBe(false);
			});

			test("a tile keeps only pin and an overflow menu with labelled actions", async () => {
				await openPanel();
				await click("Kafelki");
				const buttons = [
					...tileOf("Matma").querySelectorAll(
						".board-controls .card-quiet-btn",
					),
				];
				expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
					"Przypnij",
					"Więcej akcji",
				]);
				for (const b of buttons) {
					expect(b.textContent?.trim()).toBe("");
					expect(b.querySelector("svg")).not.toBeNull();
					expect(b.getAttribute("title")).toBe(b.getAttribute("aria-label"));
				}
				await openCardMenu("Matma");
				const mineItems = [
					...tileOf("Matma").querySelectorAll(".action-popover button"),
				].map((b) => b.textContent?.trim());
				expect(mineItems).toEqual([
					"Kopiuj link",
					"Organizuj…",
					"Właściciele…",
					"Przypnij na górze",
					"Zmień nazwę",
					"Utwórz kopię",
					"Usuń",
				]);
				await openCardMenu("Cudza");
				const theirItems = [
					...tileOf("Cudza").querySelectorAll(".action-popover button"),
				].map((b) => b.textContent?.trim());
				expect(theirItems).toEqual([
					"Kopiuj link",
					"Organizuj…",
					"Dodaj „pani.anna” do znajomych",
					"Przypnij na górze",
					"Usuń z listy",
				]);
			});

			test("deleting from a tile still asks first", async () => {
				const api = await openPanel({
					[`DELETE /api/boards/${ID}`]: { status: 204 },
				});
				await click("Kafelki");
				await openCardMenu("Matma");
				await clickMenu("Usuń");
				expect(api.called(`DELETE /api/boards/${ID}`)).toHaveLength(0);
				expect(tileOf("Matma").textContent).toContain("Na pewno");
				await clickMenu("Na pewno");
				await vi.waitFor(() => expect(boardItem("Matma")).toBeUndefined());
				expect(api.called(`DELETE /api/boards/${ID}`)).toHaveLength(1);
			});

			test("the list uses the same quiet controls, and the name opens the board", async () => {
				const navigate = vi.fn();
				await openPanel({}, navigate);
				await click("Lista");
				expect(button("Otwórz")).toBeUndefined();
				const row = tileOf("Matma");
				const buttons = [
					...row.querySelectorAll(".board-controls .card-quiet-btn"),
				];
				expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
					"Przypnij",
					"Więcej akcji",
				]);
				for (const b of buttons) {
					expect(b.textContent?.trim()).toBe("");
					expect(b.querySelector("svg")).not.toBeNull();
				}
				const link = row.querySelector("a.open-link") as HTMLAnchorElement;
				expect(link.getAttribute("href")).toBe(`/b/${ID}`);
				expect(link.textContent).toContain("Matma");
				await act(async () => {
					link.dispatchEvent(
						new MouseEvent("click", { bubbles: true, cancelable: true }),
					);
				});
				expect(navigate).toHaveBeenCalledWith(`/b/${ID}`);
			});

			test("the switch between list and tiles is two icons with labels", async () => {
				await openPanel();
				for (const label of ["Lista", "Kafelki"]) {
					const b = button(label);
					expect(b.textContent?.trim()).toBe("");
					expect(b.querySelector("svg")).not.toBeNull();
					expect(b.getAttribute("title")).toBe(label);
				}
			});

			test("a board whose preview cannot be loaded still has its tile", async () => {
				await openPanel({
					[`GET /api/boards/${ID}/preview`]: {
						status: 500,
						body: { error: "x" },
					},
				});
				await click("Kafelki");
				await vi.waitFor(
					() => expect(root.querySelectorAll("img.preview")).toHaveLength(1), // the other one
				);
				expect(text()).toContain("Matma");
			});
		});

		test("the time of the last change has a date and an hour, no seconds (both views)", async () => {
			mockApi({
				"GET /api/me": LOGGED_IN,
				"GET /api/boards": { body: boards },
				[`GET /api/boards/${ID}/preview`]: {
					body: { background: "plain", strokes: [] },
				},
			});
			await mount({ path: "/" });
			await waitText("Matma");
			for (const view of ["Lista", "Kafelki"]) {
				await click(view);
				const when = root.querySelector(".board .when") as HTMLElement;
				expect(when.textContent).toMatch(
					/^\d{2}\.\d{2}\.\d{4}\s·\s\d{2}:\d{2}$/,
				);
				expect(when.tagName).toBe("TIME");
				expect(when.getAttribute("datetime")).toBe("2026-11-09T10:00:00Z");
				expect(when.querySelector(".time")?.textContent).toMatch(
					/^\d{2}:\d{2}$/,
				);
				expect(when.querySelector(".date")?.textContent).toMatch(
					/^\d{2}\.\d{2}\.\d{4}$/,
				);
			}
		});

		test("a board that is not mine cannot be copied", async () => {
			mockApi({
				"GET /api/me": LOGGED_IN,
				"GET /api/boards": { body: boards },
			});
			await mount({ path: "/" });
			await waitText("Cudza");
			await openCardMenu("Cudza");
			expect(
				[...boardItem("Cudza").querySelectorAll(".action-popover button")].some(
					(b) => b.textContent?.includes("Utwórz kopię"),
				),
			).toBe(false);
			await openCardMenu("Matma");
			expect(
				[...boardItem("Matma").querySelectorAll(".action-popover button")].some(
					(b) => b.textContent?.includes("Utwórz kopię"),
				),
			).toBe(true);
		});

		test("manages co-owners via contact suggestions and transfers a board (R-122, R-123)", async () => {
			const api = mockApi({
				"GET /api/me": LOGGED_IN,
				"GET /api/boards": { body: boards },
				"GET /api/contacts": {
					body: {
						contacts: [
							{ id: 2, username: "ania", saved: true, source: "contact" },
							{ id: 3, username: "tomek", saved: false, source: "visitor" },
						],
					},
				},
				"POST /api/contacts": {
					status: 201,
					body: {
						contact: {
							id: 3,
							username: "tomek",
							saved: true,
							source: "contact",
						},
						contacts: [
							{ id: 2, username: "ania", saved: true, source: "contact" },
							{ id: 3, username: "tomek", saved: true, source: "contact" },
						],
					},
				},
				[`GET /api/boards/${ID}/owners`]: {
					body: { owners: [{ id: 1, username: "ola.k" }] },
				},
				[`POST /api/boards/${ID}/owners`]: {
					body: {
						added: { id: 2, username: "ania" },
						owners: [
							{ id: 1, username: "ola.k" },
							{ id: 2, username: "ania" },
						],
					},
				},
				[`POST /api/boards/${ID}/transfer`]: {
					body: {
						owner: "tomek",
						owners: [{ id: 3, username: "tomek" }],
					},
				},
			});
			await mount({ path: "/" });
			await waitText("Matma");

			// Open "Znajomi" from sidebar and save recent collaborator "tomek".
			await click("Znajomi");
			await waitText("Z ostatniej współpracy");
			await click("Zapisz");
			await waitText("Dodano „tomek” do znajomych");
			await click("Zamknij");

			// Open "Właściciele…" and add "ania" with 1 click on her suggestion chip (without typing!).
			await openCardMenu("Matma");
			await clickMenu("Właściciele…");
			await waitText("Współwłaściciele");
			const aniaChip = [...root.querySelectorAll(".org-suggest-chip")].find(
				(b) => b.textContent?.includes("ania"),
			) as HTMLButtonElement;
			await act(async () => {
				aniaChip.click();
			});
			await waitText("Dodano współwłaściciela");
			expect(api.called(`POST /api/boards/${ID}/owners`)[0].body).toEqual({
				login: "ania",
			});
			expect(boardItem("Matma").querySelector(".coowners")?.textContent).toBe(
				"ania",
			);

			// Pick "tomek" from transfer suggestions and confirm transfer -> moves to visited list.
			const transferChips = [
				...root.querySelectorAll(
					'section[aria-label="Podpowiedzi odbiorcy"] .org-suggest-chip',
				),
			];
			const tomekChip = transferChips.find((b) =>
				b.textContent?.includes("tomek"),
			) as HTMLButtonElement;
			await act(async () => {
				tomekChip.click();
			});
			await click("Przekaż…");
			await waitText("Na pewno przekazać?");
			await click("Na pewno przekazać?");
			await waitText("Przekazano tablicę osobie");
			expect(api.called(`POST /api/boards/${ID}/transfer`)[0].body).toEqual({
				login: "tomek",
			});
			expect(boardItem("Matma").textContent).toContain("Tablica: tomek");
		});

		test("logging out returns to the login forms", async () => {
			const api = mockApi({
				"GET /api/me": LOGGED_IN,
				"GET /api/boards": { body: boards },
				"POST /api/logout": { status: 204 },
			});
			await mount({ path: "/" });
			await waitText("Matma");
			const calendar = root.querySelector(
				'a[href="/calendar"]',
			) as HTMLAnchorElement;
			expect(calendar?.getAttribute("aria-label")).toBe("Kalendarz");
			expect(calendar?.querySelector("svg")).not.toBeNull();
			const logoutBtn = button("Wyloguj");
			expect(logoutBtn.getAttribute("aria-label")).toBe("Wyloguj");
			expect(logoutBtn.querySelector("svg")).not.toBeNull();
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

		test("the name Administrator is not accepted from a guest", async () => {
			mockApi({
				"GET /api/me": LOGGED_OUT,
				[`GET /api/boards/${ID}`]: { body: { id: ID, name: "Matma" } },
			});
			const createSocket = vi.fn(fakeSocket);
			await mount({ path: `/b/${ID}`, createSocket });
			await vi.waitFor(() =>
				expect(root.querySelector('input[name="name"]')).not.toBeNull(),
			);
			for (const n of ["Administrator", "admin.istrator"]) {
				fill("name", n);
				await submit("name");
				expect(root.querySelector('input[name="name"]')).not.toBeNull();
				expect(text()).toContain("zarezerwowane");
				expect(localStorage.getItem("inkroom.name")).toBeNull();
			}
			expect(createSocket).not.toHaveBeenCalled();
		});

		describe("entering as the Administrator with a ticket from the admin panel (R-065)", () => {
			const ticket = "?admin=123.abcdef";

			test("a guest is not asked for a name and joins as the Administrator with the ticket", async () => {
				mockApi({
					"GET /api/me": LOGGED_OUT,
					[`GET /api/boards/${ID}`]: { body: { id: ID, name: "Matma" } },
				});
				const createSocket = vi.fn((_url: string) => fakeSocket());
				await mount({ path: `/b/${ID}`, search: ticket, createSocket });
				await vi.waitFor(() => expect(createSocket).toHaveBeenCalledOnce());
				const url = createSocket.mock.calls[0][0];
				expect(url).toContain("name=Administrator");
				expect(url).toContain("admin=123.abcdef");
				expect(root.querySelector('input[name="name"]')).toBeNull();
			});

			test("a logged-in person is the Administrator too, not their username", async () => {
				mockApi({
					"GET /api/me": LOGGED_IN,
					[`GET /api/boards/${ID}`]: { body: { id: ID, name: "Matma" } },
				});
				const createSocket = vi.fn((_url: string) => fakeSocket());
				await mount({ path: `/b/${ID}`, search: ticket, createSocket });
				await vi.waitFor(() => expect(createSocket).toHaveBeenCalledOnce());
				const url = createSocket.mock.calls[0][0];
				expect(url).toContain("name=Administrator");
				expect(url).not.toContain("ola.k");
			});

			test("without a ticket in the address nothing changes", async () => {
				mockApi({
					"GET /api/me": LOGGED_IN,
					[`GET /api/boards/${ID}`]: { body: { id: ID, name: "Matma" } },
				});
				const createSocket = vi.fn((_url: string) => fakeSocket());
				await mount({ path: `/b/${ID}`, search: "", createSocket });
				await vi.waitFor(() => expect(createSocket).toHaveBeenCalledOnce());
				const url = createSocket.mock.calls[0][0];
				expect(url).toContain("name=ola.k");
				expect(url).not.toContain("admin=");
			});
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
			await vi.waitFor(() =>
				expect(createSocket).toHaveBeenCalledWith(
					expect.stringContaining(`/ws/${ID}`),
				),
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
			await vi.waitFor(() => expect(createSocket).toHaveBeenCalledOnce());
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

			test("ownership given or taken live updates the owner tools without a reload (R-122)", async () => {
				sessionStorage.setItem("inkroom.authorId", "me");
				const { socket } = await open(false);
				const peers = (owner: boolean) =>
					act(async () => {
						socket.onmessage?.({
							data: JSON.stringify({
								t: "peers",
								peers: [{ id: "me", name: "ola.k", userId: 1, owner }],
							}),
						});
					});
				expect(pick("grid")).toBeNull();
				await peers(true);
				expect(pick("grid")).not.toBeNull();
				await peers(false);
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

		test("clicking a logged-in participant on the live board lets you add them as friend or co-owner (R-123)", async () => {
			const api = mockApi({
				"GET /api/me": LOGGED_IN,
				"GET /api/contacts": { body: { contacts: [] } },
				[`GET /api/boards/${ID}`]: {
					body: { id: ID, name: "Matma", owner: true },
				},
				[`POST /api/boards/${ID}/owners`]: {
					body: { added: { id: 7, username: "kasia.w" }, owners: [] },
				},
				"POST /api/contacts": {
					status: 201,
					body: {
						contact: {
							id: 7,
							username: "kasia.w",
							saved: true,
							source: "contact",
						},
						contacts: [
							{ id: 7, username: "kasia.w", saved: true, source: "contact" },
						],
					},
				},
			});
			const socket = fakeSocket();
			await mount({ path: `/b/${ID}`, createSocket: () => socket });
			await vi.waitFor(() =>
				expect(
					root.querySelectorAll('canvas:not([aria-label="board map"])'),
				).toHaveLength(2),
			);

			await act(async () => {
				socket.onmessage?.({
					data: JSON.stringify({
						t: "peers",
						peers: [
							{ id: "self", name: "ola.k", userId: 1, owner: true },
							{ id: "peer-kasia", name: "kasia.w", userId: 7 },
							{ id: "peer-guest", name: "Gość" },
						],
					}),
				});
			});

			// Click kasia.w's avatar chip -> PersonPopover opens with friend & co-owner actions!
			const kasiaChip = root.querySelector(
				'button.participant[data-name="kasia.w"]',
			) as HTMLButtonElement;
			expect(kasiaChip).not.toBeNull();
			await act(async () => kasiaChip.click());

			const pop = root.querySelector(".person-popover");
			expect(pop?.textContent).toContain("kasia.w");
			expect(pop?.textContent).toContain("Dodaj do znajomych");
			expect(pop?.textContent).toContain("Dodaj jako współwłaściciela");

			const addFriendBtn = [
				...root.querySelectorAll('.person-popover button[role="menuitem"]'),
			].find((b) =>
				b.textContent?.includes("Dodaj do znajomych"),
			) as HTMLButtonElement;
			await act(async () => addFriendBtn.click());

			await vi.waitFor(() =>
				expect(api.called("POST /api/contacts")).toHaveLength(1),
			);
			expect(api.called("POST /api/contacts")[0].body).toEqual({ userId: 7 });
			await vi.waitFor(() =>
				expect(root.querySelector(".toast.notice")?.textContent).toContain(
					"kasia.w",
				),
			);

			// The co-owner is added by account id, never by the name the peer shows.
			await act(async () => kasiaChip.click());
			const addOwnerBtn = [
				...root.querySelectorAll('.person-popover button[role="menuitem"]'),
			].find((b) =>
				b.textContent?.includes("Dodaj jako współwłaściciela"),
			) as HTMLButtonElement;
			await act(async () => addOwnerBtn.click());
			await vi.waitFor(() =>
				expect(api.called(`POST /api/boards/${ID}/owners`)).toHaveLength(1),
			);
			expect(api.called(`POST /api/boards/${ID}/owners`)[0].body).toEqual({
				userId: 7,
			});

			// Clicking a guest's avatar explains they don't have an Inkroom account.
			const guestChip = root.querySelector(
				'button.participant[data-name="Gość"]',
			) as HTMLButtonElement;
			await act(async () => guestChip.click());
			expect(root.querySelector(".person-popover-note")?.textContent).toContain(
				"Gość bez konta",
			);
		});
	});
});
