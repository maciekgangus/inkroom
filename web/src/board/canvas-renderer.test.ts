import { describe, expect, test, vi } from "vitest";
import type { Stroke } from "./board";
import { CanvasRenderer, paintElements } from "./canvas-renderer";
import { Viewport } from "./viewport";

describe("CanvasRenderer contexts", () => {
	test("no layer is desynchronized: a layer cleared and drawn again must never be shown half way", () => {
		const canvas = () =>
			({ getContext: vi.fn(() => null) }) as unknown as HTMLCanvasElement;
		const committed = canvas();
		const live = canvas();
		new CanvasRenderer(committed, live, new Viewport());
		// The unfinished stroke is cleared and drawn whole at every move. A desynchronized canvas has
		// one buffer, shown as it is: between the clear and the drawing the stroke is gone for a
		// moment, which is seen as flicker (measured in Chrome at 3782 by 2012 pixels).
		for (const layer of [committed, live]) {
			const asked = vi.mocked(layer.getContext).mock.calls[0];
			expect(asked[0]).toBe("2d");
			expect(asked[1]).toBeUndefined();
		}
	});
});

describe("CanvasRenderer selection glow (R-058)", () => {
	test("every selected element glows, however many are selected", () => {
		vi.stubGlobal("requestAnimationFrame", undefined);
		vi.stubGlobal(
			"Path2D",
			class {
				moveTo() {}
				lineTo() {}
				quadraticCurveTo() {}
				closePath() {}
				rect() {}
				ellipse() {}
				arc() {}
			},
		);
		const blurs: number[] = [];
		const ctx = new Proxy(
			{},
			{
				get: (_t, k) => (k === "canvas" ? {} : () => ctx),
				set: (_t, k, v) => {
					if (k === "shadowBlur") blurs.push(v);
					return true;
				},
			},
		) as unknown as CanvasRenderingContext2D;
		const canvas = () =>
			({
				getContext: () => ctx,
				style: {},
				width: 100,
				height: 100,
			}) as unknown as HTMLCanvasElement;
		const renderer = new CanvasRenderer(canvas(), canvas(), new Viewport());
		const many = Array.from({ length: 40 }, (_, i) => ({
			id: `s${i}`,
			authorId: "a",
			color: "#111",
			size: 4,
			z: i,
			kind: "line" as const,
			points: [
				[0, i * 5, 0.5],
				[50, i * 5, 0.5],
			] as [number, number, number][],
		}));
		renderer.setHighlight(many);
		// Two passes of blur per element.
		expect(blurs.filter((b) => b > 0).length).toBeGreaterThanOrEqual(40);
		vi.unstubAllGlobals();
	});
});

describe("the glow of a selected coordinate plane (R-084)", () => {
	test("only the edge of the sheet glows, not its grid, axes or numbers", () => {
		vi.stubGlobal("requestAnimationFrame", undefined);
		vi.stubGlobal(
			"Path2D",
			class {
				moveTo() {}
				lineTo() {}
				quadraticCurveTo() {}
				closePath() {}
				rect() {}
				ellipse() {}
				arc() {}
			},
		);
		const calls: string[] = [];
		const ctx = new Proxy(
			{},
			{
				get: (_t, k) =>
					k === "canvas"
						? {}
						: (..._a: unknown[]) => {
								calls.push(String(k));
								return ctx;
							},
				set: () => true,
			},
		) as unknown as CanvasRenderingContext2D;
		const canvas = () =>
			({
				getContext: () => ctx,
				style: {},
				width: 100,
				height: 100,
			}) as unknown as HTMLCanvasElement;
		const renderer = new CanvasRenderer(canvas(), canvas(), new Viewport());
		renderer.setHighlight([
			{
				id: "pl",
				authorId: "a",
				color: "#111",
				size: 3,
				z: 1,
				kind: "plane",
				numbered: true,
				points: [
					[0, 0, 0.5],
					[400, 400, 0.5],
				],
			} as Stroke,
		]);
		vi.unstubAllGlobals();
		expect(calls).not.toContain("fillText");
		expect(calls).not.toContain("strokeText");
		expect(calls).not.toContain("fill");
		// one stroke of the edge for each pass of the glow
		expect(calls.filter((c) => c === "stroke").length).toBeLessThanOrEqual(2);
		expect(calls.filter((c) => c === "stroke").length).toBeGreaterThan(0);
	});
});

