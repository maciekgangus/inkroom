import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Settings } from "./board/controller";
import { resetExtraColor } from "./extra-color";
import { setTheme } from "./theme";
import { resetToolStyles } from "./tool-style";
import { COLORS, MORE_COLORS, SIZES, Toolbar } from "./toolbar";

describe("Toolbar", () => {
	let root: HTMLElement;
	let settings: Settings;
	let onUndo: () => void;
	let onRedo: () => void;

	beforeEach(() => {
		resetExtraColor();
		resetToolStyles();
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

	test("the ready widths: 1, 2 and 4 px drawn, shown as 2, 4 and 8", () => {
		expect(SIZES).toEqual([1, 2, 4]); // shown as 2, 4 and 8 px
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

		test("the fourth place is one SVG of circles round one centre, with a plus only while it is empty", () => {
			const more = q("more colors") as HTMLElement;
			const svg = more.querySelector("svg.well") as SVGElement;
			expect(svg.getAttribute("viewBox")).toBe("0 0 40 40");
			for (const c of svg.querySelectorAll("circle")) {
				expect(c.getAttribute("cx")).toBe("20");
				expect(c.getAttribute("cy")).toBe("20");
			}
			expect(svg.querySelector("path[d^='M20 16']")).not.toBeNull();
			expect(svg.querySelectorAll(".ring path")).toHaveLength(8);
		});

		test("the fourth place says it holds more than one colour: a list marker, a title and a popup hint", () => {
			const more = q("more colors") as HTMLElement;
			expect(more.classList.contains("has-list")).toBe(true);
			expect(more.getAttribute("aria-haspopup")).toBe("true");
			expect(more.title).toMatch(/Więcej kolorów/);
			act(() => click("more colors"));
			act(() => click(`color ${MORE_COLORS[3]}`));
			act(() => click(`color ${COLORS[1]}`));
			// With a colour kept there, it still says so.
			expect(more.classList.contains("has-list")).toBe(true);
			expect(more.title).toMatch(/Więcej kolorów/);
		});

		test("the palette hangs from the fourth place: both in one wrapper, with a rule before the well of one's own colour", () => {
			act(() => click("more colors"));
			const wrap = root.querySelector(".palette-wrap") as HTMLElement;
			expect(wrap).not.toBeNull();
			expect(wrap.contains(q("more colors"))).toBe(true);
			expect(wrap.querySelector(":scope > .palette")).not.toBeNull();
			const palette = wrap.querySelector(".palette") as HTMLElement;
			expect(palette.querySelector(".palette-rule")).not.toBeNull();
			// 14 fixed colours (two rows of seven) and the well of one's own colour.
			expect(palette.querySelectorAll(".swatch:not(.custom)")).toHaveLength(14);
			expect(palette.querySelector(".swatch.custom")).not.toBeNull();
		});

		test("the palette shuts after a colour from anywhere: the grid, a quick colour or the fourth place", () => {
			const open = () => {
				act(() => click("more colors"));
				expect(root.querySelector(".palette")).not.toBeNull();
			};
			open();
			act(() => click(`color ${MORE_COLORS[2]}`)); // from the grid
			expect(root.querySelector(".palette")).toBeNull();
			act(() => click(`color ${COLORS[1]}`)); // a quick colour, palette shut
			act(() => click("more colors")); // the colour kept in the fourth place is picked first
			expect(settings.color).toBe(MORE_COLORS[2]);
			expect(root.querySelector(".palette")).toBeNull();
			open(); // pressed again, the fourth place opens the palette
			act(() => click(`color ${COLORS[1]}`)); // a quick colour of the bar, palette open
			expect(root.querySelector(".palette")).toBeNull();
			act(() => click("more colors")); // the kept colour is picked, palette shut
			open(); // and pressed once more it opens
			act(() => click("more colors")); // the fourth place itself, with the palette open
			expect(root.querySelector(".palette")).toBeNull();
		});

		test("the palette shuts on Escape and on a press outside it, not on a press inside it", () => {
			act(() => click("more colors"));
			act(() => {
				(root.querySelector(".palette") as HTMLElement).dispatchEvent(
					new Event("pointerdown", { bubbles: true }),
				);
			});
			expect(root.querySelector(".palette")).not.toBeNull();
			act(() => {
				document.body.dispatchEvent(
					new Event("pointerdown", { bubbles: true }),
				);
			});
			expect(root.querySelector(".palette")).toBeNull();
			act(() => click("more colors"));
			expect(root.querySelector(".palette")).not.toBeNull();
			act(() => {
				dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
			});
			expect(root.querySelector(".palette")).toBeNull();
		});

		test("the palette shuts after a colour is picked, not while the picker's sliders move", () => {
			act(() => click("more colors"));
			act(() => click("custom color"));
			const shade = q("custom color shade") as HTMLInputElement;
			shade.value = "30";
			act(() => {
				shade.dispatchEvent(new Event("input", { bubbles: true }));
				shade.dispatchEvent(new Event("change", { bubbles: true }));
			});
			expect(root.querySelector(".palette")).not.toBeNull();
			act(() => click(`color ${MORE_COLORS[2]}`));
			expect(root.querySelector(".palette")).toBeNull();
		});

		test("the extra colours stay hidden until the palette is opened", () => {
			expect(MORE_COLORS).toHaveLength(12);
			expect(q(`color ${MORE_COLORS[0]}`)).toBeNull();
			act(() => click("more colors"));
			for (const c of MORE_COLORS) expect(q(`color ${c}`)).not.toBeNull();
			// A round tile that opens our own picker, not the system colour field.
			const tile = q("custom color") as HTMLElement;
			expect(tile.tagName).toBe("BUTTON");
			expect(tile.getAttribute("aria-expanded")).toBe("false");
			expect(root.querySelector('input[type="color"]')).toBeNull();
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

		test("the colour picked from beyond the quick ones stays in the fourth slot after a quick colour is chosen (R-079)", () => {
			act(() => click("more colors"));
			act(() => click(`color ${MORE_COLORS[3]}`));
			act(() => click(`color ${COLORS[1]}`)); // a quick colour
			expect(settings.color).toBe(COLORS[1]);
			const slot = q("more colors") as HTMLElement;
			expect(slot.style.getPropertyValue("--well")).not.toBe("");
			expect(slot.querySelector("svg.well")).not.toBeNull(); // the ring is always there
			expect(slot.querySelector("svg.well path[d^='M20 16']")).toBeNull(); // no plus: the colour is there // no plus: the colour is there
			expect(slot.getAttribute("aria-pressed")).toBe("false");
		});

		test("pressing the kept colour picks it; pressing it again opens the palette", () => {
			act(() => click("more colors"));
			act(() => click(`color ${MORE_COLORS[3]}`));
			act(() => click(`color ${COLORS[1]}`));
			act(() => click("more colors"));
			expect(settings.color).toBe(MORE_COLORS[3]);
			expect(q(`color ${MORE_COLORS[5]}`)).toBeNull(); // the palette is not open yet
			act(() => click("more colors"));
			expect(q(`color ${MORE_COLORS[5]}`)).not.toBeNull();
		});

		test("the quick colours and the kept one show their keys 1 to 4", () => {
			act(() => click("more colors"));
			act(() => click(`color ${MORE_COLORS[3]}`));
			expect(q(`color ${COLORS[0]}`)?.title).toMatch(/1/);
			expect(q(`color ${COLORS[2]}`)?.title).toMatch(/3/);
			expect(q("more colors")?.title).toMatch(/4/);
		});

		test("the picker sets any colour and goes back to the pen from the eraser", () => {
			click("eraser");
			act(() => click("more colors"));
			act(() => click("custom color"));
			const before = settings.color;
			const shade = q("custom color shade") as HTMLInputElement;
			shade.value = "30";
			act(() => {
				shade.dispatchEvent(new Event("input", { bubbles: true }));
			});
			expect(settings.color).toMatch(/^#[0-9a-f]{6}$/);
			expect(settings.color).not.toBe(before);
			expect(settings.tool).toBe("pen");
		});
	});

	test("in dark mode the black swatch is shown as the light violet (the stored colour stays black)", () => {
		act(() => setTheme("dark"));
		const black = root.querySelector(
			`[aria-label="color ${COLORS[0]}"]`,
		) as HTMLElement;
		expect(black.style.background).toMatch(/#8f8fff|rgb\(143, 143, 255\)/);
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
		click("laser");
		expect(settings.tool).toBe("laser");
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
		click(`color ${COLORS[2]}`);
		expect(settings.tool).toBe("shape");
		expect(settings.color).toBe(COLORS[2]);
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

	test("each of pen, line and shape remembers its own colour (R-097)", () => {
		click(`color ${COLORS[1]}`); // pen: red
		click("line");
		click(`color ${COLORS[2]}`); // line: blue
		click("shape");
		click(`color ${COLORS[0]}`); // shape: black
		click("pen");
		expect(settings.color).toBe(COLORS[1]);
		click("line");
		expect(settings.color).toBe(COLORS[2]);
		click("shape");
		expect(settings.color).toBe(COLORS[0]);
	});

	test("a colour picked from the eraser goes to the pen and wins over the pen's old colour", () => {
		click(`color ${COLORS[1]}`); // the pen has red
		click("eraser");
		click(`color ${COLORS[2]}`);
		expect(settings.tool).toBe("pen");
		expect(settings.color).toBe(COLORS[2]);
		click("line");
		click("pen");
		expect(settings.color).toBe(COLORS[2]);
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

	test("keeps colour and size in place, dimmed, while something is selected (the panel owns them then)", () => {
		expect(root.querySelector('[aria-label="size 4"]')).not.toBeNull();
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
		expect(root.querySelector('[aria-label^="color "]')).not.toBeNull();
		expect(root.querySelector('[aria-label="size 4"]')).not.toBeNull();
		expect(root.querySelectorAll(".group.dimmed").length).toBe(2);
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
		expect(title("select")).toBe("Zaznacz (Q)");
		expect(title("pan")).toBe("Ręka (M)");
		expect(title("laser")).toBe("Wskaźnik (P)");
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

		test("clicking the button again opens the list of all shapes, by category", () => {
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

	test("the quick widths, the slider window and the line style list are in the toolbar (R-038)", () => {
		for (const label of [
			"size 1",
			"size 2",
			"size 4",
			"stroke settings",
			"line style",
		])
			expect(root.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
		expect(root.querySelector('[aria-label="natural pen"]')).toBeNull();
	});

	test("they stay, dimmed, while something is selected", () => {
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
		expect(root.querySelector('[aria-label="size 4"]')).not.toBeNull();
		expect(root.querySelector(".group.dimmed")).not.toBeNull();
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
});

describe("the colours in the bar", () => {
	test("three are at hand, the rest are behind the plus", () => {
		const root = document.createElement("div");
		const settings: Settings = { tool: "pen", color: "#111111", size: 5 };
		act(() =>
			render(
				<Toolbar settings={settings} onUndo={() => {}} onRedo={() => {}} />,
				root,
			),
		);
		expect(
			root.querySelectorAll(
				".toolbar > .group:nth-child(2) .swatch:not(.more)",
			),
		).toHaveLength(3);
		expect(root.querySelector('[aria-label="color #388e3c"]')).toBeNull();
		act(() =>
			(root.querySelector('[aria-label="more colors"]') as HTMLElement).click(),
		);
		expect(root.querySelector('[aria-label="color #388e3c"]')).not.toBeNull();
		expect(root.querySelector('[aria-label="color #f57c00"]')).not.toBeNull();
		act(() =>
			(
				root.querySelector('[aria-label="color #388e3c"]') as HTMLElement
			).click(),
		);
		expect(settings.color).toBe("#388e3c");
		// the plus now shows the colour that was picked from the palette
		expect(root.querySelector(".swatch.more.active")).not.toBeNull();
	});
});

describe("Toolbar on a narrow screen: one button for colour, width and style (R-082)", () => {
	let root: HTMLElement;
	let settings: Settings;

	const screen = (layout: "compact" | "rail" | "full") =>
		vi.stubGlobal("matchMedia", (q: string) => ({
			matches:
				layout === "rail"
					? q.includes("orientation: portrait") || q.includes("max-width")
					: layout === "compact"
						? q.includes("max-width")
						: false,
			addEventListener: () => {},
			removeEventListener: () => {},
		}));
	const q = (label: string) =>
		root.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;
	const show = () =>
		act(() =>
			render(
				<Toolbar settings={settings} onUndo={() => {}} onRedo={() => {}} />,
				root,
			),
		);

	beforeEach(() => {
		resetExtraColor();
		root = document.createElement("div");
		settings = { tool: "pen", color: COLORS[0], size: SIZES[1] };
	});
	afterEach(() => {
		act(() => render(null, root));
		vi.unstubAllGlobals();
	});

	test("the colours and the widths are not in the bar, one settings button is", () => {
		screen("compact");
		show();
		expect(q(`color ${COLORS[1]}`)).toBeNull();
		expect(q(`size ${SIZES[0]}`)).toBeNull();
		expect(q("more colors")).toBeNull();
		expect(q("pen settings")).not.toBeNull();
		expect(q("pen")).not.toBeNull(); // the tools stay
		expect(q("undo")).not.toBeNull();
	});

	test("the button shows the current colour, and the list opens from it with three sections", () => {
		screen("compact");
		show();
		const btn = q("pen settings") as HTMLElement;
		expect(btn.querySelector(".settings-color")).not.toBeNull();
		expect(root.querySelector(".settings-list")).toBeNull();
		act(() => btn.click());
		const list = root.querySelector(".settings-list") as HTMLElement;
		expect(list).not.toBeNull();
		expect(
			[...list.querySelectorAll(".settings-title")].map((e) => e.textContent),
		).toEqual(["Kolor", "Grubość", "Styl linii"]);
		expect(btn.getAttribute("aria-expanded")).toBe("true");
	});

	test("the list holds the quick colours, the palette, the widths and the styles", () => {
		screen("compact");
		show();
		act(() => (q("pen settings") as HTMLElement).click());
		for (const c of [...COLORS, ...MORE_COLORS])
			expect(q(`color ${c}`)).not.toBeNull();
		expect(q("custom color")).not.toBeNull();
		for (const s of SIZES) expect(q(`size ${s}`)).not.toBeNull();
		expect(q("stroke width")).not.toBeNull();
		expect(q("stroke opacity")).not.toBeNull();
		for (const s of ["natural", "solid", "dashed", "dotted"])
			expect(q(`line style ${s}`)).not.toBeNull();
	});

	test("a width and a style work from the list and leave it open; a colour works and shuts it", () => {
		screen("compact");
		show();
		act(() => (q("pen settings") as HTMLElement).click());
		act(() => (q(`size ${SIZES[2]}`) as HTMLElement).click());
		expect(settings.size).toBe(SIZES[2]);
		act(() => (q("line style dashed") as HTMLElement).click());
		expect(settings.lineStyle).toBe("dashed");
		expect(root.querySelector(".settings-list")).not.toBeNull();
		// The picker's sliders do not shut it either.
		act(() => (q("custom color") as HTMLElement).click());
		const shade = q("custom color shade") as HTMLInputElement;
		shade.value = "30";
		act(() => {
			shade.dispatchEvent(new Event("input", { bubbles: true }));
			shade.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(root.querySelector(".settings-list")).not.toBeNull();
		act(() => (q(`color ${COLORS[1]}`) as HTMLElement).click());
		expect(settings.color).toBe(COLORS[1]);
		expect(root.querySelector(".settings-list")).toBeNull();
	});

	test("Escape closes the list", () => {
		screen("compact");
		show();
		act(() => (q("pen settings") as HTMLElement).click());
		act(() => {
			dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		});
		expect(root.querySelector(".settings-list")).toBeNull();
	});

	test("the rail has the same button, and is marked as the rail", () => {
		screen("rail");
		show();
		expect(q("pen settings")).not.toBeNull();
		expect(root.querySelector(".toolbar.rail")).not.toBeNull();
	});

	test("a wide window keeps everything in the bar, as it is", () => {
		screen("full");
		show();
		expect(q("pen settings")).toBeNull();
		expect(q(`color ${COLORS[1]}`)).not.toBeNull();
		expect(q(`size ${SIZES[0]}`)).not.toBeNull();
		expect(root.querySelector(".toolbar.rail")).toBeNull();
	});
});
