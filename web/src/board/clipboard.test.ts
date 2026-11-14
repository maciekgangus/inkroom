import { describe, expect, test, vi } from "vitest";
import type { Stroke } from "./board";
import { parseClipboard, rehomeImages, serializeSelection } from "./clipboard";

const pt = (x: number, y: number) => [x, y, 0.5] as [number, number, number];
const base = { authorId: "someone", color: "#d32f2f", size: 6, z: 123456 };
const rect: Stroke = {
	...base,
	id: "r",
	kind: "rect",
	fill: "#1976d2",
	dash: "dashed",
	opacity: 0.5,
	rot: 0.3,
	points: [pt(10, 20), pt(110, 70)],
};
const pen: Stroke = {
	...base,
	id: "p",
	points: [pt(0, 0), pt(5, 8), pt(9, 3)],
};
const text: Stroke = {
	...base,
	id: "t",
	kind: "text",
	text: "Zażółć gęślą",
	fontSize: 32,
	points: [pt(40, 40)],
};
const image: Stroke = {
	...base,
	id: "i",
	kind: "image",
	src: "img-1",
	points: [pt(0, 0), pt(200, 100)],
};

describe("portable clipboard format (R-035)", () => {
	test("is plain JSON with a marker, a version and the source board", () => {
		const text = serializeSelection([rect], "board-A");
		const json = JSON.parse(text);
		expect(json.inkroom).toBe(1);
		expect(json.board).toBe("board-A");
		expect(json.elements).toHaveLength(1);
	});

	test("leaves out what belongs to this board and author: id, author and drawing order", () => {
		const [el] = JSON.parse(serializeSelection([rect], "b")).elements;
		expect(el.id).toBeUndefined();
		expect(el.authorId).toBeUndefined();
		expect(el.z).toBeUndefined();
	});

	test("round-trips geometry, style, text and the picture reference", () => {
		const clip = parseClipboard(
			serializeSelection([rect, pen, text, image], "b"),
		);
		expect(clip?.board).toBe("b");
		const [r, p, t, i] = clip?.elements ?? [];
		expect(r).toMatchObject({
			kind: "rect",
			fill: "#1976d2",
			dash: "dashed",
			opacity: 0.5,
			rot: 0.3,
			color: "#d32f2f",
			size: 6,
		});
		expect(r.points).toEqual(rect.points);
		expect(p.points).toEqual(pen.points);
		expect(p.kind).toBeUndefined();
		expect(t).toMatchObject({
			kind: "text",
			text: "Zażółć gęślą",
			fontSize: 32,
		});
		expect(i).toMatchObject({ kind: "image", src: "img-1" });
	});

	test("keeps the order of the elements (front to back)", () => {
		const clip = parseClipboard(serializeSelection([pen, rect, text], "b"));
		expect(clip?.elements.map((e) => e.kind)).toEqual([
			undefined,
			"rect",
			"text",
		]);
	});

	test("every polygon kind is accepted", () => {
		const els = (
			["trapezoid", "rhombus", "parallelogram", "ellipse"] as const
		).map((kind) => ({ ...rect, kind }));
		expect(parseClipboard(serializeSelection(els, "b"))?.elements).toHaveLength(
			4,
		);
	});

	test("text that is not ours is not a clipboard", () => {
		for (const text of [
			"just some words",
			"",
			"{}",
			'{"inkroom": 1}',
			'{"elements": []}',
			"[1,2,3]",
			"null",
			'{"inkroom":1,"board":"b","elements":[]}',
		]) {
			expect(parseClipboard(text)).toBeNull();
		}
	});

	test("a version we do not know is refused instead of guessed", () => {
		const text = JSON.stringify({
			inkroom: 2,
			board: "b",
			elements: [{ color: "#000", size: 1, points: [pt(0, 0), pt(1, 1)] }],
		});
		expect(parseClipboard(text)).toBeNull();
	});

	test("elements that are malformed are dropped, the good ones stay", () => {
		const good = { color: "#000", size: 2, points: [pt(0, 0), pt(1, 1)] };
		const text = JSON.stringify({
			inkroom: 1,
			board: "b",
			elements: [
				good,
				{ ...good, points: "nope" },
				{ ...good, points: [[1, "x", 0.5]] },
				{ ...good, size: "big" },
				{ ...good, kind: "spaceship" },
				{ ...good, opacity: 7 },
				42,
				null,
			],
		});
		expect(parseClipboard(text)?.elements).toEqual([good]);
	});

	test("nothing else from the text gets onto the board", () => {
		const text = JSON.stringify({
			inkroom: 1,
			board: "b",
			elements: [
				{
					color: "#000",
					size: 2,
					points: [pt(0, 0), pt(1, 1)],
					id: "forged",
					authorId: "forged",
					z: 1,
					__proto__: { polluted: true },
					extra: "x",
				},
			],
		});
		const [el] = parseClipboard(text)?.elements ?? [];
		expect(Object.keys(el).sort()).toEqual(["color", "points", "size"]);
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	test("an absurd number of elements is refused", () => {
		const good = { color: "#000", size: 2, points: [pt(0, 0), pt(1, 1)] };
		const text = JSON.stringify({
			inkroom: 1,
			board: "b",
			elements: Array.from({ length: 5001 }, () => good),
		});
		expect(parseClipboard(text)).toBeNull();
	});
});

describe("rehomeImages", () => {
	const clip = (board: string) => ({
		board,
		elements: [
			{
				color: "#000",
				size: 1,
				kind: "image" as const,
				src: "old-1",
				points: [pt(0, 0), pt(1, 1)],
			},
			{
				color: "#000",
				size: 1,
				kind: "rect" as const,
				points: [pt(0, 0), pt(1, 1)],
			},
			{
				color: "#000",
				size: 1,
				kind: "image" as const,
				src: "old-2",
				points: [pt(0, 0), pt(1, 1)],
			},
		],
	});

	test("the same board keeps its pictures untouched", async () => {
		const transfer = vi.fn();
		const out = await rehomeImages(clip("b"), "b", transfer);
		expect(transfer).not.toHaveBeenCalled();
		expect(out.map((e) => e.src)).toEqual(["old-1", undefined, "old-2"]);
	});

	test("another board gets copies of the pictures, nothing else is touched", async () => {
		const transfer = vi.fn(async (_from: string, src: string) => `new-${src}`);
		const out = await rehomeImages(clip("a"), "b", transfer);
		expect(transfer).toHaveBeenCalledTimes(2);
		expect(transfer).toHaveBeenCalledWith("a", "old-1");
		expect(out.map((e) => e.src)).toEqual([
			"new-old-1",
			undefined,
			"new-old-2",
		]);
		expect(out[1].kind).toBe("rect");
	});

	test("a picture that cannot be copied fails the paste with a clear message", async () => {
		const transfer = async () => {
			throw new Error("403");
		};
		await expect(rehomeImages(clip("a"), "b", transfer)).rejects.toThrow(
			"Nie można skopiować obrazu z innej tablicy",
		);
	});

	test("the natural pen style travels with the stroke", () => {
		const stroke: Stroke = { ...pen, dash: "natural" };
		const clip = parseClipboard(serializeSelection([stroke], "b"));
		expect(clip?.elements[0].dash).toBe("natural");
	});

	test("the width of a text area travels, only a real size", () => {
		const area: Stroke = { ...text, width: 240 };
		expect(
			parseClipboard(serializeSelection([area], "b"))?.elements[0].width,
		).toBe(240);
		const bad = (width: unknown) =>
			parseClipboard(
				JSON.stringify({
					inkroom: 1,
					board: "b",
					elements: [
						{
							color: "#000",
							size: 2,
							kind: "text",
							text: "x",
							width,
							points: [[0, 0, 0.5]],
						},
					],
				}),
			);
		expect(bad("wide")).toBeNull();
		expect(bad(-5)).toBeNull();
		expect(bad(0)).toBeNull();
	});

	test("the parameter of an adjustable shape travels, only a number", () => {
		const trapezoid: Stroke = { ...rect, kind: "trapezoid", adj: 0.4 };
		expect(
			parseClipboard(serializeSelection([trapezoid], "b"))?.elements[0].adj,
		).toBe(0.4);
		const bad = parseClipboard(
			JSON.stringify({
				inkroom: 1,
				board: "b",
				elements: [
					{
						color: "#000",
						size: 2,
						kind: "trapezoid",
						adj: "wide",
						points: [
							[0, 0, 0.5],
							[9, 9, 0.5],
						],
					},
				],
			}),
		);
		expect(bad).toBeNull();
	});
});

describe("numbered coordinate system in the clipboard", () => {
	const axes = {
		id: "x",
		authorId: "a",
		color: "#111",
		size: 2,
		z: 1,
		kind: "axes",
		numbered: true,
		points: [
			[0, 0, 0.5],
			[200, 160, 0.5],
		],
	} as Stroke;

	test("the option survives a copy and a paste", () => {
		const clip = parseClipboard(serializeSelection([axes], "b"));
		expect(clip?.elements[0].numbered).toBe(true);
	});

	test("anything but a boolean is refused", () => {
		const text = serializeSelection(
			[{ ...axes, numbered: "yes" as never }],
			"b",
		);
		expect(parseClipboard(text)).toBeNull();
	});
});
