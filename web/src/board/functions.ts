/**
 * Function graphs on a coordinate plane (R-092): the formulas, their points and how they are
 * written. Everything is computed on the client; the server only stores the list of functions
 * with their coefficients (a field of the plane element).
 */

export type FnKind =
	| "linear"
	| "quad"
	| "cubic"
	| "abs"
	| "exp"
	| "log"
	| "sqrt"
	| "hom"
	| "sin"
	| "cos"
	| "tan";

/** One curve on a plane: a formula of a known kind with its coefficients, a colour and a width. */
export interface PlaneFn {
	id: string;
	k: FnKind;
	/** The coefficients, in the order of the preset's `names`. */
	c: number[];
	color: string;
	/** Line width in board units. */
	w: number;
	/** For a quadratic: the vertex form a(x − p)² + q instead of ax² + bx + c. */
	canon?: boolean;
}

/** The most functions one plane holds and the largest coefficient allowed. */
export const MAX_FNS = 8;
export const COEF_LIMIT = 1000;
export const FN_MIN_WIDTH = 0.25;
export const FN_MAX_WIDTH = 20;

export interface FnPreset {
	label: string;
	/** The formula with letters for the coefficients, shown in the list of presets. */
	formula: string;
	/** The names of the coefficients, as the panel labels their fields. */
	names: string[];
	/** The coefficients a new function starts with (a curve worth looking at). */
	start: number[];
}

export const FN_PRESETS: Record<FnKind, FnPreset> = {
	linear: {
		label: "Liniowa",
		formula: "y = ax + b",
		names: ["a", "b"],
		start: [1, 0],
	},
	quad: {
		label: "Kwadratowa",
		formula: "y = ax² + bx + c",
		names: ["a", "b", "c"],
		start: [1, 0, 0],
	},
	cubic: {
		label: "Sześcienna",
		formula: "y = ax³ + bx² + cx + d",
		names: ["a", "b", "c", "d"],
		start: [1, 0, 0, 0],
	},
	abs: {
		label: "Wartość bezwzględna",
		formula: "y = a|x − p| + q",
		names: ["a", "p", "q"],
		start: [1, 0, 0],
	},
	exp: {
		label: "Wykładnicza",
		formula: "y = a·bˣ",
		names: ["a", "b"],
		start: [1, 2],
	},
	log: {
		label: "Logarytmiczna",
		formula: "y = a·log_b(x)",
		names: ["a", "b"],
		start: [1, 2],
	},
	sqrt: {
		label: "Pierwiastek",
		formula: "y = a√(x − p) + q",
		names: ["a", "p", "q"],
		start: [1, 0, 0],
	},
	hom: {
		label: "Homografia",
		formula: "y = a/(x − p) + q",
		names: ["a", "p", "q"],
		start: [1, 0, 0],
	},
	sin: {
		label: "Sinus",
		formula: "y = a·sin(bx + c) + d",
		names: ["a", "b", "c", "d"],
		start: [1, 1, 0, 0],
	},
	cos: {
		label: "Cosinus",
		formula: "y = a·cos(bx + c) + d",
		names: ["a", "b", "c", "d"],
		start: [1, 1, 0, 0],
	},
	tan: {
		label: "Tangens",
		formula: "y = a·tg(bx + c) + d",
		names: ["a", "b", "c", "d"],
		start: [1, 1, 0, 0],
	},
};

export const FN_KINDS = Object.keys(FN_PRESETS) as FnKind[];

/** A new function of a kind, with the preset's starting coefficients. */
export function newFn(k: FnKind, id: string, color: string): PlaneFn {
	return { id, k, c: [...FN_PRESETS[k].start], color, w: 2 };
}

/** The value of a function at x (in the plane's units); NaN where it is not defined. */
export function evalFn(f: PlaneFn, x: number): number {
	const c = f.c;
	switch (f.k) {
		case "linear":
			return c[0] * x + c[1];
		case "quad":
			return f.canon
				? c[0] * (x - c[1]) ** 2 + c[2]
				: c[0] * x * x + c[1] * x + c[2];
		case "cubic":
			return ((c[0] * x + c[1]) * x + c[2]) * x + c[3];
		case "abs":
			return c[0] * Math.abs(x - c[1]) + c[2];
		case "exp":
			return c[1] > 0 ? c[0] * c[1] ** x : Number.NaN;
		case "log":
			return c[1] > 0 && c[1] !== 1 && x > 0
				? (c[0] * Math.log(x)) / Math.log(c[1])
				: Number.NaN;
		case "sqrt":
			return x >= c[1] ? c[0] * Math.sqrt(x - c[1]) + c[2] : Number.NaN;
		case "hom":
			return x === c[1] ? Number.NaN : c[0] / (x - c[1]) + c[2];
		case "sin":
			return c[0] * Math.sin(c[1] * x + c[2]) + c[3];
		case "cos":
			return c[0] * Math.cos(c[1] * x + c[2]) + c[3];
		case "tan":
			return c[0] * Math.tan(c[1] * x + c[2]) + c[3];
	}
}