describe("the coordinate system on the canvas", () => {
	const record = () => {
		const widths: number[] = [];
		const texts: string[] = [];
		const ctx = new Proxy({ lineWidth: 1 } as Record<string, unknown>, {
			get: (t, k) => {
				if (k === "stroke") return () => widths.push(t.lineWidth as number);
				if (k === "fillText") return (text: string) => texts.push(text);
				if (k in t) return t[k as string];
				return () => ctx;
			},
			set: (t, k, v) => {
				t[k as string] = v;
				return true;
			},
		}) as unknown as CanvasRenderingContext2D;
		return { ctx, widths, texts };
	};
	const axes = (numbered: boolean) =>
		({
			id: "ax",
			authorId: "a",
			color: "#111",
			size: 4,
			z: 1,
			kind: "axes",
			...(numbered ? { numbered: true } : {}),
			points: [
				[0, 0, 0.5],
				[300, 200, 0.5],
			],
		}) as Stroke;
	const big = { minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 };

	test("the marks are drawn much thinner than the axes", () => {
		vi.stubGlobal(
			"Path2D",
			class {
				moveTo() {}
				lineTo() {}
				closePath() {}
				rect() {}
			},
		);
		const r = record();
		paintElements(r.ctx, [axes(false)], big, null);
		vi.unstubAllGlobals();
		const [axis, marks] = [Math.max(...r.widths), Math.min(...r.widths)];
		expect(axis).toBe(4);
		expect(marks).toBeLessThanOrEqual(axis * 0.4);
		expect(marks).toBeGreaterThan(0);
	});

	test("the numbers are written only when asked for", () => {
		vi.stubGlobal(
			"Path2D",
			class {
				moveTo() {}
				lineTo() {}
				closePath() {}
				rect() {}
			},
		);
		const off = record();
		paintElements(off.ctx, [axes(false)], big, null);
		const on = record();
		paintElements(on.ctx, [axes(true)], big, null);
		vi.unstubAllGlobals();
		expect(off.texts).toEqual([]);
		expect(on.texts).toContain("1");
		expect(on.texts).toContain("-1");
	});
});

