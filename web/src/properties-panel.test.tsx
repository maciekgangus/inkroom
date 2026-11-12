import { render } from "preact";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Stroke } from "./board/board";
import type { StylePatch } from "./board/style";
import { PropertiesPanel } from "./properties-panel";

const COLORS = ["#111111", "#d32f2f", "#1976d2"];
const base = { id: "e", authorId: "a", color: "#111111", size: 5, z: 0 };
const pts = (...p: [number, number][]) =>
	p.map(([x, y]) => [x, y, 0.5] as [number, number, number]);
const freehand: Stroke = { ...base, points: pts([0, 0], [5, 5]) };
const rect: Stroke = { ...base, kind: "rect", points: pts([0, 0], [5, 5]) };
const text: Stroke = { ...base, kind: "text", text: "hi", points: pts([0, 0]) };
const image: Stroke = {
	...base,
	kind: "image",
	src: "x",
	points: pts([0, 0], [5, 5]),
};

describe("PropertiesPanel", () => {
	let root: HTMLElement;
	let onChange: (patch: StylePatch) => void;
	let onPreview: (patch: StylePatch) => void;

	const mount = (elements: Stroke[]) => {
		render(
			<PropertiesPanel
				elements={elements}
				colors={COLORS}
				onChange={onChange}
				onPreview={onPreview}
			/>,
			root,
		);
	};
	const btn = (label: string) =>
		root.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement | null;
	const has = (label: string) => btn(label) !== null;
	const slider = (label: string) =>
		root.querySelector(
			`input[type="range"][aria-label="${label}"]`,
		) as HTMLInputElement | null;
	const move = (
		el: HTMLInputElement,
		value: number,
		event: "input" | "change",
	) => {
		el.value = String(value);
		el.dispatchEvent(new Event(event, { bubbles: true }));
	};

	beforeEach(() => {
		root = document.createElement("div");
		onChange = vi.fn();
		onPreview = vi.fn();
	});

	test("shows nothing when nothing is selected", () => {
		mount([]);
		expect(root.querySelector(".properties")).toBeNull();
	});

	test("a freehand stroke offers colour, width, opacity and line style, but no fill", () => {
		mount([freehand]);
		expect(has("prop color #d32f2f")).toBe(true);
		expect(slider("prop size")).not.toBeNull();
		expect(slider("prop opacity")).not.toBeNull();
		expect(has("prop dash dashed")).toBe(true);
		expect(has("prop fill none")).toBe(false);
	});

	describe("the menu of an object (R-060)", () => {
		const anchor = { minX: 300, minY: 200, maxX: 500, maxY: 300 };
		const mountWith = (extra: Record<string, unknown>) =>
			render(
				<PropertiesPanel
					elements={[rect]}
					colors={COLORS}
					anchor={anchor}
					onChange={onChange}
					{...extra}
				/>,
				root,
			);
		const mouse = (el: Element, type: string, x: number, y: number) =>
			el.dispatchEvent(
				new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }),
			);

		test("closed, it leaves a small tile by the object that opens the menu again", () => {
			const onExpand = vi.fn();
			mountWith({ collapsed: true, onExpand });
			expect(root.querySelector(".properties")).toBeNull();
			const tile = root.querySelector(".panel-tile") as HTMLButtonElement;
			expect(tile).not.toBeNull();
			expect(tile.getAttribute("aria-label")).toBe("Pokaż menu obiektu");
			tile.click();
			expect(onExpand).toHaveBeenCalledTimes(1);
		});

		test("the title is a handle: dragging it reports where the menu was put, from where it was", () => {
			const onOffset = vi.fn();
			mountWith({ offset: { x: 5, y: 7 }, onOffset });
			const title = root.querySelector(".panel-title") as HTMLElement;
			mouse(title, "pointerdown", 100, 100);
			mouse(title, "pointermove", 130, 120);
			expect(onOffset).toHaveBeenLastCalledWith({ x: 35, y: 27 });
			mouse(title, "pointerup", 130, 120);
			mouse(title, "pointermove", 200, 200);
			expect(onOffset).toHaveBeenCalledTimes(1);
		});

		test("the offset moves the menu and the tile alike", () => {
			mountWith({});
			const at = (sel: string) => {
				const e = root.querySelector(sel) as HTMLElement;
				return [e.style.left, e.style.top];
			};
			const panel = at(".properties");
			mountWith({ offset: { x: 30, y: -10 } });
			const moved = at(".properties");
			expect(parseFloat(moved[0]) - parseFloat(panel[0])).toBe(30);
			expect(parseFloat(moved[1]) - parseFloat(panel[1])).toBe(-10);
			mountWith({ collapsed: true, offset: { x: 30, y: -10 } });
			expect(at(".panel-tile")).toEqual([
				expect.stringMatching(/px$/),
				expect.stringMatching(/px$/),
			]);
		});
	});

	test("a freehand stroke can switch to the natural pen and back to solid", () => {
		mount([freehand]);
		expect(has("prop dash solid")).toBe(true);
		expect(has("prop dash natural")).toBe(true);
		expect(has("prop dash dotted")).toBe(true);
		btn("prop dash natural")?.click();
		expect(onChange).toHaveBeenLastCalledWith({ dash: "natural" });
	});

	test("a rectangle has no natural pen, a mixed selection has all four", () => {
		mount([rect]);
		expect(has("prop dash natural")).toBe(false);
		mount([rect, freehand]);
		for (const d of ["solid", "dashed", "dotted", "natural"])
			expect(has(`prop dash ${d}`)).toBe(true);
	});

	test("a rectangle also offers dash and fill", () => {
		mount([rect]);
		expect(has("prop dash dotted")).toBe(true);
		expect(has("prop fill none")).toBe(true);
		expect(has("prop fill #1976d2")).toBe(true);
	});

	test("an image offers only opacity", () => {
		mount([image]);
		expect(slider("prop opacity")).not.toBeNull();
		expect(has("prop color #d32f2f")).toBe(false);
		expect(slider("prop size")).toBeNull();
	});

	test("a text offers colour and a font size, not a line width", () => {
		mount([text]);
		expect(has("prop color #d32f2f")).toBe(true);
		expect(slider("prop font size")).not.toBeNull();
		expect(slider("prop size")).toBeNull();
		expect(has("prop dash dashed")).toBe(false);
	});

	test("each button reports the matching change", () => {
		mount([rect]);
		btn("prop color #d32f2f")?.click();
		btn("prop dash dashed")?.click();
		btn("prop fill #1976d2")?.click();
		btn("prop fill none")?.click();
		expect(
			(onChange as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]),
		).toEqual([
			{ color: "#d32f2f" },
			{ dash: "dashed" },
			{ fill: "#1976d2" },
			{ fill: null },
		]);
	});

	test("the width slider shows pixels, previews while moving and commits on release", () => {
		mount([{ ...rect, size: 7 }]);
		const s = slider("prop size") as HTMLInputElement;
		expect(s.value).toBe("7");
		expect(root.querySelector(".slider .value")?.textContent).toBe("7 px");
		move(s, 23, "input");
		expect(onPreview).toHaveBeenLastCalledWith({ size: 23 });
		expect(onChange).not.toHaveBeenCalled();
		move(s, 23, "change");
		expect(onChange).toHaveBeenCalledWith({ size: 23 });
	});

	test("the opacity slider is in percent", () => {
		mount([{ ...rect, opacity: 0.6 }]);
		const s = slider("prop opacity") as HTMLInputElement;
		expect(s.value).toBe("60");
		expect(root.querySelectorAll(".slider .value")[1]?.textContent).toBe("60%");
		move(s, 35, "input");
		expect(onPreview).toHaveBeenLastCalledWith({ opacity: 0.35 });
		move(s, 35, "change");
		expect(onChange).toHaveBeenCalledWith({ opacity: 0.35 });
	});

	test("a text's slider is its font size in pixels", () => {
		mount([{ ...text, fontSize: 30 }]);
		const s = slider("prop font size") as HTMLInputElement;
		expect(s.value).toBe("30");
		expect(root.querySelector(".slider .value")?.textContent).toBe("30 px");
		move(s, 48, "change");
		expect(onChange).toHaveBeenCalledWith({ fontSize: 48 });
	});

	test("highlights the current values of the first selected element", () => {
		mount([
			{
				...rect,
				color: "#d32f2f",
				dash: "dashed",
				fill: "#1976d2",
			},
		]);
		for (const label of [
			"prop color #d32f2f",
			"prop dash dashed",
			"prop fill #1976d2",
		]) {
			expect(btn(label)?.classList.contains("active")).toBe(true);
		}
		expect(btn("prop color #111111")?.classList.contains("active")).toBe(false);
	});

	test("with no fill, 'no fill' is the highlighted choice", () => {
		mount([rect]);
		expect(btn("prop fill none")?.classList.contains("active")).toBe(true);
	});

	describe("attached to an object (R-042)", () => {
		const mountAt = (
			elements: Stroke[],
			anchor: { minX: number; minY: number; maxX: number; maxY: number } | null,
		) => {
			render(
				<PropertiesPanel
					elements={elements}
					colors={COLORS}
					anchor={anchor}
					onChange={onChange}
					onPreview={onPreview}
				/>,
				root,
			);
			return root.querySelector(".properties") as HTMLElement;
		};
		const box = { minX: 400, minY: 200, maxX: 600, maxY: 300 };

		test("is placed near the object it edits", () => {
			const panel = mountAt([rect], box);
			expect(panel.classList.contains("floating")).toBe(true);
			expect(panel.style.top).toBe("312px");
		});

		test("without an anchor it keeps the corner it always had", () => {
			const panel = mountAt([rect], null);
			expect(panel.classList.contains("floating")).toBe(false);
			expect(panel.style.top).toBe("");
		});

		test("names the class of the object in a title", () => {
			mountAt([text], box);
			expect(root.querySelector(".panel-title")?.textContent).toBe("Tekst");
			mountAt([rect, text], box);
			expect(root.querySelector(".panel-title")?.textContent).toBe(
				"Zaznaczenie (2)",
			);
		});

		test("clicking a button does not take the focus from a text field being edited", () => {
			mountAt([rect], box);
			const button = btn("prop dash dashed") as HTMLElement;
			const e = new MouseEvent("mousedown", {
				bubbles: true,
				cancelable: true,
			});
			button.dispatchEvent(e);
			expect(e.defaultPrevented).toBe(true);
		});

		test("a slider can still be grabbed", () => {
			mountAt([rect], box);
			const s = slider("prop size") as HTMLInputElement;
			const e = new MouseEvent("mousedown", {
				bubbles: true,
				cancelable: true,
			});
			s.dispatchEvent(e);
			expect(e.defaultPrevented).toBe(false);
		});
	});
});