/**
 * Where a plane's sheet is and how its units map to board units: the origin (cx, cy), the sheet's
 * edges, and the board units per unit of x and of y (in π numbering a unit of x is a radian and
 * is as long as a cell of y: the cells along x are π/12 of it, so twelve of them make π).
 */
export interface Frame {
	cx: number;
	cy: number;
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	ux: number;
	uy: number;
}

/** The frame of a plane's sheet (its origin is the middle) for a cell of `cell` board units. */
export function planeFrame(
	look: { x0: number; y0: number; w: number; h: number },
	cell: number,
): Frame {
	return {
		cx: look.x0 + look.w / 2,
		cy: look.y0 + look.h / 2,
		x0: look.x0,
		y0: look.y0,
		x1: look.x0 + look.w,
		y1: look.y0 + look.h,
		// A radian is one cell of y long (π ≈ 3.14 cells), so the x axis in π is exact; the grid
		// lines along x are every π/12 of it (shape-parts.ts).
		ux: cell,
		uy: cell,
	};
}

/** Board units between two sampled points along x; fine enough to look smooth at high zoom. */
const SAMPLE_STEP = 0.5;
/** The most points one curve takes, so a huge sheet costs a bounded time. */
const MAX_SAMPLES = 4000;

/**
 * The curve as polylines in board units, across the sheet only. The line breaks where the
 * function is undefined and at an asymptote (a jump taller than the sheet), and points far
 * beyond the sheet are dropped (the renderer clips to the sheet).
 */
export function sampleFn(f: PlaneFn, fr: Frame): [number, number][][] {
	const w = fr.x1 - fr.x0;
	const h = fr.y1 - fr.y0;
	const n = Math.max(2, Math.min(MAX_SAMPLES, Math.ceil(w / SAMPLE_STEP)));
	const lo = fr.y0 - h;
	const hi = fr.y1 + h;
	const out: [number, number][][] = [];
	let cur: [number, number][] = [];
	let prev = Number.NaN;
	const flush = () => {
		if (cur.length > 1) out.push(cur);
		cur = [];
		prev = Number.NaN;
	};
	for (let i = 0; i <= n; i++) {
		const px = fr.x0 + (w * i) / n;
		const v = evalFn(f, (px - fr.cx) / fr.ux);
		const py = fr.cy - v * fr.uy;
		if (!Number.isFinite(py) || py < lo || py > hi) {
			flush();
			continue;
		}
		if (Number.isFinite(prev) && Math.abs(py - prev) > h) flush();
		cur.push([px, py]);
		prev = py;
	}
	flush();
	return out;
}

const MINUS = "−";

/** A number as it is written in a formula: a real minus sign, no trailing zeros. */
function num(n: number): string {
	const s = String(Math.round(n * 1e6) / 1e6);
	return s.startsWith("-") ? MINUS + s.slice(1) : s;
}

/** A sum of terms `[coefficient, what it multiplies]`, without the zero ones: "2x − 1". */
function sum(terms: [number, string][]): string {
	let out = "";
	for (const [c, what] of terms) {
		if (c === 0) continue;
		const abs = Math.abs(c);
		const body = what && abs === 1 ? what : num(abs) + what;
		if (!out) out = (c < 0 ? MINUS : "") + body;
		else out += ` ${c < 0 ? MINUS : "+"} ${body}`;
	}
	return out || "0";
}

