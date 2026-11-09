import type { Board, Stroke } from "./board";
import { findHit } from "./hit";

/** The subset of PointerEvent the controller reads. */
export interface PointerInput {
	pointerId: number;
	pointerType: string;
	clientX: number;
	clientY: number;
	pressure: number;
	getCoalescedEvents?: () => PointerInput[];
}

/** Drawing surface: a live layer for the stroke in progress and a committed layer. */
export interface Renderer {
	drawLive(stroke: Stroke | null): void;
	redraw(strokes: Stroke[]): void;
}

/** Current tool settings, mutated by the toolbar. */
export interface Settings {
	tool: "pen" | "eraser";
	color: string;
	size: number;
}

const ERASER_RADIUS = 10;

/** Turns pointer input into board changes: draws with pen/mouse, ignores touch (palm rejection). */
export class Controller {
	private activeId: number | null = null;
	private current: Stroke | null = null;

	constructor(
		private board: Board,
		private renderer: Renderer,
		private settings: Settings,
		private authorId: string,
		private newId: () => string,
	) {}

	pointerDown(e: PointerInput): void {
		if (e.pointerType === "touch" || this.activeId !== null) return;
		this.activeId = e.pointerId;
		if (this.settings.tool === "eraser") {
			this.erase(e);
			return;
		}
		this.current = {
			id: this.newId(),
			authorId: this.authorId,
			color: this.settings.color,
			size: this.settings.size,
			points: [[e.clientX, e.clientY, e.pressure || 0.5]],
		};
		this.renderer.drawLive(this.current);
	}

	pointerMove(e: PointerInput): void {
		if (e.pointerId !== this.activeId) return;
		if (this.settings.tool === "eraser") {
			this.erase(e);
			return;
		}
		if (!this.current) return;
		const events = e.getCoalescedEvents?.() ?? [];
		for (const p of events.length ? events : [e]) {
			this.current.points.push([p.clientX, p.clientY, p.pressure || 0.5]);
		}
		this.renderer.drawLive(this.current);
	}

	pointerUp(e: PointerInput): void {
		if (e.pointerId !== this.activeId) return;
		this.activeId = null;
		if (!this.current) return;
		this.board.addStroke(this.current);
		this.current = null;
		this.renderer.drawLive(null);
		this.renderer.redraw(this.board.strokes);
	}

	pointerCancel(e: PointerInput): void {
		this.pointerUp(e);
	}

	undo(): void {
		if (this.board.undo(this.authorId))
			this.renderer.redraw(this.board.strokes);
	}

	redo(): void {
		if (this.board.redo(this.authorId))
			this.renderer.redraw(this.board.strokes);
	}

	private erase(e: PointerInput): void {
		const hit = findHit(
			this.board.strokes,
			e.clientX,
			e.clientY,
			ERASER_RADIUS,
		);
		if (hit && this.board.eraseStroke(this.authorId, hit.id)) {
			this.renderer.redraw(this.board.strokes);
		}
	}
}