describe("the cross in the panel's title", () => {
	test("is offered when the board can put the panel away, and calls it", () => {
		const root = document.createElement("div");
		const onClose = vi.fn();
		const show = (close?: () => void) =>
			render(
				<PropertiesPanel
					elements={[rect]}
					colors={COLORS}
					onChange={() => {}}
					onClose={close}
				/>,
				root,
			);
		show();
		expect(root.querySelector('[aria-label="close panel"]')).toBeNull();
		show(onClose);
		(root.querySelector('[aria-label="close panel"]') as HTMLElement).click();
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});

describe("the colour windows of the panel", () => {
	const show = (els: Stroke[], palette?: string[]) => {
		const root = document.createElement("div");
		render(
			<PropertiesPanel
				elements={els}
				colors={COLORS}
				palette={palette}
				onChange={() => {}}
			/>,
			root,
		);
		return root;
	};

	test("show the current colour, and that a shape has no fill, without words on the buttons", () => {
		const root = show([{ ...rect, color: "#d32f2f" }]);
		const names = [...root.querySelectorAll(".color-name")].map(
			(n) => n.textContent,
		);
		expect(names).toEqual(["#D32F2F", "brak"]);
		expect(root.textContent).not.toContain("Bez wypełnienia");
		expect(
			root.querySelector('[aria-label="prop fill none"] svg'),
		).not.toBeNull();
	});

	test("offer the whole palette, and a tile for any other colour", () => {
		const palette = [...COLORS, "#6b7280", "#8d5a2b"];
		const root = show([rect], palette);
		expect(root.querySelectorAll('[aria-label^="prop color #"]')).toHaveLength(
			palette.length,
		);
		expect(
			root.querySelector('[aria-label="prop color custom"]'),
		).not.toBeNull();
		expect(
			root.querySelector('[aria-label="prop fill custom"]'),
		).not.toBeNull();
	});

	test("the sliders say what they are for with an icon", () => {
		const root = show([rect]);
		expect(root.querySelectorAll(".slider .slider-icon svg")).toHaveLength(2); // width, opacity
	});
});
