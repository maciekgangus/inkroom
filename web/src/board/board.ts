/** A point of a stroke: x, y and pen pressure (0..1). */
export type Point = [x: number, y: number, pressure: number];

/** One drawn element. Immutable once added. `z` (client clock, ms) orders drawing; ties break by id. */
export interface Stroke {
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
	| { t: "remove"; id: string };

interface Action {
	type: "add" | "erase";
	stroke: Stroke;
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

	/** Erases any author's stroke; the action goes to `authorId`'s history. */
	eraseStroke(authorId: string, strokeId: string): boolean {
		const stroke = this.strokes.find((s) => s.id === strokeId);
		if (!stroke) return false;
		this.remove(strokeId);
		this.record(authorId, { type: "erase", stroke });
		this.onOp?.({ t: "remove", id: strokeId });
		return true;
	}

	/** Undoes `authorId`'s last action. Returns false if there is none. */
	undo(authorId: string): boolean {
		const h = this.history(authorId);
		const action = h.undo.pop();
		if (!action) return false;
		this.apply(action, action.type === "add" ? "remove" : "add");
		h.redo.push(action);
		return true;
	}

	/** Redoes `authorId`'s last undone action. Returns false if there is none. */
	redo(authorId: string): boolean {
		const h = this.history(authorId);
		const action = h.redo.pop();
		if (!action) return false;
		this.apply(action, action.type === "add" ? "add" : "remove");
		h.undo.push(action);
		return true;
	}

	/** Applies an operation from the server. Idempotent; not reported via onOp, not in any history. */
	applyRemote(op: BoardOp): void {
		if (op.t === "add") this.insert(op.stroke);
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

	private apply(action: Action, what: "add" | "remove"): void {
		if (what === "add") {
			this.insert(action.stroke);
			this.onOp?.({ t: "add", stroke: action.stroke });
		} else {
			this.remove(action.stroke.id);
			this.onOp?.({ t: "remove", id: action.stroke.id });
		}
	}

	private insert(stroke: Stroke): void {
		if (this.strokes.some((s) => s.id === stroke.id)) return;
		let i = this.strokes.length;
		while (i > 0 && byOrder(this.strokes[i - 1], stroke) > 0) i--;
		this.strokes.splice(i, 0, stroke);
	}

	private remove(id: string): void {
		const i = this.strokes.findIndex((s) => s.id === id);
		if (i >= 0) this.strokes.splice(i, 1);
	}
}
