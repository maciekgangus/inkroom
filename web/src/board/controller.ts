import type { Board, Point, Stroke } from "./board";
import { intersects } from "./bounds";
import { findHit, objectHit } from "./hit";
import {
	cornerPos,
	type Frame,
	frameOf,
	HANDLE_PX,
	hitFrameHandle,
	needsFrame,
	oppositeCorner,
	ROT_OFFSET_PX,
} from "./selection-frame";
import { applyStyle, type StylePatch } from "./style";
import {
	rotateEl,
	scaleEl,
	snapAngle,
	softSnapAngle,
	translateEl,
	worldBounds,
} from "./transform";
import type { Rect, Viewport } from "./viewport";

/** The subset of PointerEvent the controller reads. */
export interface PointerInput {
	pointerId: number;
	pointerType: string;
	clientX: number;
	clientY: number;
	pressure: number;
	/** Which button changed state (0 left, 1 middle, 2 right; missing counts as left). */
	button?: number;
	/** Shift held: add to the selection, snap a rotation. */
	shiftKey?: boolean;
	getCoalescedEvents?: () => PointerInput[];
}

/** Drawing surface: a live layer for the stroke in progress and a committed layer. */
export interface Renderer {
	drawLive(stroke: Stroke | null): void;
	redraw(strokes: Stroke[]): void;
	/** Shows the selection frame and handles (null hides them). */
	setSelection?(frame: Frame | null): void;
	/** Makes the selected elements glow (an empty list clears it). */
	setHighlight?(els: Stroke[]): void;
	/** Shows the rubber band while dragging over empty space (null hides it). */
	setMarquee?(rect: Rect | null): void;
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
	/** The shape tool K goes back to: the last one chosen (R-030); a rectangle if none. */
	lastShape?: "rect" | "circle";
	color: string;
	size: number;
}

export const ERASER_RADIUS = 10;
/** A shape dragged less than this many screen pixels is treated as a stray click and dropped. */
const MIN_SHAPE_PX = 2;
/** How far from an object (screen pixels) a click still selects it. */
/** How far (px) from an element still grabs it: generous, so thin lines are easy to catch. */
const HIT_PX = 10;
/** The smallest a selection can be scaled down to, in screen pixels. */
const MIN_SELECTION_PX = 24;
const SNAP_STEP = Math.PI / 12; // 15 degrees, with Shift
const SOFT_SNAP = (3 * Math.PI) / 180; // pulls onto right angles

type Vec = [number, number];

/** A gesture in progress on the selection; `drafts` is the preview currently on the board. */
type Edit =
	| { mode: "move"; start: Vec; originals: Stroke[]; drafts: Stroke[] }
	| {
			mode: "scale";
			originals: Stroke[];
			drafts: Stroke[];
			frame: Frame;
			anchor: Vec;
			handle: Vec;
	  }
	| {
			mode: "rotate";
			originals: Stroke[];
			drafts: Stroke[];
			frame: Frame;
			startAngle: number;
	  }
	| {
			mode: "marquee";
			start: Vec;
			additive: boolean;
			base: string[];
			rect: Rect | null;
	  };

const withRect = (el: Stroke, r: Rect): Stroke => ({
	...el,
	points: [
		[r.minX, r.minY, 0.5],
		[r.maxX, r.maxY, 0.5],
	],
});

type ShapeTool = "line" | "rect" | "circle";
/** How far (px) the right button may move and still count as a click, not a pan. */
const RIGHT_CLICK_SLOP = 4;

const isShapeTool = (t: Settings["tool"]): t is ShapeTool =>
	t === "line" || t === "rect" || t === "circle";

