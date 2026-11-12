import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// The admin page (R-064, R-065) is plain HTML with a script, served by the Go server. It is run
// here as it is, in jsdom, with fetch answered from a table. (Read through a dynamic import so the
// client's types need not know Node.)
const nodeFs: string = "node:fs";
const { readFileSync } = await import(/* @vite-ignore */ nodeFs);
// (`npm test` runs in web/, so the page is found relative to it.)
const HTML: string = readFileSync("../server/cmd/server/admin.html", "utf8");
interface Call {
	method: string;
	path: string;
	body: unknown;
	headers: Record<string, string>;
}

const users = [
	{
		id: 1,
		email: "ann@example.com",
		username: "ann",
		createdAt: "2026-01-10T10:00:00Z",
		owned: 5,
		visited: 0,
		lastActive: "2026-11-01T10:00:00Z",
		bytes: 2048,
	},
	{
		id: 2,
		email: "bob@example.com",
		username: "bob",
		createdAt: "2026-03-05T10:00:00Z",
		owned: 12,
		visited: 3,
		lastActive: "2026-10-01T10:00:00Z",
		bytes: 5 * 1024 * 1024,
	},
	{
		id: 3,
		email: "cleo@example.com",
		username: "cleo",
		createdAt: "2026-02-01T10:00:00Z",
		owned: 2,
		visited: 1,
		lastActive: "2026-11-10T10:00:00Z",
		bytes: 0,
	},
];
const boards = [
	{
		id: "b1",
		name: "Matma",
		ownerId: 1,
		owner: "ann",
		createdAt: "2026-02-01T10:00:00Z",
		updatedAt: "2026-11-01T10:00:00Z",
		strokes: 10,
		images: 1,
		bytes: 4096,
		visitors: 2,
	},
	{
		id: "b2",
		name: "Fizyka",
		ownerId: 2,
		owner: "bob",
		createdAt: "2026-02-02T10:00:00Z",
		updatedAt: "2026-11-09T10:00:00Z",
		strokes: 100,
		images: 0,
		bytes: 100,
		visitors: 0,
	},
	{
		id: "b3",
		name: "<img src=x onerror=window.__pwned=1>",
		ownerId: 1,
		owner: "ann",
		createdAt: "2026-02-03T10:00:00Z",
		updatedAt: "2026-10-01T10:00:00Z",
		strokes: 3,
		images: 0,
		bytes: 1,
		visitors: 1,
	},
];

let calls: Call[];
let answers: Record<string, () => { status: number; body?: unknown }>;

function mount() {
	const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(HTML)?.[1] ?? "";
	const script = /<script>([\s\S]*?)<\/script>/.exec(body)?.[1] ?? "";
	document.body.innerHTML = body.replace(/<script>[\s\S]*?<\/script>/, "");
	new Function(script)();
}

