import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MarkdownTextEditor } from "./markdown-text-editor";

describe("MarkdownTextEditor", () => {
	let root: HTMLElement;
	let onCommit: (text: string) => void;
	let onCancel: () => void;

	const field = () => root.querySelector("textarea") as HTMLTextAreaElement;
	const toolbar = () => root.querySelector(".markdown-toolbar");
	const helpButton = () =>
		root.querySelector(".markdown-help-btn") as HTMLButtonElement;

	beforeEach(async () => {
		root = document.createElement("div");
		// Make it large enough to contain the editor
		root.style.width = "1000px";
		root.style.height = "1000px";
		root.style.position = "relative";
		document.body.append(root);
		onCommit = vi.fn();
		onCancel = vi.fn();
		await act(async () => {
			render(
				<MarkdownTextEditor
					x={120}
					y={80}
					fontSize={30}
					color="#d32f2f"
					onCommit={onCommit}
					onCancel={onCancel}
				/>,
				root,
			);
		});
	});

	afterEach(() => {
		render(null, root);
		root.remove();
	});

	test("renders textarea with correct position and size", () => {
		const textarea = field();
		expect(textarea).toBeTruthy();

		const style = textarea.style;
		expect(style.left).toBe("120px");
		expect(style.top).toBe("80px");
		expect(style.fontSize).toBe("30px");
		expect(style.color).toBe("rgb(211, 47, 47)");
	});

	test("renders markdown toolbar above editor", () => {
		const toolbarEl = toolbar() as HTMLElement;
		expect(toolbarEl).toBeTruthy();

		const style = toolbarEl.style;
		expect(style.left).toBe("120px");
		expect(style.top).toBe("44px"); // y - 36
	});

	test("renders help button next to editor", () => {
		const helpBtn = helpButton();
		expect(helpBtn).toBeTruthy();

		const style = helpBtn.style;
		// Should be positioned to the right of the editor
		expect(parseInt(style.left, 10)).toBeGreaterThan(120);
		expect(style.top).toBe("80px");
	});

	test("toolbar has all formatting buttons", () => {
		const buttons = toolbar()?.querySelectorAll(".markdown-toolbar-btn") ?? [];
		expect(buttons.length).toBe(7); // B, I, S, code, list, H1, H2

		const boldBtn = Array.from(buttons).find((b) =>
			b.textContent?.includes("B"),
		);
		const italicBtn = Array.from(buttons).find((b) =>
			b.textContent?.includes("I"),
		);
		const strikethroughBtn = Array.from(buttons).find((b) =>
			b.textContent?.includes("S"),
		);
		const codeBtn = Array.from(buttons).find((b) =>
			b.textContent?.includes("`"),
		);
		const listBtn = Array.from(buttons).find((b) =>
			b.textContent?.includes("-"),
		);

		expect(boldBtn).toBeTruthy();
		expect(italicBtn).toBeTruthy();
		expect(strikethroughBtn).toBeTruthy();
		expect(codeBtn).toBeTruthy();
		expect(listBtn).toBeTruthy();
	});

	test("bold button wraps selected text with **", async () => {
		const textarea = field();
		await act(async () => {
			textarea.value = "test text";
			textarea.selectionStart = 0;
			textarea.selectionEnd = 4;
		});

		const boldBtn = toolbar()?.querySelectorAll(".markdown-toolbar-btn")[0];
		act(() => {
			boldBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(textarea.value).toBe("**test** text");
		expect(textarea.selectionStart).toBe(2);
		expect(textarea.selectionEnd).toBe(6);
	});

	test("italic button wraps selected text with *", async () => {
		const textarea = field();
		await act(async () => {
			textarea.value = "test text";
			textarea.selectionStart = 5;
			textarea.selectionEnd = 9;
		});

		const italicBtn = toolbar()?.querySelectorAll(".markdown-toolbar-btn")[1];
		act(() => {
			italicBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(textarea.value).toBe("test *text*");
	});

	test("format button inserts tags at cursor when no selection", async () => {
		const textarea = field();
		await act(async () => {
			textarea.value = "test";
			textarea.selectionStart = 2;
			textarea.selectionEnd = 2;
		});

		const boldBtn = toolbar()?.querySelectorAll(".markdown-toolbar-btn")[0];
		act(() => {
			boldBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(textarea.value).toBe("te****st");
		expect(textarea.selectionStart).toBe(4);
		expect(textarea.selectionEnd).toBe(4);
	});

	test("keyboard shortcuts work for formatting", async () => {
		const textarea = field();

		// Test Ctrl+B for bold
		await act(async () => {
			textarea.value = "test";
			textarea.selectionStart = 0;
			textarea.selectionEnd = 4;
		});

		act(() => {
			const event = new KeyboardEvent("keydown", {
				key: "b",
				ctrlKey: true,
				bubbles: true,
				cancelable: true,
			});
			textarea.dispatchEvent(event);
		});

		expect(textarea.value).toBe("**test**");

		// Test Ctrl+I for italic
		await act(async () => {
			textarea.value = "test";
			textarea.selectionStart = 0;
			textarea.selectionEnd = 4;
		});

		act(() => {
			const event = new KeyboardEvent("keydown", {
				key: "i",
				ctrlKey: true,
				bubbles: true,
				cancelable: true,
			});
			textarea.dispatchEvent(event);
		});

		expect(textarea.value).toBe("*test*");
	});

	test("committing text calls onCommit with the text", () => {
		const textarea = field();
		textarea.value = "hello world";

		act(() => {
			const event = new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			});
			textarea.dispatchEvent(event);
		});

		expect(onCommit).toHaveBeenCalledWith("hello world");
	});

	test("cancel button calls onCancel", () => {
		const textarea = field();

		act(() => {
			const event = new KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true,
			});
			textarea.dispatchEvent(event);
		});

		expect(onCancel).toHaveBeenCalled();
	});

	test("list button inserts list item", async () => {
		const textarea = field();
		await act(async () => {
			textarea.value = "";
			textarea.selectionStart = 0;
			textarea.selectionEnd = 0;
		});

		const listBtn = toolbar()?.querySelectorAll(".markdown-toolbar-btn")[4]; // 5th button
		act(() => {
			listBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(textarea.value).toBe("- ");
	});

	test("H1 button adds # at line start", async () => {
		const textarea = field();
		await act(async () => {
			textarea.value = "Nagłówek";
			textarea.selectionStart = 0;
			textarea.selectionEnd = 0;
		});

		const h1Btn = toolbar()?.querySelectorAll(".markdown-toolbar-btn")[5]; // 6th button
		act(() => {
			h1Btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(textarea.value).toBe("# Nagłówek");
	});

	test("H2 button adds ## at line start", async () => {
		const textarea = field();
		await act(async () => {
			textarea.value = "Podnagłówek";
			textarea.selectionStart = 0;
			textarea.selectionEnd = 0;
		});

		const h2Btn = toolbar()?.querySelectorAll(".markdown-toolbar-btn")[6]; // 7th button
		act(() => {
			h2Btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(textarea.value).toBe("## Podnagłówek");
	});

	describe("with initial text", () => {
		beforeEach(async () => {
			await act(async () => {
				render(
					<MarkdownTextEditor
						x={0}
						y={0}
						fontSize={20}
						color="#000"
						initialText="initial text"
						onCommit={onCommit}
						onCancel={onCancel}
					/>,
					root,
				);
			});
		});

		test("starts with initial text", () => {
			expect(field().value).toBe("initial text");
		});
	});

	describe("as an area", () => {
		beforeEach(async () => {
			await act(async () => {
				render(
					<MarkdownTextEditor
						x={120}
						y={80}
						fontSize={30}
						color="#d32f2f"
						width={300}
						minHeight={90}
						onCommit={onCommit}
						onCancel={onCancel}
					/>,
					root,
				);
			});
		});

		test("textarea has width and minHeight", () => {
			const textarea = field();
			const style = textarea.style;
			expect(style.width).toBe("300px");
			expect(style.minHeight).toBe("90px");
		});

		test("Enter inserts newline instead of committing", () => {
			const textarea = field();
			textarea.value = "line1";

			act(() => {
				const event = new KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
				});
				textarea.dispatchEvent(event);
			});

			// Should not have committed
			expect(onCommit).not.toHaveBeenCalled();
		});

		test("Ctrl+Enter commits the text", () => {
			const textarea = field();
			textarea.value = "hello";

			act(() => {
				const event = new KeyboardEvent("keydown", {
					key: "Enter",
					ctrlKey: true,
					bubbles: true,
					cancelable: true,
				});
				textarea.dispatchEvent(event);
			});

			expect(onCommit).toHaveBeenCalledWith("hello");
		});
	});
});