/** Turns pointer input into board changes: draws with pen/mouse, ignores touch (palm rejection). */
export class Controller {
	private activeId: number | null = null;
	private current: Stroke | null = null;
	private lastZ = 0;
	private panFrom: { x: number; y: number } | null = null;
	/** Set while the right button is down: where it went down and whether it has moved (R-029). */
	private rightPress: { x: number; y: number; moved: boolean } | null = null;
	private textTap = false;
	private selectedIds: string[] = [];
	/** Elements copied with copySelected, pasted by paste (not shared between clients). */
	private clipboard: Stroke[] = [];
	private edit: Edit | null = null;
	/** Called when the selected image changes, so the UI can show or hide its controls. */
	onSelectionChange: (() => void) | null = null;
	/** Called with a text element when it is double-clicked, so the UI can edit its content. */
	onTextEdit: ((el: Stroke) => void) | null = null;
	/** Called with the board position when the text tool is tapped; the UI then asks for the text. */
	onTextRequest: ((at: [number, number]) => void) | null = null;
	/** Called when the right button is released without moving, so the UI can open its menu. */
	onRightClick: ((e: PointerInput) => void) | null = null;

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
		return this.selection[0] ?? null;
	}

	/** The selected elements that are still on the board. */
	get selection(): Stroke[] {
		return this.board.strokes.filter((s) => this.selectedIds.includes(s.id));
	}

	/** True while the board is being dragged (hand tool, middle or right button). */
	get panning(): boolean {
		return this.panFrom !== null;
	}

	/** True while a pen or mouse pointer is down (touch gestures must then be ignored). */
	get busy(): boolean {
		return this.activeId !== null;
	}

	pointerDown(e: PointerInput): void {
		if (e.pointerType === "touch" || this.activeId !== null) return;
		const button = e.button ?? 0;
		if (button > 2) return; // back, forward and eraser buttons do nothing
		this.activeId = e.pointerId;
		if (button === 2) {
			// Right button: pan for a moment, whatever the tool; a click opens the menu.
			this.rightPress = { x: e.clientX, y: e.clientY, moved: false };
			this.panFrom = { x: e.clientX, y: e.clientY };
			return;
		}
		if (button === 1 || this.settings.tool === "pan") {
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
			const press = this.rightPress;
			if (
				press &&
				Math.hypot(e.clientX - press.x, e.clientY - press.y) > RIGHT_CLICK_SLOP
			) {
				press.moved = true;
			}
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
		const press = this.rightPress;
		this.rightPress = null;
		if (press) {
			if (!press.moved) this.onRightClick?.(e);
			return;
		}
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

	/** Selects elements by id (null or an empty list clears the selection) and shows their frame. */
	select(ids: string | string[] | null): void {
		this.selectedIds =
			ids === null ? [] : Array.isArray(ids) ? [...ids] : [ids];
		this.showFrame();
		this.onSelectionChange?.();
	}

	/** Removes everything selected, as one undo step. Returns false if nothing is selected. */
	deleteSelected(): boolean {
		if (!this.board.eraseMany(this.authorId, this.selectedIds)) return false;
		this.select(null);
		this.renderer.redraw(this.board.strokes);
		return true;
	}

	/** True when copySelected has put something to paste. */
	get hasClipboard(): boolean {
		return this.clipboard.length > 0;
	}

	/** Remembers the selection for paste. Returns false if nothing is selected. */
	copySelected(): boolean {
		const sel = this.selection;
		if (sel.length === 0) return false;
		this.clipboard = sel;
		return true;
	}

	/**
	 * Adds copies of the clipboard on top, as one undo step, and selects them. Their top-left
	 * corner lands on `at` (board coordinates), or a little below and right of the originals.
	 * Returns the new ids (empty if the clipboard is empty).
	 */
	paste(at?: [number, number]): string[] {
		return this.addCopies(this.clipboard, at);
	}

	/** Copies the selection a little below and right of it and selects the copies. */
	duplicateSelected(): boolean {
		return this.addCopies(this.selection).length > 0;
	}

	/** Moves the selection above every other element, keeping its own order. */
	bringToFront(): boolean {
		const sel = this.selection;
		if (sel.length === 0) return false;
		const moved = sel.map((el) => ({ ...el, z: this.nextZ() }));
		return this.reorder(moved);
	}

	/** Moves the selection below every other element, keeping its own order. */
	sendToBack(): boolean {
		const sel = this.selection;
		if (sel.length === 0) return false;
		const lowest = Math.min(...this.board.strokes.map((s) => s.z));
		const moved = sel.map((el, i) => ({
			...el,
			z: lowest - sel.length + i,
		}));
		return this.reorder(moved);
	}

	/**
	 * Prepares a right click at a screen position: the object under it becomes the selection
	 * (unless it already is part of it); on empty space the selection is cleared. Returns
	 * whether there is an object there.
	 */
	contextTarget(clientX: number, clientY: number): boolean {
		const [x, y] = this.viewport.toWorld(clientX, clientY);
		const hit = [...this.board.strokes]
			.reverse()
			.find((s) => objectHit(s, x, y, HIT_PX / this.viewport.scale));
		if (!hit) {
			this.select(null);
			return false;
		}
		if (!this.selectedIds.includes(hit.id)) this.select(hit.id);
		return true;
	}

	private addCopies(source: Stroke[], at?: [number, number]): string[] {
		if (source.length === 0) return [];
		const left = Math.min(...source.map((s) => worldBounds(s).minX));
		const top = Math.min(...source.map((s) => worldBounds(s).minY));
		const [dx, dy] = at ? [at[0] - left, at[1] - top] : [20, 20];
		const copies = source.map((s) => ({
			...translateEl(s, dx, dy),
			id: this.newId(),
			authorId: this.authorId,
			z: this.nextZ(),
		}));
		this.board.addMany(this.authorId, copies);
		this.renderer.redraw(this.board.strokes);
		this.select(copies.map((s) => s.id));
		return copies.map((s) => s.id);
	}

	private reorder(moved: Stroke[]): boolean {
		if (!this.board.updateMany(this.authorId, moved)) return false;
		this.renderer.redraw(this.board.strokes);
		return true;
	}

	/** Applies a style change to the selection as one undo step; false if nothing changed. */
	setProps(patch: StylePatch): boolean {
		const before = this.selection;
		const changed = before
			.map((el) => applyStyle(el, patch))
			.filter((next, i) => JSON.stringify(next) !== JSON.stringify(before[i]));
		if (changed.length === 0 || !this.board.updateMany(this.authorId, changed))
			return false;
		this.showFrame();
		this.renderer.redraw(this.board.strokes);
		return true;
	}

	/** Tells the UI which text sits under a (double-clicked) screen position, if any. */
	editTextAt(clientX: number, clientY: number): void {
		const [x, y] = this.viewport.toWorld(clientX, clientY);
		const reach = HIT_PX / this.viewport.scale;
		const hit = [...this.board.strokes]
			.reverse()
			.find((s) => s.kind === "text" && objectHit(s, x, y, reach));
		if (hit) this.onTextEdit?.(hit);
	}

	/** Sets a text element's content; blank content deletes it. */
	commitText(id: string, text: string): void {
		const el = this.board.strokes.find((s) => s.id === id);
		if (!el) return;
		if (text.trim()) {
			this.board.updateMany(this.authorId, [{ ...el, text }]);
		} else {
			this.board.eraseMany(this.authorId, [id]);
			this.selectedIds = this.selectedIds.filter((x) => x !== id);
		}
		this.showFrame();
		this.renderer.redraw(this.board.strokes);
	}

	private showFrame(): void {
		this.showSelection(this.selection);
	}

	/** The glow on every selected element, and the frame with handles where it is needed. */
	private showSelection(els: Stroke[]): void {
		this.renderer.setHighlight?.(els);
		this.renderer.setSelection?.(needsFrame(els) ? frameOf(els) : null);
	}

	private startSelect(e: PointerInput): void {
		const p = this.viewport.toWorld(e.clientX, e.clientY);
		const px = 1 / this.viewport.scale;
		const sel = this.selection;
		const frame = needsFrame(sel) ? frameOf(sel) : null;
		if (frame) {
			const handle = hitFrameHandle(
				frame,
				p,
				HANDLE_PX * px,
				ROT_OFFSET_PX * px,
			);
			if (handle === "rot") {
				const startAngle = Math.atan2(p[1] - frame.cy, p[0] - frame.cx);
				this.edit = {
					mode: "rotate",
					originals: sel,
					drafts: sel,
					frame,
					startAngle,
				};
				return;
			}
			if (handle) {
				const anchor = cornerPos(frame, oppositeCorner(handle));
				this.edit = {
					mode: "scale",
					originals: sel,
					drafts: sel,
					frame,
					anchor,
					handle: cornerPos(frame, handle),
				};
				return;
			}
		}
		const hit = [...this.board.strokes]
			.reverse()
			.find((s) => objectHit(s, p[0], p[1], HIT_PX * px));
		if (hit && e.shiftKey) {
			const on = this.selectedIds.includes(hit.id);
			this.select(
				on
					? this.selectedIds.filter((id) => id !== hit.id)
					: [...this.selectedIds, hit.id],
			);
		} else if (hit) {
			if (!this.selectedIds.includes(hit.id)) this.select(hit.id);
			const now = this.selection;
			this.edit = { mode: "move", start: p, originals: now, drafts: now };
		} else {
			if (!e.shiftKey) this.select(null);
			this.edit = {
				mode: "marquee",
				start: p,
				additive: !!e.shiftKey,
				base: [...this.selectedIds],
				rect: null,
			};
		}
	}

	private dragEdit(e: PointerInput): void {
		const edit = this.edit;
		if (!edit) return;
		const p = this.viewport.toWorld(e.clientX, e.clientY);
		if (edit.mode === "marquee") {
			edit.rect = {
				minX: Math.min(edit.start[0], p[0]),
				minY: Math.min(edit.start[1], p[1]),
				maxX: Math.max(edit.start[0], p[0]),
				maxY: Math.max(edit.start[1], p[1]),
			};
			this.renderer.setMarquee?.(edit.rect);
			return;
		}
		if (edit.mode === "move") {
			const dx = p[0] - edit.start[0];
			const dy = p[1] - edit.start[1];
			edit.drafts = edit.originals.map((el) => translateEl(el, dx, dy));
		} else if (edit.mode === "scale") {
			const { anchor, handle, frame } = edit;
			const reach =
				Math.hypot(handle[0] - anchor[0], handle[1] - anchor[1]) || 1;
			const kMin =
				MIN_SELECTION_PX / (this.viewport.scale * Math.max(frame.w, 1));
			const k = Math.max(
				Math.hypot(p[0] - anchor[0], p[1] - anchor[1]) / reach,
				kMin,
			);
			edit.drafts = edit.originals.map((el) => scaleEl(el, anchor, k));
		} else {
			const { frame } = edit;
			const raw =
				Math.atan2(p[1] - frame.cy, p[0] - frame.cx) - edit.startAngle;
			const target = frame.rot + raw;
			const snapped = e.shiftKey
				? snapAngle(target, SNAP_STEP)
				: softSnapAngle(target, SOFT_SNAP);
			const pivot: Vec = [frame.cx, frame.cy];
			edit.drafts = edit.originals.map((el) =>
				rotateEl(el, pivot, snapped - frame.rot),
			);
		}
		// A local preview only: nothing is sent and no history is written until release.
		for (const d of edit.drafts)
			this.board.applyRemote({ t: "update", stroke: d });
		this.showSelection(edit.drafts);
		this.renderer.redraw(this.board.strokes);
	}

	private finishEdit(): void {
		const edit = this.edit;
		this.edit = null;
		if (!edit) return;
		if (edit.mode === "marquee") {
			this.renderer.setMarquee?.(null);
			const r = edit.rect;
			if (!r) return;
			const ids = this.board.strokes
				.filter((s) => intersects(worldBounds(s), r))
				.map((s) => s.id);
			this.select(edit.additive ? [...new Set([...edit.base, ...ids])] : ids);
			return;
		}
		const unchanged = edit.drafts.every(
			(d, i) => JSON.stringify(d) === JSON.stringify(edit.originals[i]),
		);
		if (unchanged) return; // pressed and released without really moving
		// Put the originals back, then record the change once: one undo step, one update each.
		for (const o of edit.originals)
			this.board.applyRemote({ t: "update", stroke: o });
		this.board.updateMany(this.authorId, edit.drafts);
		this.showFrame();
		this.renderer.redraw(this.board.strokes);
	}

	/** Keeps the selection in step after undo or redo changed the board. */
	private syncSelection(): void {
		this.selectedIds = this.selection.map((s) => s.id);
		this.showFrame();
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
