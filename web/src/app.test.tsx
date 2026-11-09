import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "./app";
import type { SocketLike } from "./sync/sync";

const ID = "0123456789abcdef0123456789abcdef";

function fakeSocket(): SocketLike {
	return { send: vi.fn(), close: vi.fn(), onopen: null, onmessage: null, onclose: null };
}

describe("App", () => {
	let root: HTMLElement;

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
	});

	test("the home page creates a board and navigates to its link", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: ID }) });
		vi.stubGlobal("fetch", fetchMock);
		const navigate = vi.fn();
		render(<App path="/" navigate={navigate} />, root);

		await act(async () => {
			(root.querySelector("button") as HTMLButtonElement).click();
		});

		expect(fetchMock).toHaveBeenCalledWith("/api/boards", { method: "POST" });
		expect(navigate).toHaveBeenCalledWith(`/b/${ID}`);
	});

	test("a guest is asked for a name before entering a board, and the name is remembered", async () => {
		const createSocket = vi.fn(fakeSocket);
		render(<App path={`/b/${ID}`} createSocket={createSocket} />, root);
		expect(root.querySelector("canvas")).toBeNull();

		await act(async () => {
			const input = root.querySelector("input") as HTMLInputElement;
			input.value = "Ola";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			(root.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true }));
		});

		expect(localStorage.getItem("inkroom.name")).toBe("Ola");
		expect(root.querySelector("canvas")).not.toBeNull();
		expect(createSocket).toHaveBeenCalledOnce();
	});

	test("a board page with a remembered name connects to that board's websocket", () => {
		localStorage.setItem("inkroom.name", "Ola");
		const createSocket = vi.fn(fakeSocket);
		render(<App path={`/b/${ID}`} createSocket={createSocket} />, root);

		expect(root.querySelectorAll("canvas")).toHaveLength(2);
		expect(createSocket).toHaveBeenCalledWith(expect.stringContaining(`/ws/${ID}`));
	});
});