const flush = async () => {
	for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
const q = <T extends Element>(s: string) => document.querySelector(s) as T;
const all = <T extends Element>(s: string) =>
	[...document.querySelectorAll(s)] as T[];
const click = async (el: Element | null) => {
	(el as HTMLElement).click();
	await flush();
};
const tab = (name: string) => q<HTMLButtonElement>(`[data-tab="${name}"]`);
const rows = (view: string) =>
	all<HTMLTableRowElement>(`#view-${view} tbody tr`);
const cells = (tr: Element) =>
	[...tr.querySelectorAll("td")].map((td) => td.textContent?.trim());
const button = (within: Element, text: string) =>
	[...within.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === text,
	) as HTMLButtonElement;
const header = (view: string, label: string) =>
	all<HTMLElement>(`#view-${view} th`).find(
		(th) => th.textContent?.replace(/[▲▼]/g, "").trim() === label,
	) as HTMLElement;
const names = (view: string, col = 0) => rows(view).map((r) => cells(r)[col]);
const type = async (el: HTMLInputElement, value: string) => {
	el.value = value;
	el.dispatchEvent(new Event("input", { bubbles: true }));
	await flush();
};

beforeEach(() => {
	calls = [];
	answers = {
		"GET /api/admin/feedback": () => ({ status: 200, body: [] }),
		"GET /api/admin/users": () => ({ status: 200, body: users }),
		"GET /api/admin/boards": () => ({ status: 200, body: boards }),
	};
	vi.stubGlobal("fetch", async (path: string, init: RequestInit = {}) => {
		const method = init.method ?? "GET";
		calls.push({
			method,
			path,
			body: init.body ? JSON.parse(String(init.body)) : undefined,
			headers: (init.headers ?? {}) as Record<string, string>,
		});
		const a = answers[`${method} ${path}`];
		const r = a ? a() : { status: 204 };
		return {
			ok: r.status < 400,
			status: r.status,
			json: async () => structuredClone(r.body ?? {}),
		} as Response;
	});
	vi.stubGlobal("open", vi.fn());
	delete (window as unknown as Record<string, unknown>).__pwned;
	mount();
});
afterEach(() => vi.unstubAllGlobals());

describe("tabs", () => {
	test("the notes are shown first and the other views are loaded only when opened", async () => {
		await flush();
		expect(calls.map((c) => c.path)).toEqual(["/api/admin/feedback"]);
		await click(tab("users"));
		expect(calls.map((c) => c.path)).toContain("/api/admin/users");
		expect(q("#view-users").hasAttribute("hidden")).toBe(false);
		expect(q("#view-feedback").hasAttribute("hidden")).toBe(true);
		expect(rows("users")).toHaveLength(3);
	});
});

describe("users", () => {
	beforeEach(async () => {
		await flush();
		await click(tab("users"));
	});

	test("shows name, e-mail, boards, size and dates", () => {
		const ann = cells(
			rows("users").find((r) => r.textContent?.includes("ann@"))!,
		);
		expect(ann[0]).toBe("ann");
		expect(ann[1]).toBe("ann@example.com");
		expect(ann).toContain("5");
		expect(ann.join(" ")).toContain("2 KB");
		expect(
			cells(rows("users").find((r) => r.textContent?.includes("bob@"))!).join(
				" ",
			),
		).toContain("5 MB");
	});

	test("is sorted by a click on a column, and back by a second click", async () => {
		await click(header("users", "Nazwa"));
		expect(names("users")).toEqual(["ann", "bob", "cleo"]);
		expect(header("users", "Nazwa").getAttribute("aria-sort")).toBe(
			"ascending",
		);
		await click(header("users", "Nazwa"));
		expect(names("users")).toEqual(["cleo", "bob", "ann"]);
		expect(header("users", "Nazwa").getAttribute("aria-sort")).toBe(
			"descending",
		);
	});

	test("numbers are sorted as numbers and dates as dates", async () => {
		await click(header("users", "Tablice"));
		expect(names("users")).toEqual(["cleo", "ann", "bob"]); // 2, 5, 12, not "12", "2", "5"
		await click(header("users", "Ostatnia aktywność"));
		expect(names("users")).toEqual(["bob", "ann", "cleo"]);
		await click(header("users", "Rozmiar"));
		expect(names("users")).toEqual(["cleo", "ann", "bob"]);
	});

	test("is searched by name and by e-mail, in any letter case", async () => {
		const search = q<HTMLInputElement>("#view-users input[type=search]");
		await type(search, "CLE");
		expect(names("users")).toEqual(["cleo"]);
		await type(search, "bob@exa");
		expect(names("users")).toEqual(["bob"]);
		await type(search, "");
		expect(rows("users")).toHaveLength(3);
	});

	test("a user's name is changed in place, and a refusal is shown", async () => {
		const ann = rows("users").find((r) => r.textContent?.includes("ann@"))!;
		await click(button(ann, "Zmień nazwę"));
		const input = ann.querySelector("input") as HTMLInputElement;
		expect(input.value).toBe("ann");
		answers["POST /api/admin/users/1/rename"] = () => ({
			status: 409,
			body: { error: "Ta nazwa użytkownika jest zajęta" },
		});
		await type(input, "bob");
		await click(button(ann, "Zapisz"));
		expect(q("#error").textContent).toContain("zajęta");
		expect(ann.querySelector("input")).not.toBeNull(); // still editing
		answers["POST /api/admin/users/1/rename"] = () => ({ status: 204 });
		await type(ann.querySelector("input") as HTMLInputElement, "Ania.K");
		await click(button(ann, "Zapisz"));
		const call = calls
			.filter((c) => c.path === "/api/admin/users/1/rename")
			.pop()!;
		expect(call.method).toBe("POST");
		expect(call.body).toEqual({ username: "Ania.K" });
		expect(call.headers["X-Admin-Request"]).toBe("1");
		expect(names("users")).toContain("Ania.K");
	});

	test("a user is logged out everywhere", async () => {
		const bob = rows("users").find((r) => r.textContent?.includes("bob@"))!;
		await click(button(bob, "Wyloguj"));
		await click(button(bob, "Na pewno?")); // a second click confirms
		expect(
			calls.some(
				(c) => c.method === "POST" && c.path === "/api/admin/users/2/logout",
			),
		).toBe(true);
	});

	test("an account is deleted only after its name is typed", async () => {
		const cleo = rows("users").find((r) => r.textContent?.includes("cleo@"))!;
		await click(button(cleo, "Usuń"));
		const input = cleo.querySelector("input") as HTMLInputElement;
		const confirm = button(cleo, "Usuń konto");
		expect(confirm.disabled).toBe(true);
		await type(input, "cle");
		expect(confirm.disabled).toBe(true);
		await type(input, "cleo");
		expect(confirm.disabled).toBe(false);
		await click(confirm);
		const call = calls.find((c) => c.method === "DELETE")!;
		expect(call.path).toBe("/api/admin/users/3");
		expect(call.body).toEqual({ confirm: "cleo" });
		expect(names("users")).not.toContain("cleo");
	});

	test("the boards of a user are shown on the boards tab", async () => {
		const ann = rows("users").find((r) => r.textContent?.includes("ann@"))!;
		await click(button(ann, "Tablice"));
		expect(q("#view-boards").hasAttribute("hidden")).toBe(false);
		expect(names("boards").sort()).toEqual(
			["<img src=x onerror=window.__pwned=1>", "Matma"].sort(),
		);
		expect(q<HTMLInputElement>("#view-boards input[type=search]").value).toBe(
			"ann",
		);
	});
});

describe("boards", () => {
	beforeEach(async () => {
		await flush();
		await click(tab("boards"));
	});

	test("are listed with the latest change first", () => {
		expect(names("boards")).toEqual([
			"Fizyka",
			"Matma",
			"<img src=x onerror=window.__pwned=1>",
		]);
		const matma = cells(
			rows("boards").find((r) => r.textContent?.includes("Matma"))!,
		);
		expect(matma).toContain("ann");
		expect(matma).toContain("10");
	});

	test("what a board is called is text, never markup", () => {
		expect(all("#view-boards img")).toHaveLength(0);
		expect(
			(window as unknown as Record<string, unknown>).__pwned,
		).toBeUndefined();
	});

	test("are sorted and searched like the users", async () => {
		await click(header("boards", "Nazwa"));
		expect(names("boards")[0]).toBe("<img src=x onerror=window.__pwned=1>");
		await click(header("boards", "Elementy"));
		expect(names("boards")).toEqual([
			"<img src=x onerror=window.__pwned=1>",
			"Matma",
			"Fizyka",
		]);
		await type(q<HTMLInputElement>("#view-boards input[type=search]"), "ann");
		expect(rows("boards")).toHaveLength(2); // by owner too
		await type(q<HTMLInputElement>("#view-boards input[type=search]"), "fiz");
		expect(names("boards")).toEqual(["Fizyka"]);
	});

	test("a click on an owner shows only their boards", async () => {
		const owner = [...all<HTMLButtonElement>("#view-boards tbody button")].find(
			(b) => b.textContent === "bob",
		)!;
		await click(owner);
		expect(names("boards")).toEqual(["Fizyka"]);
		expect(q<HTMLInputElement>("#view-boards input[type=search]").value).toBe(
			"bob",
		);
	});

	test("a board is opened as the Administrator in a new tab", async () => {
		answers["POST /api/admin/boards/b1/enter"] = () => ({
			status: 200,
			body: { url: "/b/b1?admin=abc.def" },
		});
		const matma = rows("boards").find((r) => r.textContent?.includes("Matma"))!;
		await click(button(matma, "Otwórz"));
		expect(
			calls.some(
				(c) => c.method === "POST" && c.path === "/api/admin/boards/b1/enter",
			),
		).toBe(true);
		expect(window.open).toHaveBeenCalledWith(
			"/b/b1?admin=abc.def",
			"_blank",
			"noopener",
		);
	});

	test("a board is renamed in place", async () => {
		const matma = rows("boards").find((r) => r.textContent?.includes("Matma"))!;
		await click(button(matma, "Zmień nazwę"));
		await type(matma.querySelector("input") as HTMLInputElement, "Algebra");
		await click(button(matma, "Zapisz"));
		const call = calls.find((c) => c.path === "/api/admin/boards/b1/rename")!;
		expect(call.body).toEqual({ name: "Algebra" });
		expect(names("boards")).toContain("Algebra");
	});

	test("the owner is changed from a list of the users", async () => {
		const matma = rows("boards").find((r) => r.textContent?.includes("Matma"))!;
		await click(button(matma, "Zmień właściciela"));
		const select = matma.querySelector("select") as HTMLSelectElement;
		expect([...select.options].map((o) => o.textContent)).toEqual([
			"ann",
			"bob",
			"cleo",
		]);
		select.value = "3";
		select.dispatchEvent(new Event("change", { bubbles: true }));
		await click(button(matma, "Zapisz"));
		const call = calls.find((c) => c.path === "/api/admin/boards/b1/owner")!;
		expect(call.body).toEqual({ userId: 3 });
		expect(
			cells(rows("boards").find((r) => r.textContent?.includes("Matma"))!),
		).toContain("cleo");
	});

	test("a copy is made and the list is read again", async () => {
		answers["POST /api/admin/boards/b1/copy"] = () => ({
			status: 201,
			body: { id: "b9", name: "Matma (kopia)" },
		});
		const before = calls.filter((c) => c.path === "/api/admin/boards").length;
		const matma = rows("boards").find((r) => r.textContent?.includes("Matma"))!;
		await click(button(matma, "Kopia"));
		expect(calls.some((c) => c.path === "/api/admin/boards/b1/copy")).toBe(
			true,
		);
		expect(calls.filter((c) => c.path === "/api/admin/boards").length).toBe(
			before + 1,
		);
	});

	test("deleting needs a second click", async () => {
		const fizyka = rows("boards").find((r) =>
			r.textContent?.includes("Fizyka"),
		)!;
		await click(button(fizyka, "Usuń"));
		expect(calls.some((c) => c.method === "DELETE")).toBe(false);
		await click(button(fizyka, "Na pewno usunąć?"));
		expect(calls.find((c) => c.method === "DELETE")!.path).toBe(
			"/api/admin/boards/b2",
		);
		expect(names("boards")).not.toContain("Fizyka");
	});

	test("the link of a board is copied", async () => {
		const writeText = vi.fn(async () => {});
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		const matma = rows("boards").find((r) => r.textContent?.includes("Matma"))!;
		await click(button(matma, "Kopiuj link"));
		expect(writeText).toHaveBeenCalledWith(`${location.origin}/b/b1`);
	});
});

describe("errors", () => {
	test("a failed request is said in plain words and nothing is changed", async () => {
		await flush();
		await click(tab("boards"));
		answers["DELETE /api/admin/boards/b2"] = () => ({
			status: 500,
			body: { error: "Błąd serwera" },
		});
		const fizyka = rows("boards").find((r) =>
			r.textContent?.includes("Fizyka"),
		)!;
		await click(button(fizyka, "Usuń"));
		await click(button(fizyka, "Na pewno usunąć?"));
		expect(q("#error").hasAttribute("hidden")).toBe(false);
		expect(names("boards")).toContain("Fizyka");
	});
});
