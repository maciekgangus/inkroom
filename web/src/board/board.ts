import type { PlaneFn } from "./functions";
import { packStroke, pointCount } from "./points";
/** A point of a stroke: x, y and pen pressure (0..1). */
export type Point = [x: number, y: number, pressure: number];

/** What an element is; a missing kind means a freehand stroke (ADR 0006). */
export type ElementKind =
	| "stroke"
	| "line"
	| "rect"
	| "circle"
	| "ellipse"
	| "trapezoid"
	| "rhombus"
	| "parallelogram"
	| "triangle"
	| "righttriangle"
	| "righttrapezoid"
	| "pentagon"
	| "hexagon"
	| "octagon"
	| "star"
	| "roundrect"
	| "semicircle"
	| "quadrant"
	| "cube"
	| "cuboid"
	| "cylinder"
	| "parallelepiped"
	| "pyramid"
	| "cone"
	| "sphere"
	| "tetrahedron"
	| "hexprism"
	| "octahedron"
	| "pyramidfrustum"
	| "conefrustum"
	| "sine"
	| "cosine"
	| "bell"
	| "scurve"
	| "parabola"
	| "axes"
	| "plane"
	| "text"
	| "image";

/**
 * One element on the board: a freehand stroke, a shape or a text. Immutable once added.
 * `z` (client clock, ms) orders drawing; ties break by id. Geometry is in `points`
 * (board coordinates): line = start and end, rect and ellipse = two corners, circle = centre and a
 * point on it, text = the top-left anchor.
 */
export interface Stroke {
	kind?: ElementKind;
	/** The content, for kind "text". */
	text?: string;
	/** The uploaded image's id, for kind "image" (ADR 0007). */
	src?: string;
	/** Rotation in radians around the centre of the (unrotated) geometry (ADR 0008). */
	rot?: number;
	/** Line style; missing means solid. */
	dash?: "solid" | "dashed" | "dotted" | "natural";
	/** Fill colour of a rectangle or circle; missing means no fill. */
	fill?: string;
	/** 0 to 1; missing means 1. */
	opacity?: number;
	/** Font size of a text in board units; missing means the size table value. */
	fontSize?: number;
	/** Font family of a text (R-101): sans (Inter, the default), serif, hand or mono. */
	font?: "sans" | "serif" | "hand" | "mono";
	/**
	 * Free vertices of a polygon shape (R-047): the outline as fractions of its box, which replace
	 * the outline the kind would give. The box still scales, turns and moves it all as one.
	 */
	verts?: [number, number][];
	/**
	 * The parameter of an adjustable shape (R-041): the slant of a trapezoid or parallelogram,
	 * the apex of a triangle, the radius of a rounded rectangle; missing means the usual look.
	 */
	adj?: number;
	/** A coordinate system numbered along its marks: 1 2 3 and -1 -2 -3 on both axes. */
	numbered?: boolean;
	/** For a coordinate plane (R-084): the size of a cell in board units; missing means 40. */
	cell?: number;
	/** For a coordinate plane: false hides the grid (the frame stays); missing means shown. */
	grid?: boolean;
	/** For a coordinate plane: false hides the axes and their numbers; missing means shown. */
	showAxes?: boolean;
	/** For a coordinate plane: the x axis is numbered in π and its cells are twelfths of π. */
	pi?: boolean;
	/** For a coordinate plane (R-092): the function graphs on it, each a formula with coefficients. */
	fns?: PlaneFn[];
	/** Width of a text area in board units: the text wraps to it (R-044); missing for a text at a point. */
	width?: number;
	id: string;
	authorId: string;
	color: string;
	size: number;
	z: number;
	points: Point[];
}

/** A change to the set of strokes, as sent between clients (ADR 0004). */
export type BoardOp =
	| { t: "add"; stroke: Stroke }
	| { t: "update"; stroke: Stroke }
	| { t: "remove"; id: string };

interface Action {
	type: "add" | "erase" | "update";
	/** The element as it was added or erased, or the first new version for an update. */
	stroke: Stroke;
	/** For an update: every element changed by one gesture, as it was and as it became. */
	changes?: { before: Stroke; after: Stroke }[];
	/** For an add or erase of several elements at once: all of them (`stroke` is the first). */
	group?: Stroke[];
}

