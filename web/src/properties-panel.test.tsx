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

	const mount = (elements: Stroke[]) => {
		render(
			<PropertiesPanel
				elements={elements}
				colors={COLORS}
				onChange={onChange}
			/>,
			root,
		);
	};
	const btn = (label: string) =>
		root.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement | null;
	const has = (label: string) => btn(label) !== null;

	beforeEach(() => {
		root = document.createElement("div");
		onChange = vi.fn();
	});

	test("shows nothing when nothing is selected", () => {
		mount([]);
		expect(root.querySelector(".properties")).toBeNull();
	});

	test("a freehand stroke offers colour, width and opacity, but no dash or fill", () => {
		mount([freehand]);
		expect(has("prop color #d32f2f")).toBe(true);
		expect(has("prop size 10")).toBe(true);
		expect(has("prop opacity 0.6")).toBe(true);
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
		expect(has("prop opacity 0.3")).toBe(true);
		expect(has("prop color #d32f2f")).toBe(false);
		expect(has("prop size 10")).toBe(false);
	});

	test("a text offers colour and size", () => {
		mount([text]);
		expect(has("prop color #d32f2f")).toBe(true);
		expect(has("prop size 2")).toBe(true);
		expect(has("prop dash dashed")).toBe(false);
	});

	test("each control reports the matching change", () => {
		mount([rect]);
		btn("prop color #d32f2f")?.click();
		btn("prop size 10")?.click();
		btn("prop dash dashed")?.click();
		btn("prop fill #1976d2")?.click();
		btn("prop fill none")?.click();
		btn("prop opacity 0.3")?.click();
		expect(
			(onChange as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]),
		).toEqual([
			{ color: "#d32f2f" },
			{ size: 10 },
			{ dash: "dashed" },
			{ fill: "#1976d2" },
			{ fill: null },
			{ opacity: 0.3 },
		]);
	});

	test("highlights the current values of the first selected element", () => {
		mount([
			{
				...rect,
				color: "#d32f2f",
				size: 10,
				dash: "dashed",
				fill: "#1976d2",
				opacity: 0.6,
			},
		]);
		for (const label of [
			"prop color #d32f2f",
			"prop size 10",
			"prop dash dashed",
			"prop fill #1976d2",
			"prop opacity 0.6",
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
