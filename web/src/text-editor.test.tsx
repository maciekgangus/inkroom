import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TextEditor } from "./text-editor";

describe("TextEditor", () => {
	let root: HTMLElement;
	let onCommit: (text: string) => void;
	let onCancel: () => void;

	const field = () => root.querySelector("textarea") as HTMLTextAreaElement;
	const press = (key: string, shiftKey = false) => {
		const e = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
		field().dispatchEvent(e);
		return e;
	};

	beforeEach(async () => {
		root = document.createElement("div");
		document.body.append(root);
		onCommit = vi.fn();
		onCancel = vi.fn();
		await act(async () => {
			render(<TextEditor x={120} y={80} fontSize={30} color="#d32f2f" onCommit={onCommit} onCancel={onCancel} />, root);
		});
	});

	afterEach(() => {
		render(null, root);
		root.remove();
	});

	test("is placed at the given screen position with the given size and colour, and takes focus", () => {
		const style = field().style;
		expect([style.left, style.top, style.fontSize]).toEqual(["120px", "80px", "30px"]);
		expect(style.color).toBe("rgb(211, 47, 47)");
		expect(document.activeElement).toBe(field());
	});

	test("Enter commits the text", () => {
		field().value = "x^2 + 1";
		const e = press("Enter");
		expect(onCommit).toHaveBeenCalledWith("x^2 + 1");
		expect(e.defaultPrevented).toBe(true);
	});

	test("Shift+Enter inserts a new line instead of committing", () => {
		field().value = "a";
		const e = press("Enter", true);
		expect(onCommit).not.toHaveBeenCalled();
		expect(e.defaultPrevented).toBe(false);
	});

	test("Escape cancels", () => {
		field().value = "draft";
		press("Escape");
		expect(onCancel).toHaveBeenCalledOnce();
		expect(onCommit).not.toHaveBeenCalled();
	});

	test("losing focus commits the text", () => {
		field().value = "hello";
		field().dispatchEvent(new FocusEvent("blur"));
		expect(onCommit).toHaveBeenCalledWith("hello");
	});

	test("commits only once, even if Enter is followed by a blur", () => {
		field().value = "once";
		press("Enter");
		field().dispatchEvent(new FocusEvent("blur"));
		expect(onCommit).toHaveBeenCalledOnce();
	});

	test("cancelling then blurring does not commit", () => {
		field().value = "nope";
		press("Escape");
		field().dispatchEvent(new FocusEvent("blur"));
		expect(onCommit).not.toHaveBeenCalled();
	});
});