interface History {
	undo: Action[];
	redo: Action[];
	/** The weight of the undo steps kept (see `weigh`). */
	weight: number;
}

/**
 * How much undo history an author keeps (R-008, R-100). The erased strokes an old step holds stay
 * in memory as long as the step does, so a long session of erasing would fill a tablet: past
 * these limits the oldest steps are dropped (the elements they changed stay on the board, only
 * their undo is gone). The newest step is always kept, however large, until another step follows.
 */
export interface HistoryLimits {
	/** Most undo steps per author. */
	maxSteps: number;
	/** Most points (plus a small weight per element) the undo steps of one author may hold together. */
	maxPoints: number;
}

/** Default limits: 200 steps; about 30 MB of points on a small tablet, 80 MB with 8 GB or more. */
export const HISTORY_LIMITS: HistoryLimits = {
	maxSteps: 200,
	maxPoints:
		((navigator as { deviceMemory?: number }).deviceMemory ?? 4) >= 8
			? 1_500_000
			: 600_000,
};

/** What a step costs against `maxPoints`: the points of every element it holds, plus 8 per element. */
function weigh(action: Action): number {
	let w = 0;
	if (action.changes) {
		for (const c of action.changes)
			w += pointCount(c.before) + pointCount(c.after) + 16;
	} else {
		for (const s of action.group ?? [action.stroke]) w += pointCount(s) + 8;
	}
	return w;
}

const byOrder = (a: Stroke, b: Stroke) =>
	a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Board state: strokes ordered by (z, id) plus a separate undo/redo history per author. */
export class Board {
	strokes: Stroke[] = [];
	/** Grows with every change of the elements, so what is drawn from them can be kept until then. */
	version = 0;
	private changeListeners: (() => void)[] = [];

	/**
	 * Calls `fn` after every change of the elements (local or remote). Whoever keeps a list of
	 * elements derived from the board (a selection) uses it to let go of them at once: a stale list
	 * would keep erased strokes alive (R-100). The listener lives as long as the board does.
	 */
	onChange(fn: () => void): void {
		this.changeListeners.push(fn);
	}

	private bump(): void {
		this.version++;
		for (const fn of this.changeListeners) fn();
	}

	/** Called for every local change (not for remote ones), so it can be sent to the server. */
	onOp: ((op: BoardOp) => void) | null = null;
	private histories = new Map<string, History>();
	/** Every element by id, so lookups do not scan the whole board. */
	private byId = new Map<string, Stroke>();
	private limits: HistoryLimits;

	constructor(limits: HistoryLimits = HISTORY_LIMITS) {
		this.limits = limits;
	}

	/** How much history an author holds (for tests and the memory benchmark). */
	historyStats(authorId: string): {
		steps: number;
		redo: number;
		points: number;
	} {
		const h = this.history(authorId);
		return { steps: h.undo.length, redo: h.redo.length, points: h.weight };
	}

	private history(authorId: string): History {
		let h = this.histories.get(authorId);
		if (!h) {
			h = { undo: [], redo: [], weight: 0 };
			this.histories.set(authorId, h);
		}
		return h;
	}

	/** Adds a stroke drawn by `stroke.authorId`. */
	addStroke(stroke: Stroke): void {
		this.insert(stroke);
		this.record(stroke.authorId, { type: "add", stroke });
		this.onOp?.({ t: "add", stroke });
	}

	/** Adds several elements as one undo step, one `add` operation each. */
	addMany(authorId: string, strokes: Stroke[]): void {
		if (strokes.length === 0) return;
		this.insertMany(strokes);
		this.record(authorId, { type: "add", stroke: strokes[0], group: strokes });
		for (const s of strokes) this.onOp?.({ t: "add", stroke: s });
	}

	/**
	 * Starts a batch of elements that arrive one by one (the pages of a PDF): each `add` puts the
	 * element on the board and sends it at once, and `done` makes all of them one undo step.
	 */
	addBatch(authorId: string): { add(stroke: Stroke): void; done(): void } {
		const added: Stroke[] = [];
		let finished = false;
		return {
			add: (stroke) => {
				this.insert(stroke);
				added.push(stroke);
				this.onOp?.({ t: "add", stroke });
			},
			done: () => {
				if (finished || added.length === 0) return;
				finished = true;
				this.record(authorId, { type: "add", stroke: added[0], group: added });
			},
		};
	}

