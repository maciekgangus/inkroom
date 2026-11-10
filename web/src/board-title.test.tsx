import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { BoardTitle } from "./board-title";

describe("BoardTitle (R-045)", () => {
	let root: HTMLElement;
	let onRename: (name: string) => Promise<void>;

	const mount = (props: { name?: string; editable?: boolean } = {}) =>
		act(() =>
			render(
				<BoardTitle
					name={props.name ?? "Matma"}
					editable={props.editable ?? true}
					onRename={onRename}
				/>,
				root,
			),
		);
	const input = () => root.querySelector("input") as HTMLInputElement | null;
	const open = () =>
		act(() =>
			(root.querySelector(".board-title button") as HTMLElement).click(),
		);
	const type = (value: string) =>
		act(() => {
			const i = input() as HTMLInputElement;
			i.value = value;
			i.dispatchEvent(new Event("input", { bubbles: true }));
		});
	const key = (k: string) =>
		act(() => {
			input()?.dispatchEvent(
				new KeyboardEvent("keydown", { key: k, bubbles: true }),
			);
		});
	const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

	beforeEach(() => {
		root = document.createElement("div");
		document.body.replaceChildren(root);
		onRename = vi.fn(async () => {});
	});

	test("shows the name of the board", () => {
		mount({ name: "Lekcja 5" });
		expect(root.textContent).toContain("Lekcja 5");
		expect(root.querySelector(".board-title")).not.toBeNull();
	});

	test("a guest or participant only reads it: there is nothing to click", () => {
		mount({ editable: false });
		expect(root.querySelector("button")).toBeNull();
		expect(input()).toBeNull();
		expect(root.textContent).toContain("Matma");
	});

	test("the owner clicks the name and gets a field with it", () => {
		mount();
		open();
		expect(input()?.value).toBe("Matma");
		expect(input()?.maxLength).toBe(100); // the same limit as on the server
	});

	test("Enter saves the new name, trimmed, and the field closes", async () => {
		mount();
		open();
		type("  Lekcja 6  ");
		key("Enter");
		await flush();
		expect(onRename).toHaveBeenCalledWith("Lekcja 6");
		expect(input()).toBeNull();
	});

	test("leaving the field saves it too", async () => {
		mount();
		open();
		type("Fizyka");
		act(() => {
			input()?.dispatchEvent(new Event("blur"));
		});
		await flush();
		expect(onRename).toHaveBeenCalledWith("Fizyka");
	});

	test("Escape throws the change away", async () => {
		mount();
		open();
		type("Coś innego");
		key("Escape");
		await flush();
		expect(onRename).not.toHaveBeenCalled();
		expect(input()).toBeNull();
		expect(root.textContent).toContain("Matma");
	});

	test("an empty or unchanged name is not sent", async () => {
		mount();
		open();
		type("   ");
		key("Enter");
		await flush();
		open();
		type("Matma");
		key("Enter");
		await flush();
		expect(onRename).not.toHaveBeenCalled();
	});

	test("when saving fails the old name comes back and the owner is told", async () => {
		onRename = vi.fn(async () => {
			throw new Error("boom");
		});
		mount();
		open();
		type("Nowa");
		key("Enter");
		await flush();
		expect(root.textContent).toContain("Matma");
		expect(root.querySelector('[role="alert"]')).not.toBeNull();
	});

	test("a name that arrives from outside replaces the shown one", () => {
		mount({ name: "Matma" });
		mount({ name: "Lekcja 7" });
		expect(root.textContent).toContain("Lekcja 7");
	});
});
