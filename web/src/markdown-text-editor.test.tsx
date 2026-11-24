import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MarkdownTextEditor } from "./markdown-text-editor";
import { stepSize, type TextFormat } from "./text-toolbar";

describe("MarkdownTextEditor (R-101, R-102)", () => {
	let root: HTMLElement;
	let onCommit: (text: string) => void;
	let onCancel: () => void;

	const field = () => root.querySelector("textarea") as HTMLTextAreaElement;
	const toolbar = () => root.querySelector(".text-toolbar") as HTMLElement;
	const button = (label: string) =>
		root.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
	const click = async (el: Element) => {
		await act(async () => {
			(el as HTMLElement).click();
		});
	};
	/** Puts a text in the field and selects `from..to`, as the person would. */
	const select = (value: string, from: number, to = from) => {
		const f = field();
		f.value = value;
		f.focus();
		f.setSelectionRange(from, to);
	};

	const mount = async (props: Record<string, unknown> = {}) => {
		await act(async () => {
			render(
				<MarkdownTextEditor
					x={120}
					y={160}
					fontSize={30}
					color="#d32f2f"
					onCommit={onCommit}
					onCancel={onCancel}
					{...props}
				/>,
				root,
			);
		});
	};

	beforeEach(async () => {
		root = document.createElement("div");
		document.body.append(root);
		onCommit = vi.fn();
		onCancel = vi.fn();
		await mount();
	});

	afterEach(() => {
		render(null, root);
		root.remove();
	});

	test("the field is where the text is, in the font of the text", async () => {
		expect(field().style.left).toBe("120px");
		expect(field().style.top).toBe("160px");
		expect(field().style.fontSize).toBe("30px");
		await mount({ font: "mono" });
		expect(field().style.fontFamily).toContain("JetBrains Mono");
	});

	test("the toolbar is over the field and has the formatting buttons", () => {
		expect(toolbar().getAttribute("role")).toBe("toolbar");
		expect(toolbar().classList.contains("above")).toBe(true);
		for (const label of [
			"Pogrubienie (Ctrl+B)",
			"Kursywa (Ctrl+I)",
			"Przekreślenie (Ctrl+D)",
			"Kod (Ctrl+E)",
			"Styl wiersza",
			"Lista punktowana",
			"Lista numerowana",
			"Cytat",
			"Ściąga Markdown",
		])
			expect(button(label), label).toBeTruthy();
	});

	test("the toolbar goes under the field when there is no room over it", async () => {
		await mount({ y: 20 });
		expect(toolbar().classList.contains("below")).toBe(true);
	});

	test("bold, italic, strike and code wrap the selected text", async () => {
		for (const [label, text] of [
			["Pogrubienie (Ctrl+B)", "ala **ma** kota"],
			["Kursywa (Ctrl+I)", "ala *ma* kota"],
			["Przekreślenie (Ctrl+D)", "ala ~~ma~~ kota"],
			["Kod (Ctrl+E)", "ala `ma` kota"],
		]) {
			select("ala ma kota", 4, 6);
			await click(button(label));
			expect(field().value, label).toBe(text);
		}
	});

	test("a button is pressed while the cursor is in that format, and a second press undoes it", async () => {
		select("ala ma kota", 4, 6);
		await click(button("Pogrubienie (Ctrl+B)"));
		expect(button("Pogrubienie (Ctrl+B)").getAttribute("aria-pressed")).toBe(
			"true",
		);
		expect(button("Kursywa (Ctrl+I)").getAttribute("aria-pressed")).toBe(
			"false",
		);
		await click(button("Pogrubienie (Ctrl+B)"));
		expect(field().value).toBe("ala ma kota");
	});

	test("with no selection the word under the cursor is formatted", async () => {
		select("ala ma kota", 5);
		await click(button("Pogrubienie (Ctrl+B)"));
		expect(field().value).toBe("ala **ma** kota");
	});

	test("Ctrl+B and Ctrl+I work from the keyboard", async () => {
		select("ala ma kota", 4, 6);
		await act(async () => {
			field().dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "b",
					ctrlKey: true,
					bubbles: true,
				}),
			);
		});
		expect(field().value).toBe("ala **ma** kota");
		select("ala ma kota", 0, 3);
		await act(async () => {
			field().dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "i",
					metaKey: true,
					bubbles: true,
				}),
			);
		});
		expect(field().value).toBe("*ala* ma kota");
	});

	test("the style menu makes the line a heading, and Tekst takes it away", async () => {
		select("ala", 1);
		await click(button("Styl wiersza"));
		const h1 = [...root.querySelectorAll("[role=option]")].find(
			(o) => o.textContent === "Nagłówek 1",
		) as HTMLElement;
		await click(h1);
		expect(field().value).toBe("# ala");
		expect(root.querySelector("[role=listbox]")).toBeNull(); // the menu closed
		expect(button("Styl wiersza").textContent).toContain("Nagłówek 1");
		await click(button("Styl wiersza"));
		const plain = [...root.querySelectorAll("[role=option]")].find(
			(o) => o.textContent === "Tekst",
		) as HTMLElement;
		await click(plain);
		expect(field().value).toBe("ala");
	});

	test("the list and quote buttons mark every selected line", async () => {
		select("a\nb", 0, 3);
		await click(button("Lista punktowana"));
		expect(field().value).toBe("- a\n- b");
		await click(button("Lista numerowana"));
		expect(field().value).toBe("1. a\n2. b");
		await click(button("Cytat"));
		expect(field().value).toBe("> a\n> b");
	});

	test("Enter at the end of a list item starts the next one, in an area", async () => {
		await mount({ width: 300 });
		select("- a", 3);
		const e = new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		});
		await act(async () => {
			field().dispatchEvent(e);
		});
		expect(e.defaultPrevented).toBe(true);
		expect(field().value).toBe("- a\n- ");
		expect(field().selectionStart).toBe(field().value.length);
	});

	test("Enter outside a list is left alone", async () => {
		await mount({ width: 300 });
		select("abc", 3);
		const e = new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		});
		await act(async () => {
			field().dispatchEvent(e);
		});
		expect(e.defaultPrevented).toBe(false);
	});

	test("the cheat sheet opens and closes", async () => {
		await click(button("Ściąga Markdown"));
		expect(root.querySelector(".tb-menu.help")?.textContent).toContain(
			"**tekst**",
		);
		await click(button("Ściąga Markdown"));
		expect(root.querySelector(".tb-menu.help")).toBeNull();
	});

	test("pressing the toolbar does not take the focus from the text", async () => {
		const e = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
		button("Kursywa (Ctrl+I)").dispatchEvent(e);
		expect(e.defaultPrevented).toBe(true);
	});

	test("moving to the toolbar does not end the text, leaving does", async () => {
		await mount({ initialText: "ala" });
		await act(async () => {
			field().dispatchEvent(
				new FocusEvent("blur", {
					relatedTarget: button("Kursywa (Ctrl+I)"),
				}),
			);
		});
		expect(onCommit).not.toHaveBeenCalled();
		await act(async () => {
			field().dispatchEvent(new FocusEvent("blur"));
		});
		expect(onCommit).toHaveBeenCalledWith("ala");
	});

	test("Ctrl+Enter keeps the text of an area", async () => {
		await mount({ width: 300, initialText: "ala" });
		await act(async () => {
			field().dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Enter",
					ctrlKey: true,
					bubbles: true,
				}),
			);
		});
		expect(onCommit).toHaveBeenCalledWith("ala");
	});
});

