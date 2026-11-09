import type { Board, Point, Stroke } from "./board";
import { findHit } from "./hit";
import type { Viewport } from "./viewport";

/** The subset of PointerEvent the controller reads. */
export interface PointerInput {
	pointerId: number;
	pointerType: string;
	clientX: number;
	clientY: number;
	pressure: number;
	/** Which button changed state (1 = middle mouse button). */
	button?: number;
	getCoalescedEvents?: () => PointerInput[];
}

/** Drawing surface: a live layer for the stroke in progress and a committed layer. */
export interface Renderer {
	drawLive(stroke: Stroke | null): void;
	redraw(strokes: Stroke[]): void;
}

/** Current tool settings, mutated by the toolbar. */
export interface Settings {
	tool: "pen" | "eraser" | "pan" | "line" | "rect" | "circle" | "text";
	color: string;
	size: number;
}

const ERASER_RADIUS = 10;
/** A shape dragged less than this many screen pixels is treated as a stray click and dropped. */
const MIN_SHAPE_PX = 2;

type ShapeTool = "line" | "rect" | "circle";
const isShapeTool = (t: Settings["tool"]): t is ShapeTool =>
	t === "line" || t === "rect" || t === "circle";

/** Turns pointer input into board changes: draws with pen/mouse, ignores touch (palm rejection). */
export class Controller {
	private activeId: number | null = null;
	private current: Stroke | null = null;
	private lastZ = 0;
	private panFrom: { x: number; y: number } | null = null;
	private textTap = false;
	/** Called with the board position when the text tool is tapped; the UI then asks for the text. */
	onTextRequest: ((at: [number, number]) => void) | null = null;

	constructor(
		private board: Board,
		private renderer: Renderer,
		private settings: Settings,
		private viewport: Viewport,
		private authorId: string,
		private newId: () => string,
	) {}

	/** True while a pen or mouse pointer is down (touch gestures must then be ignored). */
	get busy(): boolean {
		return this.activeId !== null;
	}

	pointerDown(e: PointerInput): void {
		if (e.pointerType === "touch" || this.activeId !== null) return;
		this.activeId = e.pointerId;
		if (e.button === 1 || this.settings.tool === "pan") {
			this.panFrom = { x: e.clientX, y: e.clientY };
			return;
		}
		if (this.settings.tool === "eraser") {
			this.erase(e);
			return;
		}
		if (this.settings.tool === "text") {
			this.textTap = true; // acted on at release, so the text field is not stolen back by this click
			return;
		}
		const tool = this.settings.tool;
		const start = this.point(e);
		this.current = {
			id: this.newId(),
			authorId: this.authorId,
			color: this.settings.color,
			size: this.settings.size,
			z: this.nextZ(),
			...(isShapeTool(tool) ? { kind: tool } : {}),
			points: isShapeTool(tool) ? [start, [...start]] : [start],
		};
		this.renderer.drawLive(this.current);
	}

	pointerMove(e: PointerInput): void {
		if (e.pointerId !== this.activeId) return;
		if (this.panFrom) {
			this.viewport.panBy(
				e.clientX - this.panFrom.x,
				e.clientY - this.panFrom.y,
			);
			this.panFrom = { x: e.clientX, y: e.clientY };
			this.renderer.redraw(this.board.strokes);
			return;
		}
		if (this.settings.tool === "eraser") {
			this.erase(e);
			return;
		}
		if (!this.current) return;
		if (this.current.kind) {
			// A shape only needs where it ends.
			this.current.points[1] = this.point(e);
			this.renderer.drawLive(this.current);
			return;
		}
		const events = e.getCoalescedEvents?.() ?? [];
		for (const p of events.length ? events : [e]) {
			this.current.points.push(this.point(p));
		}
		this.renderer.drawLive(this.current);
	}

	pointerUp(e: PointerInput): void {
		if (e.pointerId !== this.activeId) return;
		this.activeId = null;
		this.panFrom = null;
		if (this.textTap) {
			this.textTap = false;
			this.onTextRequest?.(this.viewport.toWorld(e.clientX, e.clientY));
			return;
		}
		if (!this.current) return;
		if (this.current.kind && this.tooSmall(this.current)) {
			this.current = null;
			this.renderer.drawLive(null);
			return;
		}
		this.board.addStroke(this.current);
		this.current = null;
		this.renderer.drawLive(null);
		this.renderer.redraw(this.board.strokes);
	}

	pointerCancel(e: PointerInput): void {
		this.pointerUp(e);
	}

	/** Adds a text element at a board position; blank text is ignored. */
	addText(text: string, x: number, y: number): void {
		if (!text.trim()) return;
		this.board.addStroke({
			id: this.newId(),
			authorId: this.authorId,
			color: this.settings.color,
			size: this.settings.size,
			z: this.nextZ(),
			kind: "text",
			text,
			points: [[x, y, 0.5]],
		});
		this.renderer.redraw(this.board.strokes);
	}

	private tooSmall(shape: Stroke): boolean {
		const [a, b] = shape.points;
		return (
			Math.hypot(b[0] - a[0], b[1] - a[1]) * this.viewport.scale < MIN_SHAPE_PX
		);
	}

	undo(): void {
		if (this.board.undo(this.authorId))
			this.renderer.redraw(this.board.strokes);
	}

	redo(): void {
		if (this.board.redo(this.authorId))
			this.renderer.redraw(this.board.strokes);
	}

	/** A pointer position as a stroke point in board coordinates. */
	private point(e: PointerInput): Point {
		const [x, y] = this.viewport.toWorld(e.clientX, e.clientY);
		return [x, y, e.pressure || 0.5];
	}

	/** Client clock in ms, strictly increasing so this client's strokes never tie. */
	private nextZ(): number {
		this.lastZ = Math.max(Date.now(), this.lastZ + 1);
		return this.lastZ;
	}

	private erase(e: PointerInput): void {
		const [x, y] = this.viewport.toWorld(e.clientX, e.clientY);
		// The eraser is a fixed size on screen, whatever the zoom.
		const hit = findHit(
			this.board.strokes,
			x,
			y,
			ERASER_RADIUS / this.viewport.scale,
		);
		if (hit && this.board.eraseStroke(this.authorId, hit.id)) {
			this.renderer.redraw(this.board.strokes);
		}
	}
}
