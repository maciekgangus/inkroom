import type { Board, Point, Stroke } from "./board";
import { findHit } from "./hit";
import {
	type Corner,
	hitHandle,
	imageRect,
	moveRect,
	resizeFromCorner,
} from "./image-geometry";
import type { Rect, Viewport } from "./viewport";

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
	/** Shows the selection frame and handles of the selected image (null hides them). */
	setSelection?(rect: Rect | null): void;
}

/** Current tool settings, mutated by the toolbar. */
export interface Settings {
	tool:
		| "pen"
		| "eraser"
		| "pan"
		| "line"
		| "rect"
		| "circle"
		| "text"
		| "select";
	color: string;
	size: number;
}

const ERASER_RADIUS = 10;
/** A shape dragged less than this many screen pixels is treated as a stray click and dropped. */
const MIN_SHAPE_PX = 2;
/** Grab radius of a selection handle and the smallest width an image can be resized to, in screen pixels. */
const HANDLE_PX = 12;
const MIN_IMAGE_PX = 24;

/** An image being moved or resized; `draft` is the preview currently applied to the board. */
interface Edit {
	mode: "move" | "resize";
	corner?: Corner;
	start: [number, number];
	original: Stroke;
	draft: Stroke;
}

const withRect = (el: Stroke, r: Rect): Stroke => ({
	...el,
	points: [
		[r.minX, r.minY, 0.5],
		[r.maxX, r.maxY, 0.5],
	],
});

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
	private selectedId: string | null = null;
	private edit: Edit | null = null;
	/** Called when the selected image changes, so the UI can show or hide its controls. */
	onSelectionChange: (() => void) | null = null;
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

	/** The selected image, if any. */
	get selected(): Stroke | null {
		return this.board.strokes.find((s) => s.id === this.selectedId) ?? null;
	}

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
		if (this.settings.tool === "select") {
			this.startSelect(e);
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
		if (this.edit) {
			this.dragEdit(e);
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
		if (this.edit) {
			this.finishEdit();
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

	/** Adds an image element covering `rect` and selects it. Returns its id. */
	addImage(src: string, rect: Rect): string {
		const el = withRect(
			{
				id: this.newId(),
				authorId: this.authorId,
				color: "#000000",
				size: 1,
				z: this.nextZ(),
				kind: "image",
				src,
				points: [],
			},
			rect,
		);
		this.board.addStroke(el);
		this.renderer.redraw(this.board.strokes);
		this.select(el.id);
		return el.id;
	}

	/** Selects an image (or clears the selection with null) and shows its frame. */
	select(id: string | null): void {
		this.selectedId = id;
		const el = this.selected;
		this.renderer.setSelection?.(el ? imageRect(el) : null);
		this.onSelectionChange?.();
	}

	/** Removes the selected image (undoable). Returns false if nothing is selected. */
	deleteSelected(): boolean {
		const el = this.selected;
		if (!el || !this.board.eraseStroke(this.authorId, el.id)) return false;
		this.select(null);
		this.renderer.redraw(this.board.strokes);
		return true;
	}

	private startSelect(e: PointerInput): void {
		const p = this.viewport.toWorld(e.clientX, e.clientY);
		const sel = this.selected;
		const corner = sel
			? hitHandle(imageRect(sel), p, HANDLE_PX / this.viewport.scale)
			: null;
		if (sel && corner) {
			this.edit = {
				mode: "resize",
				corner,
				start: p,
				original: sel,
				draft: sel,
			};
			return;
		}
		const hit = [...this.board.strokes].reverse().find((s) => {
			if (s.kind !== "image") return false;
			const r = imageRect(s);
			return (
				p[0] >= r.minX && p[0] <= r.maxX && p[1] >= r.minY && p[1] <= r.maxY
			);
		});
		if (hit) {
			this.select(hit.id);
			this.edit = { mode: "move", start: p, original: hit, draft: hit };
		} else {
			this.select(null);
		}
	}

	private dragEdit(e: PointerInput): void {
		const edit = this.edit;
		if (!edit) return;
		const p = this.viewport.toWorld(e.clientX, e.clientY);
		const base = imageRect(edit.original);
		const rect =
			edit.mode === "resize" && edit.corner
				? resizeFromCorner(
						base,
						edit.corner,
						p,
						MIN_IMAGE_PX / this.viewport.scale,
					)
				: moveRect(base, p[0] - edit.start[0], p[1] - edit.start[1]);
		edit.draft = withRect(edit.original, rect);
		// A local preview only: nothing is sent and no history is written until release.
		this.board.applyRemote({ t: "update", stroke: edit.draft });
		this.renderer.setSelection?.(rect);
		this.renderer.redraw(this.board.strokes);
	}

	private finishEdit(): void {
		const edit = this.edit;
		this.edit = null;
		if (!edit || edit.draft === edit.original) return;
		// Put the original back, then record the change once so it is one undo step and one message.
		this.board.applyRemote({ t: "update", stroke: edit.original });
		this.board.updateElement(this.authorId, edit.draft);
		this.renderer.setSelection?.(imageRect(edit.draft));
		this.renderer.redraw(this.board.strokes);
	}

	/** Keeps the selection frame in step after undo or redo changed the board. */
	private syncSelection(): void {
		const el = this.selected;
		if (!el) this.selectedId = null;
		this.renderer.setSelection?.(el ? imageRect(el) : null);
		this.onSelectionChange?.();
	}

	private tooSmall(shape: Stroke): boolean {
		const [a, b] = shape.points;
		return (
			Math.hypot(b[0] - a[0], b[1] - a[1]) * this.viewport.scale < MIN_SHAPE_PX
		);
	}

	undo(): void {
		if (this.board.undo(this.authorId)) {
			this.renderer.redraw(this.board.strokes);
			this.syncSelection();
		}
	}

	redo(): void {
		if (this.board.redo(this.authorId)) {
			this.renderer.redraw(this.board.strokes);
			this.syncSelection();
		}
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