describe("the laser pointer on the live layer", () => {
	test("a trail is drawn red, fainter towards its tail, and the layer is cleared when it is gone", () => {
		vi.stubGlobal("requestAnimationFrame", undefined);
		const alphas: number[] = [];
		const styles: string[] = [];
		let clears = 0;
		const ctx = new Proxy(
			{ globalAlpha: 1, strokeStyle: "" } as Record<string, unknown>,
			{
				get: (t, k) => {
					if (k === "stroke")
						return () => {
							alphas.push(t.globalAlpha as number);
							styles.push(String(t.strokeStyle));
						};
					if (k === "clearRect" || k === "fillRect") return () => clears++;
					if (k === "canvas") return {};
					if (k in t) return t[k as string];
					return () => ctx;
				},
				set: (t, k, v) => {
					t[k as string] = v;
					return true;
				},
			},
		) as unknown as CanvasRenderingContext2D;
		const canvas = () =>
			({
				getContext: () => ctx,
				width: 100,
				height: 100,
				style: {},
			}) as unknown as HTMLCanvasElement;
		const r = new CanvasRenderer(canvas(), canvas(), new Viewport());
		r.setLasers([
			{
				id: "a",
				points: [
					{ x: 0, y: 0, alpha: 0.2 },
					{ x: 10, y: 10, alpha: 0.6 },
					{ x: 20, y: 20, alpha: 1 },
				],
			},
		]);
		expect(alphas.length).toBeGreaterThanOrEqual(2);
		expect(alphas[0]).toBeLessThan(alphas[alphas.length - 1]);
		expect(styles.every((s) => /^#(f|e|d)[0-9a-f]{5}$|red|rgb/i.test(s))).toBe(
			true,
		);
		const before = clears;
		r.setLasers([]);
		expect(clears).toBeGreaterThan(before); // painted again, empty
		vi.unstubAllGlobals();
	});
});

describe("text sits where a text field puts it, in every browser (R-081)", () => {
	const textEl = (extra: Partial<Stroke> = {}) =>
		({
			id: "t",
			authorId: "a",
			color: "#111",
			size: 4,
			z: 1,
			kind: "text",
			text: "Mg\nMg",
			fontSize: 20,
			points: [[100, 50, 0.5]],
			...extra,
		}) as Stroke;
	const draw = (metrics?: { a: number; d: number }) => {
		const placed: { y: number; base: string }[] = [];
		const state: Record<string, unknown> = {};
		const ctx = new Proxy(state, {
			get: (t, k) => {
				if (k === "fillText")
					return (_: string, _x: number, y: number) =>
						placed.push({ y, base: String(t.textBaseline) });
				if (k === "measureText")
					return () =>
						metrics
							? {
									fontBoundingBoxAscent: metrics.a,
									fontBoundingBoxDescent: metrics.d,
								}
							: { width: 10 };
				if (k in t) return t[k as string];
				return () => ctx;
			},
			set: (t, k, v) => {
				t[k as string] = v;
				return true;
			},
		}) as unknown as CanvasRenderingContext2D;
		paintElements(
			ctx,
			[textEl()],
			{ minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 },
			null,
		);
		return placed;
	};

	test("the baseline comes from the font's own ascent and descent, as a text field's line does", () => {
		// line height 25, content area 12 + 4 = 16: half-leading 4.5, baseline 4.5 + 12 below the top
		const [first, second] = draw({ a: 12, d: 4 });
		expect(first.base).toBe("alphabetic");
		expect(first.y).toBeCloseTo(50 + 16.5);
		expect(second.y).toBeCloseTo(50 + 25 + 16.5);
	});

	test("without font metrics the old placement is kept", () => {
		const [first] = draw();
		expect(first.base).toBe("top");
		expect(first.y).toBeCloseTo(50 + 2.5);
	});
});

describe("Markdown text on the canvas (R-102)", () => {
	const draw = (content: string) => {
		const calls: { k: string; font: string; args: unknown[] }[] = [];
		const state: Record<string, unknown> = {};
		const ctx = new Proxy(state, {
			get: (t, k) => {
				if (k === "measureText")
					return () => ({
						width: 10,
						fontBoundingBoxAscent: 12,
						fontBoundingBoxDescent: 4,
					});
				if (k === "fillText" || k === "fillRect")
					return (...args: unknown[]) =>
						calls.push({ k: String(k), font: String(t.font), args });
				if (k in t) return t[k as string];
				return () => ctx;
			},
			set: (t, k, v) => {
				t[k as string] = v;
				return true;
			},
		}) as unknown as CanvasRenderingContext2D;
		const el = {
			id: "m",
			authorId: "a",
			color: "#111",
			size: 4,
			z: 1,
			kind: "text",
			text: content,
			fontSize: 20,
			points: [[100, 50, 0.5]],
		} as Stroke;
		paintElements(
			ctx,
			[el],
			{ minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 },
			null,
		);
		return calls;
	};

	test("a bold word is drawn in a bold font, on the same baseline as the rest", () => {
		const texts = draw("a **b** c").filter((c) => c.k === "fillText");
		expect(texts.map((c) => c.args[0])).toEqual(["a ", "b", " c"]);
		expect(texts[1].font).toContain("600");
		expect(texts[0].font).not.toContain("600");
		expect(new Set(texts.map((c) => c.args[2])).size).toBe(1);
		// no marker is ever drawn
		expect(texts.some((c) => String(c.args[0]).includes("*"))).toBe(false);
	});

	test("a strike is a thin bar across the word, a list item has its bullet", () => {
		const struck = draw("~~gone~~");
		expect(struck.some((c) => c.k === "fillRect")).toBe(true);
		const list = draw("- item").filter((c) => c.k === "fillText");
		expect(list.map((c) => c.args[0])).toEqual(["•", "item"]);
	});

	test("a plain text is still one fillText a line", () => {
		const texts = draw("a\nb").filter((c) => c.k === "fillText");
		expect(texts.map((c) => c.args[0])).toEqual(["a", "b"]);
	});
});

describe("the coordinate plane on the canvas (R-084)", () => {
	const plane = {
		id: "pl",
		authorId: "a",
		color: "#d32f2f",
		size: 4,
		z: 1,
		kind: "plane",
		numbered: true,
		points: [
			[0, 0, 0.5],
			[400, 400, 0.5],
		],
	} as Stroke;
	const big = { minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 };
	const record = () => {
		const strokes: { width: number; style: string }[] = [];
		const fills: string[] = [];
		const texts: string[] = [];
		const state: Record<string, unknown> = { lineWidth: 1, globalAlpha: 1 };
		const ctx = new Proxy(state, {
			get: (t, k) => {
				if (k === "stroke")
					return () =>
						strokes.push({
							width: t.lineWidth as number,
							style: String(t.strokeStyle),
						});
				if (k === "fill") return () => fills.push(String(t.fillStyle));
				// zoomed in: 100 device pixels to a board unit, so no line is held up to a pixel
				if (k === "getTransform") return () => ({ a: 100, b: 0 });
				if (k === "fillText") return (text: string) => texts.push(text);
				if (k in t) return t[k as string];
				return () => ctx;
			},
			set: (t, k, v) => {
				t[k as string] = v;
				return true;
			},
		}) as unknown as CanvasRenderingContext2D;
		return { ctx, strokes, fills, texts };
	};
	const stub = () =>
		vi.stubGlobal(
			"Path2D",
			class {
				moveTo() {}
				lineTo() {}
				closePath() {}
				rect() {}
			},
		);
	const paint = (ink?: (c: string) => string) => {
		stub();
		const r = record();
		paintElements(r.ctx, [plane], big, null, false, ink ? { ink } : {});
		vi.unstubAllGlobals();
		return r;
	};

	test("it is an opaque white sheet, so the board's own background does not show through", () => {
		const r = paint();
		expect(r.fills).toContain("#ffffff");
		// the sheet is painted before anything else of it
		expect(r.fills.indexOf("#ffffff")).toBeLessThanOrEqual(1);
	});

	test("in dark mode the sheet is a dark one, a little lighter than the board", () => {
		const dark = paint((c) =>
			c === "#ffffff" ? "#111111" : c === "#111111" ? "#8f8fff" : c,
		);
		expect(dark.fills).toContain("#1c1e26");
		expect(dark.fills).not.toContain("#ffffff");
	});

	test("the cells are in a quiet colour, never the colour of the axes, thin, with the axes drawn last and strongest", () => {
		const r = paint();
		const cells = r.strokes.find((s) => s.style === "#e4e9f2");
		const major = r.strokes.find((s) => s.style === "#c5d0e2");
		const axes = r.strokes.filter((s) => s.style === "#d32f2f");
		expect(cells).toBeDefined();
		expect(major).toBeDefined();
		expect(cells?.width).toBeLessThan(major?.width ?? 0);
		expect(major?.width).toBeLessThan(axes[0].width);
		expect(axes[0].width).toBe(4);
		// the axes come after the cells
		expect(r.strokes.findIndex((s) => s.style === "#d32f2f")).toBeGreaterThan(
			r.strokes.findIndex((s) => s.style === "#c5d0e2"),
		);
	});

	test("the numbers, with a real minus, and the letters x and y are written", () => {
		const r = paint();
		expect(r.texts).toEqual(
			expect.arrayContaining(["1", "\u22121", "4", "\u22124", "0", "x", "y"]),
		);
	});
});

describe("function graphs on the canvas (R-092)", () => {
	const proto = {
		id: "pf",
		authorId: "a",
		color: "#111111",
		size: 3,
		z: 1,
		kind: "plane",
		numbered: true,
		fns: [{ id: "f", k: "linear", c: [1, 0], color: "#1976d2", w: 2.5 }],
		points: [
			[0, 0, 0.5],
			[400, 400, 0.5],
		],
	} as unknown as Stroke;
	/** A new object each time: what is drawn is cached per element. */
	const mk = () => ({ ...proto }) as Stroke;
	const big = { minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 };
	const setup = () => {
		const lineTos: number[] = [0];
		vi.stubGlobal(
			"Path2D",
			class {
				moveTo() {}
				lineTo() {
					lineTos[0]++;
				}
				closePath() {}
				rect() {}
			},
		);
		const strokes: { width: number; style: string }[] = [];
		const state: Record<string, unknown> = { lineWidth: 1, globalAlpha: 1 };
		const ctx = new Proxy(state, {
			get: (t, k) => {
				if (k === "stroke")
					return () =>
						strokes.push({
							width: t.lineWidth as number,
							style: String(t.strokeStyle),
						});
				if (k === "getTransform") return () => ({ a: 100, b: 0 });
				if (k in t) return t[k as string];
				return () => ctx;
			},
			set: (t, k, v) => {
				t[k as string] = v;
				return true;
			},
		}) as unknown as CanvasRenderingContext2D;
		return { ctx, strokes, lineTos };
	};

	test("the curve is drawn in its own colour and width, after the axes", () => {
		const r = setup();
		paintElements(r.ctx, [mk()], big, null, false, {});
		vi.unstubAllGlobals();
		const curve = r.strokes.findIndex((s) => s.style === "#1976d2");
		expect(curve).toBeGreaterThan(-1);
		expect(r.strokes[curve].width).toBe(2.5);
		expect(curve).toBeGreaterThan(
			r.strokes.findIndex((s) => s.style === "#111111"),
		);
	});

	test("a plane without functions draws none", () => {
		const r = setup();
		paintElements(
			r.ctx,
			[{ ...mk(), fns: undefined } as Stroke],
			big,
			null,
			false,
			{},
		);
		vi.unstubAllGlobals();
		expect(r.strokes.some((s) => s.style === "#1976d2")).toBe(false);
	});

	test("the points are computed once per version of the plane, not on every repaint", () => {
		const r = setup();
		const el = mk();
		paintElements(r.ctx, [el], big, null, false, {});
		const first = r.lineTos[0];
		paintElements(r.ctx, [el], big, null, false, {});
		vi.unstubAllGlobals();
		// the curve alone is some 800 points; a repaint may only rebuild the small axis path
		expect(first).toBeGreaterThan(700);
		expect(r.lineTos[0] - first).toBeLessThan(300);
	});

	test("a changed coefficient makes a new curve", () => {
		const r = setup();
		paintElements(r.ctx, [mk()], big, null, false, {});
		const first = r.lineTos[0];
		const changed = {
			...mk(),
			fns: [{ ...((proto.fns as unknown[])[0] as object), c: [2, 0] }],
		} as unknown as Stroke;
		paintElements(r.ctx, [changed], big, null, false, {});
		vi.unstubAllGlobals();
		expect(r.lineTos[0]).toBeGreaterThan(first);
	});
});

describe("the hover outline on the live layer (R-112, ADR 0027)", () => {
	const setup = () => {
		vi.stubGlobal("requestAnimationFrame", undefined);
		vi.stubGlobal(
			"Path2D",
			class {
				moveTo() {}
				lineTo() {}
				quadraticCurveTo() {}
				closePath() {}
				rect() {}
				ellipse() {}
				arc() {}
				roundRect() {}
			},
		);
		const calls: string[] = [];
		const props: Record<string, unknown[]> = {};
		const target: Record<string, unknown> = { globalAlpha: 1, lineWidth: 1 };
		const ctx = new Proxy(target, {
			get: (t, k) => {
				if (k === "canvas") return { width: 100, height: 100 };
				if (k in t) return t[k as string];
				return (..._a: unknown[]) => {
					calls.push(String(k));
					return ctx;
				};
			},
			set: (t, k, v) => {
				t[k as string] = v;
				let list = props[k as string];
				if (!list) {
					list = [];
					props[k as string] = list;
				}
				list.push(v);
				return true;
			},
		}) as unknown as CanvasRenderingContext2D;
		const canvas = () =>
			({
				getContext: () => ctx,
				style: {},
				width: 100,
				height: 100,
			}) as unknown as HTMLCanvasElement;
		const renderer = new CanvasRenderer(canvas(), canvas(), new Viewport());
		return {
			renderer,
			calls,
			props,
			done: () => vi.unstubAllGlobals(),
		};
	};
	const ln = (id: string): Stroke => ({
		id,
		authorId: "a",
		color: "#111",
		size: 4,
		z: 1,
		kind: "line",
		points: [
			[0, 0, 0.5],
			[100, 0, 0.5],
		],
	});

	test("only a change of the hovered element repaints, and only the live layer", () => {
		const r = setup();
		const a = ln("a");
		const b = ln("b");
		r.renderer.redraw([a, b]);
		const clears = () => r.calls.filter((c) => c === "clearRect").length;
		const at = clears(); // committed and live painted once each
		r.renderer.setHover(a);
		expect(clears()).toBe(at + 1); // the live layer only
		r.renderer.setHover(a);
		expect(clears()).toBe(at + 1); // unchanged: no repaint at all
		r.renderer.setHover(b);
		expect(clears()).toBe(at + 2);
		r.renderer.setHover(null);
		expect(clears()).toBe(at + 3);
		r.done();
	});

	test("a thin translucent outline in the brand colour, no shadow blur like the glow", () => {
		const r = setup();
		const el = ln("a");
		r.renderer.redraw([el]);
		r.renderer.setHover(el);
		expect(r.props.strokeStyle ?? []).toContain("#5b5bf0");
		expect(r.calls).toContain("stroke");
		// lighter than the selection glow (R-058): no blurred shadow at all
		expect((r.props.shadowBlur ?? []).filter((b) => (b as number) > 0)).toEqual(
			[],
		);
		// translucent and a constant thin width on screen
		expect(
			(r.props.globalAlpha ?? []).some(
				(a) => Math.abs((a as number) - 0.55) < 1e-9,
			),
		).toBe(true);
		expect(r.props.lineWidth ?? []).toContain(2);
		r.done();
	});

	test("an image and a text get a thin frame on their edge, not a stroked path", () => {
		const r = setup();
		const img: Stroke = {
			id: "i",
			authorId: "a",
			color: "#111",
			size: 4,
			z: 1,
			kind: "image",
			src: "x",
			points: [
				[0, 0, 0.5],
				[50, 80, 0.5],
			],
		};
		r.renderer.redraw([img]);
		r.renderer.setHover(img);
		expect(r.calls).toContain("strokeRect");
		const txt: Stroke = {
			id: "t",
			authorId: "a",
			color: "#111",
			size: 4,
			z: 2,
			kind: "text",
			text: "hi",
			points: [[10, 10, 0.5]],
		};
		r.renderer.setHover(txt);
		expect(
			r.calls.filter((c) => c === "strokeRect").length,
		).toBeGreaterThanOrEqual(2);
		r.done();
	});
});
