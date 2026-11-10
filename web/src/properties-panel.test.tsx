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

	test("a freehand stroke offers colour, width and opacity, but no dash or fill", () => {
		mount([freehand]);
		expect(has("prop color #d32f2f")).toBe(true);
		expect(slider("prop size")).not.toBeNull();
		expect(slider("prop opacity")).not.toBeNull();
		expect(has("prop dash dashed")).toBe(false);
		expect(has("prop fill none")).toBe(false);
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
});
