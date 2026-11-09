/** A point of a stroke: x, y and pen pressure (0..1). */
export type Point = [x: number, y: number, pressure: number];

/** One drawn element. */
export interface Stroke {
	id: string;
	authorId: string;
	color: string;
	size: number;
	points: Point[];
}

type Op =
	| { type: "add"; stroke: Stroke; index: number }
	| { type: "erase"; stroke: Stroke; index: number };

interface History {
	undo: Op[];
	redo: Op[];
}

/** Board state: ordered strokes plus a separate undo/redo history per author. */
export class Board {
	strokes: Stroke[] = [];
	private histories = new Map<string, History>();

	private history(authorId: string): History {
		let h = this.histories.get(authorId);
		if (!h) {
			h = { undo: [], redo: [] };
			this.histories.set(authorId, h);
		}
		return h;
	}

	/** Appends a stroke drawn by `stroke.authorId`. */
	addStroke(stroke: Stroke): void {
		const op: Op = { type: "add", stroke, index: this.strokes.length };
		this.strokes.push(stroke);
		this.record(stroke.authorId, op);
	}

	/** Erases any author's stroke; the action goes to `authorId`'s history. */
	eraseStroke(authorId: string, strokeId: string): boolean {
		const index = this.strokes.findIndex((s) => s.id === strokeId);
		if (index < 0) return false;
		const [stroke] = this.strokes.splice(index, 1);
		this.record(authorId, { type: "erase", stroke, index });
		return true;
	}

	/** Undoes `authorId`'s last action. Returns false if there is none. */
	undo(authorId: string): boolean {
		const h = this.history(authorId);
		const op = h.undo.pop();
		if (!op) return false;
		this.apply(op, op.type === "add" ? "remove" : "insert");
		h.redo.push(op);
		return true;
	}

	/** Redoes `authorId`'s last undone action. Returns false if there is none. */
	redo(authorId: string): boolean {
		const h = this.history(authorId);
		const op = h.redo.pop();
		if (!op) return false;
		this.apply(op, op.type === "add" ? "insert" : "remove");
		h.undo.push(op);
		return true;
	}

	private record(authorId: string, op: Op): void {
		const h = this.history(authorId);
		h.undo.push(op);
		h.redo.length = 0;
	}

	private apply(op: Op, action: "insert" | "remove"): void {
		if (action === "insert") {
			this.strokes.splice(
				Math.min(op.index, this.strokes.length),
				0,
				op.stroke,
			);
		} else {
			const i = this.strokes.findIndex((s) => s.id === op.stroke.id);
			if (i >= 0) this.strokes.splice(i, 1);
		}
	}
}
