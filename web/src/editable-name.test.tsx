import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EditableName } from "./editable-name";

describe("EditableName (R-113)", () => {
	let root: HTMLElement;
	const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
	const input = () => root.querySelector("input") as HTMLInputElement | null;
	const edit = () =>
		root.querySelector("button.name-edit") as HTMLButtonElement;
	const type = (v: string) =>
		act(() => {
			const i = input() as HTMLInputElement;
			i.value = v;
			i.dispatchEvent(new Event("input", { bubbles: true }));
		});
	const key = (k: string) =>
		act(() => {
			input()?.dispatchEvent(
				new KeyboardEvent("keydown", { key: k, bubbles: true }),
			);
		});

	beforeEach(() => {
		root = document.createElement("div");
		document.body.append(root);
	});
	afterEach(() => {
		act(() => render(null, root));
		root.remove();
	});

	test("for everyone but the owner it is only the name", () => {
		act(() =>
			render(
				<EditableName name="Lekcja 1" editable={false} onSave={vi.fn()} />,
				root,
			),
		);
		expect(root.textContent).toBe("Lekcja 1");
		expect(edit()).toBeNull();
	});

	test("the owner presses the pen, types a name and Enter saves it trimmed", async () => {
		const onSave = vi.fn().mockResolvedValue(undefined);
		act(() =>
			render(<EditableName name="Lekcja 1" editable onSave={onSave} />, root),
		);
		act(() => edit().click());
		expect(input()?.value).toBe("Lekcja 1");
		type("  Ułamki  ");
		key("Enter");
		await flush();
		expect(onSave).toHaveBeenCalledWith("Ułamki");
		expect(input()).toBeNull();
	});

	test("the new name shows at once, while it is still being saved", async () => {
		let done: () => void = () => {};
		const onSave = vi
			.fn()
			.mockReturnValue(new Promise<void>((r) => (done = r)));
		act(() =>
			render(<EditableName name="Lekcja 1" editable onSave={onSave} />, root),
		);
		act(() => edit().click());
		type("Nowa");
		key("Enter");
		await flush();
		expect(root.textContent).toContain("Nowa");
		done();
		await flush();
	});

	test("Escape throws the change away", async () => {
		const onSave = vi.fn();
		act(() =>
			render(<EditableName name="Lekcja 1" editable onSave={onSave} />, root),
		);
		act(() => edit().click());
		type("Coś innego");
		key("Escape");
		await flush();
		expect(onSave).not.toHaveBeenCalled();
		expect(root.textContent).toContain("Lekcja 1");
	});

	test("an empty or unchanged name is not sent", async () => {
		const onSave = vi.fn();
		act(() =>
			render(<EditableName name="Lekcja 1" editable onSave={onSave} />, root),
		);
		act(() => edit().click());
		type("   ");
		key("Enter");
		await flush();
		act(() => edit().click());
		key("Enter"); // unchanged
		await flush();
		expect(onSave).not.toHaveBeenCalled();
	});

	test("leaving the field saves it", async () => {
		const onSave = vi.fn().mockResolvedValue(undefined);
		act(() =>
			render(<EditableName name="Lekcja 1" editable onSave={onSave} />, root),
		);
		act(() => edit().click());
		type("Nowa");
		act(() => {
			input()?.dispatchEvent(new FocusEvent("blur"));
		});
		await flush();
		expect(onSave).toHaveBeenCalledWith("Nowa");
	});

	test("a refused name keeps the old one and says so", async () => {
		const onSave = vi.fn().mockRejectedValue(new Error("no"));
		act(() =>
			render(<EditableName name="Lekcja 1" editable onSave={onSave} />, root),
		);
		act(() => edit().click());
		type("Nowa");
		key("Enter");
		await flush();
		expect(root.textContent).toContain("Lekcja 1");
		expect(root.querySelector("[role='alert']")?.textContent).toBe(
			"Nie udało się zmienić nazwy",
		);
	});

	test("the field takes at most 100 characters, like the server", () => {
		act(() =>
			render(<EditableName name="a" editable onSave={vi.fn()} />, root),
		);
		act(() => edit().click());
		expect(input()?.maxLength).toBe(100);
	});
});