	/** Erases any author's stroke; the action goes to `authorId`'s history. */
	eraseStroke(authorId: string, strokeId: string): boolean {
		const stroke = this.byId.get(strokeId);
		if (!stroke) return false;
		this.remove(strokeId);
		this.record(authorId, { type: "erase", stroke });
		this.onOp?.({ t: "remove", id: strokeId });
		return true;
	}

	/**
	 * Starts a batch of erasing that goes on over time (one drag of the eraser): each `erase`
	 * takes the element off the board and sends it at once, and `done` makes all of them one undo
	 * step (R-078).
	 */
	eraseBatch(authorId: string): {
		erase(strokeId: string): boolean;
		done(): void;
	} {
		const erased: Stroke[] = [];
		let finished = false;
		return {
			erase: (strokeId) => {
				const stroke = this.byId.get(strokeId);
				if (!stroke) return false;
				this.remove(strokeId);
				erased.push(stroke);
				this.onOp?.({ t: "remove", id: strokeId });
				return true;
			},
			done: () => {
				if (finished || erased.length === 0) return;
				finished = true;
				this.record(authorId, {
					type: "erase",
					stroke: erased[0],
					group: erased,
				});
			},
		};
	}

	/** Erases several elements as one undo step. Returns false if none of them exists. */
	eraseMany(authorId: string, strokeIds: string[]): boolean {
		const group = strokeIds
			.map((id) => this.byId.get(id))
			.filter((s): s is Stroke => !!s);
		if (group.length === 0) return false;
		this.removeMany(group);
		this.record(authorId, { type: "erase", stroke: group[0], group });
		for (const s of group) this.onOp?.({ t: "remove", id: s.id });
		return true;
	}

	/**
	 * Replaces an existing element with a new version (move, resize, restyle); the action goes
	 * to `authorId`'s history. Returns false if the element is gone.
	 */
	updateElement(authorId: string, next: Stroke): boolean {
		return this.updateMany(authorId, [next]);
	}

	/**
	 * Replaces several elements in one go: one undo step, one `update` operation each. Elements
	 * that are gone are skipped; returns false if none was left to change.
	 */
	updateMany(authorId: string, next: Stroke[]): boolean {
		const changes: { before: Stroke; after: Stroke }[] = [];
		for (const after of next) {
			const before = this.byId.get(after.id);
			if (before) changes.push({ before, after });
		}
		if (changes.length === 0) return false;
		for (const c of changes) this.replace(c.after);
		this.record(authorId, {
			type: "update",
			stroke: changes[0].after,
			changes,
		});
		for (const c of changes) this.onOp?.({ t: "update", stroke: c.after });
		return true;
	}

	/** Undoes `authorId`'s last action. Returns false if there is none. */
	undo(authorId: string): boolean {
		const h = this.history(authorId);
		const action = h.undo.pop();
		if (!action) return false;
		this.apply(
			action,
			action.type === "add"
				? "remove"
				: action.type === "erase"
					? "add"
					: "revert",
		);
		h.weight -= weigh(action);
		h.redo.push(action);
		return true;
	}

	/** Redoes `authorId`'s last undone action. Returns false if there is none. */
	redo(authorId: string): boolean {
		const h = this.history(authorId);
		const action = h.redo.pop();
		if (!action) return false;
		this.apply(
			action,
			action.type === "add"
				? "add"
				: action.type === "erase"
					? "remove"
					: "reapply",
		);
		h.weight += weigh(action);
		h.undo.push(action);
		return true;
	}

	/**
	 * Applies an operation from the server. Idempotent; not reported via onOp, not in any history.
	 * False when it changed nothing (the echo of an element we already have), so no repaint.
	 */
	applyRemote(op: BoardOp): boolean {
		const before = this.version;
		if (op.t === "add") this.insert(op.stroke);
		else if (op.t === "update") this.replace(op.stroke);
		else this.remove(op.id);
		return this.version !== before;
	}

	/** Replaces all strokes (server snapshot). */
	setStrokes(strokes: Stroke[]): void {
		for (const s of strokes) packStroke(s);
		this.strokes = [...strokes].sort(byOrder);
		this.byId = new Map(this.strokes.map((s) => [s.id, s]));
		this.bump();
	}

