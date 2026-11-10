import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Settings } from "./board/controller";
import { setTheme } from "./theme";
import { COLORS, MORE_COLORS, SIZES, Toolbar } from "./toolbar";

describe("Toolbar", () => {
	let root: HTMLElement;
	let settings: Settings;
	let onUndo: () => void;
	let onRedo: () => void;

	beforeEach(() => {
		root = document.createElement("div");
		settings = { tool: "pen", color: COLORS[0], size: SIZES[1] };
		onUndo = vi.fn();
		onRedo = vi.fn();
		act(() =>
			render(
				<Toolbar settings={settings} onUndo={onUndo} onRedo={onRedo} />,
				root,
			),
		);
	});

	const click = (label: string) =>
		(root.querySelector(`[aria-label="${label}"]`) as HTMLElement).click();

	test("has 5 colors and 3 sizes", () => {
		expect(COLORS).toHaveLength(5);
		expect(SIZES).toHaveLength(3);
	});

	test("tool buttons show an icon and a Polish tooltip instead of a text label", () => {
		const pen = root.querySelector('[aria-label="pen"]') as HTMLElement;
		expect(pen.querySelector("svg")).not.toBeNull();
		expect(pen.textContent).toBe("");
		expect(pen.title).toBe("Pióro (F)");
		expect(root.querySelector('[aria-label="undo"] svg')).not.toBeNull();
	});

	test("the chosen tool, colour and size are marked as pressed", () => {
		const pressed = () =>
			[...root.querySelectorAll('[aria-pressed="true"]')].map((b) =>
				b.getAttribute("aria-label"),
			);
		expect(pressed()).toEqual([
			"pen",
			`color ${COLORS[0]}`,
			`size ${SIZES[1]}`,
		]);
		act(() => click("eraser"));
		expect(pressed()).toEqual(["eraser", `size ${SIZES[1]}`]);
	});

	describe("extended palette", () => {
		const q = (label: string) =>
			root.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;

		test("the extra colours stay hidden until the palette is opened", () => {
			expect(MORE_COLORS).toHaveLength(12);
			expect(q(`color ${MORE_COLORS[0]}`)).toBeNull();
			act(() => click("more colors"));
			for (const c of MORE_COLORS) expect(q(`color ${c}`)).not.toBeNull();
			expect(q("custom color")?.getAttribute("type")).toBe("color");
		});

		test("picking an extra colour sets it, closes the palette and marks the palette button", () => {
			act(() => click("more colors"));
			act(() => click(`color ${MORE_COLORS[3]}`));
			expect(settings.color).toBe(MORE_COLORS[3]);
			expect(q(`color ${MORE_COLORS[3]}`)).toBeNull();
			expect(q("more colors")?.getAttribute("aria-pressed")).toBe("true");
			expect(q(`color ${COLORS[0]}`)?.getAttribute("aria-pressed")).toBe(
				"false",
			);
		});

		test("the picker sets any colour and goes back to the pen from the eraser", () => {
			click("eraser");
			act(() => click("more colors"));
			const input = q("custom color") as HTMLInputElement;
			input.value = "#123456";
			act(() => {
				input.dispatchEvent(new Event("input", { bubbles: true }));
			});
			expect(settings.color).toBe("#123456");
			expect(settings.tool).toBe("pen");
		});
	});

	test("in dark mode the black swatch is shown as white (the stored colour stays black)", () => {
		act(() => setTheme("dark"));
		const black = root.querySelector(
			`[aria-label="color ${COLORS[0]}"]`,
		) as HTMLElement;
		expect(black.style.background).toMatch(/#ffffff|rgb\(255, 255, 255\)/);
		act(() => black.click());
		expect(settings.color).toBe(COLORS[0]);
		act(() => setTheme("light"));
	});

	test("eraser and pen buttons switch the tool", () => {
		click("eraser");
		expect(settings.tool).toBe("eraser");
		click("pen");
		expect(settings.tool).toBe("pen");
	});

	test("the hand button switches to panning", () => {
		click("pan");
		expect(settings.tool).toBe("pan");
		click(`color ${COLORS[1]}`);
		expect(settings.tool).toBe("pen");
	});

	test("shape and text buttons select their tools", () => {
		for (const tool of ["line", "shape", "text"] as const) {
			click(tool);
			expect(settings.tool).toBe(tool);
		}
	});

	test("picking a colour keeps a shape or text tool, but leaves the eraser and the hand", () => {
		click("shape");
		click(`color ${COLORS[3]}`);
		expect(settings.tool).toBe("shape");
		expect(settings.color).toBe(COLORS[3]);
		click("text");
		click(`color ${COLORS[1]}`);
		expect(settings.tool).toBe("text");
		click("eraser");
		click(`color ${COLORS[2]}`);
		expect(settings.tool).toBe("pen");
	});

	test("color buttons set the color and switch back to the pen", () => {
		click("eraser");
		click(`color ${COLORS[2]}`);
		expect(settings.color).toBe(COLORS[2]);
		expect(settings.tool).toBe("pen");
	});

	test("size buttons set the size", () => {
		click(`size ${SIZES[2]}`);
		expect(settings.size).toBe(SIZES[2]);
	});

	test("undo and redo buttons call the handlers", () => {
		click("undo");
		click("redo");
		expect(onUndo).toHaveBeenCalledOnce();
		expect(onRedo).toHaveBeenCalledOnce();
	});

	test("hides colour and size while something is selected, the properties panel owns them", () => {
		expect(root.querySelector('[aria-label="size 5"]')).not.toBeNull();
		act(() =>
			render(
				<Toolbar
					settings={settings}
					hasSelection
					onUndo={onUndo}
					onRedo={onRedo}
				/>,
				root,
			),
		);
		expect(root.querySelector('[aria-label^="color "]')).toBeNull();
		expect(root.querySelector('[aria-label="more colors"]')).toBeNull();
		expect(root.querySelector('[aria-label="size 5"]')).toBeNull();
		expect(root.querySelector('[aria-label="select"]')).not.toBeNull();
		expect(root.querySelector('[aria-label="undo"]')).not.toBeNull();
	});

	test("shows the image group before undo and redo when given one", () => {
		expect(root.querySelector('[aria-label="add image"]')).toBeNull();
		act(() =>
			render(
				<Toolbar
					settings={settings}
					images={{
						fine: true,
						hasSelection: false,
						canPaste: false,
						onFile: vi.fn(),
						onPaste: vi.fn(),
						onDelete: vi.fn(),
					}}
					onUndo={onUndo}
					onRedo={onRedo}
				/>,
				root,
			),
		);
		const labels = Array.from(root.querySelectorAll("button")).map((b) =>
			b.getAttribute("aria-label"),
		);
		expect(labels.indexOf("add image")).toBeGreaterThan(-1);
		expect(labels.indexOf("add image")).toBeLessThan(labels.indexOf("undo"));
	});

	test("every tool with a shortcut shows its key in the tooltip", () => {
		const title = (tool: string) =>
			(root.querySelector(`[aria-label="${tool}"]`) as HTMLElement).title;
		expect(title("select")).toBe("Zaznacz (Esc)");
		expect(title("pan")).toBe("Ręka (M)");
		expect(title("eraser")).toBe("Gumka (E)");
		expect(title("line")).toBe("Linia (L)");
		expect(title("shape")).toBe("Kształty (K)");
		expect(title("text")).toBe("Tekst (T)");
	});

	describe("the shape list (R-033)", () => {
		const list = () => root.querySelector(".shape-list");
		const item = (kind: string) =>
			root.querySelector(`[aria-label="shape ${kind}"]`) as HTMLElement | null;
		// Clicks go through act, so the list is in the DOM when we look.
		const press = (el: HTMLElement | null) => act(() => el?.click());
		const pressTool = (label: string) =>
			press(root.querySelector(`[aria-label="${label}"]`) as HTMLElement);

		test("the shape button shows the icon of the current shape and opens no list at first", () => {
			pressTool("shape");
			expect(settings.tool).toBe("shape");
			expect(list()).toBeNull();
		});

		test("clicking the button again opens the list of all five shapes", () => {
			pressTool("shape");
			pressTool("shape");
			expect(list()).not.toBeNull();
			for (const k of [
				"rect",
				"ellipse",
				"trapezoid",
				"rhombus",
				"parallelogram",
			])
				expect(item(k)).not.toBeNull();
		});

		test("choosing a shape sets it, keeps the shape tool and closes the list", () => {
			pressTool("shape");
			pressTool("shape");
			press(item("rhombus"));
			expect(settings.shape).toBe("rhombus");
			expect(settings.tool).toBe("shape");
			expect(list()).toBeNull();
		});

		test("choosing a shape while another tool is active switches to the shape tool", () => {
			pressTool("shape");
			pressTool("shape");
			pressTool("eraser"); // leaves the shape tool, the list closes
			expect(list()).toBeNull();
			pressTool("shape");
			pressTool("shape");
			press(item("trapezoid"));
			pressTool("pen");
			pressTool("shape"); // back: the last chosen shape is still the trapezoid
			expect(settings.shape).toBe("trapezoid");
			expect(settings.tool).toBe("shape");
		});

		test("the current shape is marked in the list and its icon is on the button", () => {
			settings.shape = "parallelogram";
			pressTool("shape");
			pressTool("shape");
			expect(item("parallelogram")?.classList.contains("active")).toBe(true);
			expect(item("rect")?.classList.contains("active")).toBe(false);
		});

		test("Escape closes the list", () => {
			pressTool("shape");
			pressTool("shape");
			act(() => {
				dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
			});
			expect(list()).toBeNull();
		});
	});

	test("tells its parent when the tool changes, so the board can update the cursor", () => {
		const onToolChange = vi.fn();
		act(() =>
			render(
				<Toolbar
					settings={settings}
					onToolChange={onToolChange}
					onUndo={onUndo}
					onRedo={onRedo}
				/>,
				root,
			),
		);
		click("eraser");
		expect(onToolChange).toHaveBeenCalledOnce();
		expect(settings.tool).toBe("eraser");
	});

	describe("the natural pen toggle (R-037)", () => {
		test("is next to the widths, shows its state and switches the style of new strokes", () => {
			const toggle = root.querySelector(
				'[aria-label="natural pen"]',
			) as HTMLElement;
			expect(toggle).not.toBeNull();
			expect(toggle.querySelector("svg")).not.toBeNull();
			expect(toggle.title).toBe("Naturalne pióro");
			expect(toggle.getAttribute("aria-pressed")).toBe("false");
			click("natural pen");
			expect(settings.natural).toBe(true);
			click("natural pen");
			expect(settings.natural).toBe(false);
		});

		test("is hidden while something is selected, like the widths", () => {
			act(() =>
				render(
					<Toolbar
						settings={settings}
						hasSelection
						onUndo={onUndo}
						onRedo={onRedo}
					/>,
					root,
				),
			);
			expect(root.querySelector('[aria-label="natural pen"]')).toBeNull();
		});
	});
});
