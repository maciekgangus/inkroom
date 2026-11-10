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
	| "bell"
	| "scurve"
	| "parabola"
	| "axes"
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
	/**
	 * The parameter of an adjustable shape (R-041): the slant of a trapezoid or parallelogram,
	 * the apex of a triangle, the radius of a rounded rectangle; missing means the usual look.
	 */
	adj?: number;
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
}

const byOrder = (a: Stroke, b: Stroke) =>
	a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Board state: strokes ordered by (z, id) plus a separate undo/redo history per author. */
export class Board {
	strokes: Stroke[] = [];
	/** Called for every local change (not for remote ones), so it can be sent to the server. */
	onOp: ((op: BoardOp) => void) | null = null;
	private histories = new Map<string, History>();

	private history(authorId: string): History {
		let h = this.histories.get(authorId);
		if (!h) {
			h = { undo: [], redo: [] };
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
		for (const s of strokes) this.insert(s);
		this.record(authorId, { type: "add", stroke: strokes[0], group: strokes });
		for (const s of strokes) this.onOp?.({ t: "add", stroke: s });
	}

	/** Erases any author's stroke; the action goes to `authorId`'s history. */
	eraseStroke(authorId: string, strokeId: string): boolean {
		const stroke = this.strokes.find((s) => s.id === strokeId);
		if (!stroke) return false;
		this.remove(strokeId);
		this.record(authorId, { type: "erase", stroke });
		this.onOp?.({ t: "remove", id: strokeId });
		return true;
	}

	/** Erases several elements as one undo step. Returns false if none of them exists. */
	eraseMany(authorId: string, strokeIds: string[]): boolean {
		const group = strokeIds
			.map((id) => this.strokes.find((s) => s.id === id))
			.filter((s): s is Stroke => !!s);
		if (group.length === 0) return false;
		for (const s of group) this.remove(s.id);
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
			const before = this.strokes.find((s) => s.id === after.id);
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
		h.undo.push(action);
		return true;
	}

	/** Applies an operation from the server. Idempotent; not reported via onOp, not in any history. */
	applyRemote(op: BoardOp): void {
		if (op.t === "add") this.insert(op.stroke);
		else if (op.t === "update") this.replace(op.stroke);
		else this.remove(op.id);
	}

	/** Replaces all strokes (server snapshot). */
	setStrokes(strokes: Stroke[]): void {
		this.strokes = [...strokes].sort(byOrder);
	}

	private record(authorId: string, action: Action): void {
		const h = this.history(authorId);
		h.undo.push(action);
		h.redo.length = 0;
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
			for (const s of action.group ?? [action.stroke]) {
				this.insert(s);
				this.onOp?.({ t: "add", stroke: s });
			}
		} else {
			for (const s of action.group ?? [action.stroke]) {
				this.remove(s.id);
				this.onOp?.({ t: "remove", id: s.id });
			}
		}
	}

	private insert(stroke: Stroke): void {
		if (this.strokes.some((s) => s.id === stroke.id)) return;
		let i = this.strokes.length;
		while (i > 0 && byOrder(this.strokes[i - 1], stroke) > 0) i--;
		this.strokes.splice(i, 0, stroke);
	}

	/** Swaps in a new version of an element that is on the board; ignores unknown ids. */
	private replace(stroke: Stroke): void {
		const i = this.strokes.findIndex((s) => s.id === stroke.id);
		if (i < 0) return;
		if (this.strokes[i].z === stroke.z) {
			this.strokes[i] = stroke;
			return;
		}
		// A new z moves the element in the drawing order.
		this.strokes.splice(i, 1);
		this.insert(stroke);
	}

	private remove(id: string): void {
		const i = this.strokes.findIndex((s) => s.id === id);
		if (i >= 0) this.strokes.splice(i, 1);
	}
}