	private record(authorId: string, action: Action): void {
		const h = this.history(authorId);
		h.undo.push(action);
		h.weight += weigh(action);
		h.redo.length = 0;
		// Past the limits drop the oldest steps, but never the newest one.
		let drop = 0;
		while (
			h.undo.length - drop > 1 &&
			(h.undo.length - drop > this.limits.maxSteps ||
				h.weight > this.limits.maxPoints)
		) {
			h.weight -= weigh(h.undo[drop]);
			drop++;
		}
		if (drop > 0) h.undo.splice(0, drop);
	}

	private apply(
		action: Action,
		what: "add" | "remove" | "revert" | "reapply",
	): void {
		if (what === "revert" || what === "reapply") {
			for (const c of action.changes ?? []) {
				const version = what === "revert" ? c.before : c.after;
				this.replace(version);
				this.onOp?.({ t: "update", stroke: version });
			}
		} else if (what === "add") {
			const group = action.group ?? [action.stroke];
			this.insertMany(group);
			for (const s of group) this.onOp?.({ t: "add", stroke: s });
		} else {
			const group = action.group ?? [action.stroke];
			this.removeMany(group);
			for (const s of group) this.onOp?.({ t: "remove", id: s.id });
		}
	}

	private insert(stroke: Stroke): void {
		if (this.byId.has(stroke.id)) return;
		packStroke(stroke);
		let i = this.strokes.length;
		while (i > 0 && byOrder(this.strokes[i - 1], stroke) > 0) i--;
		this.strokes.splice(i, 0, stroke);
		this.byId.set(stroke.id, stroke);
		this.bump();
	}

	/** Adds several elements in one pass (a merge, not one splice each); ones already here are skipped. */
	private insertMany(strokes: Stroke[]): void {
		const fresh = strokes.filter((s) => !this.byId.has(s.id));
		if (fresh.length === 0) return;
		if (fresh.length === 1) {
			this.insert(fresh[0]);
			return;
		}
		for (const s of fresh) packStroke(s);
		fresh.sort(byOrder);
		const merged: Stroke[] = [];
		let a = 0;
		let b = 0;
		while (a < this.strokes.length || b < fresh.length) {
			if (
				b >= fresh.length ||
				(a < this.strokes.length && byOrder(this.strokes[a], fresh[b]) <= 0)
			)
				merged.push(this.strokes[a++]);
			else merged.push(fresh[b++]);
		}
		// in place: others hold this array
		this.strokes.length = 0;
		for (const s of merged) this.strokes.push(s);
		for (const s of fresh) this.byId.set(s.id, s);
		this.bump();
	}

	/** The index of an element in the drawing order (binary search on (z, id)), or -1. */
	private indexOf(stroke: Stroke): number {
		let lo = 0;
		let hi = this.strokes.length - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			const c = byOrder(this.strokes[mid], stroke);
			if (c === 0) return mid;
			if (c < 0) lo = mid + 1;
			else hi = mid - 1;
		}
		return -1;
	}

	/** Swaps in a new version of an element that is on the board; ignores unknown ids. */
	private replace(stroke: Stroke): void {
		const old = this.byId.get(stroke.id);
		if (!old) return;
		const i = this.indexOf(old);
		if (i < 0) return;
		packStroke(stroke);
		this.bump();
		if (old.z === stroke.z) {
			this.strokes[i] = stroke;
			this.byId.set(stroke.id, stroke);
			return;
		}
		// A new z moves the element in the drawing order.
		this.strokes.splice(i, 1);
		this.byId.delete(stroke.id);
		this.insert(stroke);
	}

	private remove(id: string): void {
		const old = this.byId.get(id);
		if (!old) return;
		const i = this.indexOf(old);
		if (i < 0) return;
		this.strokes.splice(i, 1);
		this.byId.delete(id);
		this.bump();
	}

	/** Takes several elements off in one pass; unknown ones are skipped. */
	private removeMany(strokes: Stroke[]): void {
		const gone = new Set<string>();
		for (const s of strokes) if (this.byId.has(s.id)) gone.add(s.id);
		if (gone.size === 0) return;
		let w = 0;
		for (let r = 0; r < this.strokes.length; r++) {
			const s = this.strokes[r];
			if (!gone.has(s.id)) this.strokes[w++] = s;
		}
		this.strokes.length = w;
		for (const id of gone) this.byId.delete(id);
		this.bump();
	}
}