describe("the toolbar's font, size and colour (R-101)", () => {
	let root: HTMLElement;
	const format = (): TextFormat => ({
		font: "sans",
		size: 24,
		color: "#111111",
		colors: ["#111111", "#d32f2f", "#1976d2", "#388e3c", "#f57c00"],
		display: (c) => c,
		onFont: vi.fn(),
		onSize: vi.fn(),
		onColor: vi.fn(),
	});
	const button = (label: string) =>
		root.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
	const click = async (el: Element) => {
		await act(async () => {
			(el as HTMLElement).click();
		});
	};
	const mount = async (f: TextFormat | undefined) => {
		await act(async () => {
			render(
				<MarkdownTextEditor
					x={120}
					y={160}
					fontSize={24}
					color="#111"
					format={f}
					onCommit={vi.fn()}
					onCancel={vi.fn()}
				/>,
				root,
			);
		});
	};

	beforeEach(() => {
		root = document.createElement("div");
		document.body.append(root);
	});
	afterEach(() => {
		render(null, root);
		root.remove();
	});

	test("without a format there is no font, size or colour, only the formatting", async () => {
		await mount(undefined);
		expect(button("Czcionka")).toBeNull();
		expect(button("Rozmiar czcionki")).toBeNull();
		expect(button("Kolor tekstu")).toBeNull();
		expect(button("Kursywa (Ctrl+I)")).toBeTruthy();
	});

	test("the font list shows each font in its own face and picks one", async () => {
		const f = format();
		await mount(f);
		expect(button("Czcionka").textContent).toContain("Inter");
		await click(button("Czcionka"));
		const items = [...root.querySelectorAll<HTMLElement>("[role=option]")];
		expect(items.map((i) => i.textContent)).toEqual([
			"Inter",
			"Lora",
			"Caveat",
			"JetBrains Mono",
		]);
		expect(items[2].style.fontFamily).toContain("Caveat");
		await click(items[2]);
		expect(f.onFont).toHaveBeenCalledWith("hand");
		expect(root.querySelector("[role=listbox]")).toBeNull();
	});

	test("the size has minus, plus and a list of sizes", async () => {
		const f = format();
		await mount(f);
		expect(button("Rozmiar czcionki").textContent).toContain("24");
		await click(button("Zwiększ rozmiar"));
		expect(f.onSize).toHaveBeenLastCalledWith(28);
		await click(button("Zmniejsz rozmiar"));
		expect(f.onSize).toHaveBeenLastCalledWith(20);
		await click(button("Rozmiar czcionki"));
		const sizes = [...root.querySelectorAll<HTMLElement>("[role=option]")];
		expect(sizes.map((s) => s.textContent)).toContain("72");
		await click(sizes.find((s) => s.textContent === "48") as HTMLElement);
		expect(f.onSize).toHaveBeenLastCalledWith(48);
	});

	test("the colour button shows the colour and opens the palette", async () => {
		const f = format();
		await mount(f);
		const bar = root.querySelector(".tb-bar") as HTMLElement;
		expect(bar.style.background).toBeTruthy();
		await click(button("Kolor tekstu"));
		const red = root.querySelector(
			'[aria-label="text color #d32f2f"]',
		) as HTMLElement;
		expect(red).toBeTruthy();
		await click(red);
		expect(f.onColor).toHaveBeenCalledWith("#d32f2f");
	});

	test("a press outside the toolbar closes its menu", async () => {
		await mount(format());
		await click(button("Czcionka"));
		expect(root.querySelector("[role=listbox]")).not.toBeNull();
		await act(async () => {
			document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
		});
		expect(root.querySelector("[role=listbox]")).toBeNull();
	});
});