/** The formula of a function with its coefficients, as "y = 2x − 1". */
export function fnLabel(f: PlaneFn): string {
	const [a, b, c, d] = f.c;
	const lead = (k: number): string =>
		k === 1 ? "" : k === -1 ? MINUS : num(k);
	const shift = (x: string, p: number): string =>
		p === 0 ? x : `(${x} ${p < 0 ? "+" : MINUS} ${num(Math.abs(p))})`;
	const plus = (q: number): string =>
		q === 0 ? "" : ` ${q < 0 ? MINUS : "+"} ${num(Math.abs(q))}`;
	switch (f.k) {
		case "linear":
			return `y = ${sum([
				[a, "x"],
				[b, ""],
			])}`;
		case "quad":
			return f.canon
				? `y = ${lead(a)}${shift("x", b)}²${plus(c)}`
				: `y = ${sum([
						[a, "x²"],
						[b, "x"],
						[c, ""],
					])}`;
		case "cubic":
			return `y = ${sum([
				[a, "x³"],
				[b, "x²"],
				[c, "x"],
				[d, ""],
			])}`;
		case "abs":
			return `y = ${lead(a)}|${sum([
				[1, "x"],
				[-b, ""],
			])}|${plus(c)}`;
		case "exp":
			return `y = ${a === 1 ? "" : `${num(a)}·`}${num(b)}ˣ`;
		case "log":
			return `y = ${a === 1 ? "" : `${num(a)}·`}log_${num(b)}(x)`;
		case "sqrt":
			return `y = ${lead(a)}√(${sum([
				[1, "x"],
				[-b, ""],
			])})${plus(c)}`;
		case "hom":
			return `y = ${num(a)}/(${sum([
				[1, "x"],
				[-b, ""],
			])})${plus(c)}`;
		default: {
			const name = f.k === "tan" ? "tg" : f.k;
			return `y = ${lead(a)}${name}(${sum([
				[b, "x"],
				[c, ""],
			])})${plus(d)}`;
		}
	}
}

/**
 * The formula with every coefficient written out, the zero and one ones too, so that a change in
 * any of them can be seen while a slider moves: "y = 1·x² + 0·x + 0".
 */
export function fnFormula(f: PlaneFn): string {
	const [a, b, c, d] = f.c;
	const add = (k: number): string =>
		` ${k < 0 ? MINUS : "+"} ${num(Math.abs(k))}`;
	// The shift p in "(x − p)": a negative p is added.
	const shifted = (p: number): string =>
		`x ${p < 0 ? "+" : MINUS} ${num(Math.abs(p))}`;
	switch (f.k) {
		case "linear":
			return `y = ${num(a)}·x${add(b)}`;
		case "quad":
			return f.canon
				? `y = ${num(a)}·(${shifted(b)})²${add(c)}`
				: `y = ${num(a)}·x²${add(b)}·x${add(c)}`;
		case "cubic":
			return `y = ${num(a)}·x³${add(b)}·x²${add(c)}·x${add(d)}`;
		case "abs":
			return `y = ${num(a)}·|${shifted(b)}|${add(c)}`;
		case "exp":
			return `y = ${num(a)}·${num(b)}ˣ`;
		case "log":
			return `y = ${num(a)}·log_${num(b)}(x)`;
		case "sqrt":
			return `y = ${num(a)}·√(${shifted(b)})${add(c)}`;
		case "hom":
			return `y = ${num(a)}/(${shifted(b)})${add(c)}`;
		default: {
			const name = f.k === "tan" ? "tg" : f.k;
			return `y = ${num(a)}·${name}(${num(b)}·x${add(c)})${add(d)}`;
		}
	}
}

const isNum = (v: unknown): v is number =>
	typeof v === "number" && Number.isFinite(v);

/**
 * Reads a list of functions from untrusted data (the clipboard, another client): null unless
 * every entry is a known kind with the right number of bounded coefficients, a plain colour and
 * a sane width, and the list is no longer than the most allowed.
 */
export function sanitizeFns(raw: unknown): PlaneFn[] | null {
	if (!Array.isArray(raw) || raw.length > MAX_FNS) return null;
	const out: PlaneFn[] = [];
	for (const r of raw) {
		if (typeof r !== "object" || r === null) return null;
		const { id, k, c, color, w, canon } = r as Record<string, unknown>;
		if (typeof id !== "string" || id === "" || id.length > 64) return null;
		if (typeof k !== "string" || !(k in FN_PRESETS)) return null;
		const preset = FN_PRESETS[k as FnKind];
		if (
			!Array.isArray(c) ||
			c.length !== preset.names.length ||
			!c.every((v) => isNum(v) && Math.abs(v) <= COEF_LIMIT)
		)
			return null;
		if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color))
			return null;
		if (!isNum(w) || w < FN_MIN_WIDTH || w > FN_MAX_WIDTH) return null;
		const fn: PlaneFn = { id, k: k as FnKind, c: c as number[], color, w };
		if (canon !== undefined) {
			if (typeof canon !== "boolean" || k !== "quad") return null;
			if (canon) fn.canon = true;
		}
		out.push(fn);
	}
	return out;
}