describe("stepSize", () => {
	test("goes along the list of sizes, and stops at its ends", () => {
		expect(stepSize(24, 1)).toBe(28);
		expect(stepSize(24, -1)).toBe(20);
		expect(stepSize(61, 1)).toBe(64);
		expect(stepSize(61, -1)).toBe(56);
		expect(stepSize(96, 1)).toBe(96);
		expect(stepSize(8, -1)).toBe(8);
	});
});

describe("the grip that widens the field (R-101)", () => {
	let root: HTMLElement;
	beforeEach(() => {
		root = document.createElement("div");
		document.body.append(root);
		// jsdom has no pointer capture: the grip asks the element for it.
		const held = new Set<number>();
		HTMLElement.prototype.setPointerCapture = (id: number) => {
			held.add(id);
		};
		HTMLElement.prototype.hasPointerCapture = (id: number) => held.has(id);
		HTMLElement.prototype.releasePointerCapture = (id: number) => {
			held.delete(id);
		};
	});
	afterEach(() => {
		render(null, root);
		root.remove();
	});

	test("dragging it reports the new width, and the last one as final", async () => {
		const onWidth = vi.fn();
		await act(async () => {
			render(
				<MarkdownTextEditor
					x={100}
					y={160}
					fontSize={24}
					color="#111"
					width={200}
					onWidth={onWidth}
					onCommit={vi.fn()}
					onCancel={vi.fn()}
				/>,
				root,
			);
		});
		const grip = root.querySelector(".text-grip") as HTMLElement;
		expect(grip.style.left).toBe("293px"); // the right edge, 100 + 200, less half the grip
		const ev = (type: string, clientX: number) => {
			const e = new MouseEvent(type, {
				bubbles: true,
				cancelable: true,
				clientX,
			});
			Object.defineProperty(e, "pointerId", { value: 1 });
			return e;
		};
		await act(async () => {
			grip.dispatchEvent(ev("pointerdown", 300));
			grip.dispatchEvent(ev("pointermove", 400));
		});
		expect(onWidth).toHaveBeenLastCalledWith(300, false);
		await act(async () => {
			grip.dispatchEvent(ev("pointerup", 450));
		});
		expect(onWidth).toHaveBeenLastCalledWith(350, true);
	});

	test("it is never narrower than a few letters", async () => {
		const onWidth = vi.fn();
		await act(async () => {
			render(
				<MarkdownTextEditor
					x={100}
					y={160}
					fontSize={24}
					color="#111"
					width={200}
					onWidth={onWidth}
					onCommit={vi.fn()}
					onCancel={vi.fn()}
				/>,
				root,
			);
		});
		const grip = root.querySelector(".text-grip") as HTMLElement;
		const down = new MouseEvent("pointerdown", { bubbles: true });
		Object.defineProperty(down, "pointerId", { value: 1 });
		const move = new MouseEvent("pointermove", { bubbles: true, clientX: 10 });
		Object.defineProperty(move, "pointerId", { value: 1 });
		await act(async () => {
			grip.dispatchEvent(down);
			grip.dispatchEvent(move);
		});
		expect(onWidth).toHaveBeenLastCalledWith(60, false);
	});

	test("there is no grip when the width cannot be changed", async () => {
		await act(async () => {
			render(
				<MarkdownTextEditor
					x={100}
					y={160}
					fontSize={24}
					color="#111"
					onCommit={vi.fn()}
					onCancel={vi.fn()}
				/>,
				root,
			);
		});
		expect(root.querySelector(".text-grip")).toBeNull();
	});
});
