import type { Board, Point, Stroke } from "./board";
import { intersects } from "./bounds";
import type { ClipElement } from "./clipboard";
import { constrainEnd } from "./draw-aids";
import { findHit, objectHit } from "./hit";
import {
	type Frame,
	frameOf,
	HANDLE_PX,
	handlePos,
	hitFrameHandle,
	oppositeHandle,
	pointInFrame,
	ROT_OFFSET_PX,
} from "./selection-frame";
import { adjustFromPoint, adjustHandle, outlineOf } from "./shape-parts";
import type { ShapeChoice } from "./shapes";
import { applyStyle, type Dash, type StylePatch } from "./style";
import {
	bakeRotation,
	centerOf,
	lineEnds,
	rotateEl,
	rotatePoint,
	scaleElBy,
	snapAngle,
	softSnapAngle,
	toLocal,
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
	/** The view moved: show it without painting every element (the picture is sharpened later). */
	moveView?(): void;
	/** Shows the selection frame and handles (null hides them). */
	setSelection?(frame: Frame | null): void;
	/**
	 * Draws elements being dragged on a layer of their own while the rest of the board stays as
	 * it is, so a drag does not repaint everything (null ends it). `elements` are the originals
	 * with an `offset` when they are only moved, or the changed elements otherwise.
	 */
	setDrag?(
		drag: {
			ids: string[];
			elements: Stroke[];
			offset?: [number, number];
		} | null,
	): void;
	/** Shows the handle of a selected adjustable shape, a board point (null hides it, R-041). */
	setAdjust?(at: [number, number] | null): void;
	/** Shows a dot on every corner of a selected figure, board points (null hides them, R-047). */
	setVertices?(at: [number, number][] | null): void;
	/** Shows dots at the ends of a selected line, to drag them (null hides them, R-041). */
	setEndpoints?(ends: [number, number][] | null): void;
	/** Makes the selected elements glow (an empty list clears it). */
	setHighlight?(els: Stroke[]): void;
	/** Shows the rubber band while dragging over empty space (null hides it). */
	setMarquee?(rect: Rect | null): void;
}

/** Current tool settings, mutated by the toolbar. */
export interface Settings {
	tool: "pen" | "eraser" | "pan" | "line" | "shape" | "text" | "select";
	/** Which shape the shape tool draws (R-033); a rectangle if none was chosen. */
	shape?: ShapeChoice;
	/** The line style of new elements (R-038): what fits the tool is used, the rest is ignored. */
	lineStyle?: Dash;
	/** Opacity of new elements, 0 to 1; full if none (R-038). */
	opacity?: number;
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
			/** How far the grabbed handle stands outside the object, in board units, with sign. */
			pad: Vec;
	  }
	| {
			mode: "vertex";
			originals: Stroke[];
			drafts: Stroke[];
			index: number;
	  }
	| {
			mode: "adjust";
			originals: Stroke[];
			drafts: Stroke[];
	  }
	| {
			mode: "endpoint";
			originals: Stroke[];
			drafts: Stroke[];
			/** Which end of the line is being dragged (R-041). */
			index: 0 | 1;
	  }
	| {
			mode: "rotate";
			originals: Stroke[];
			drafts: Stroke[];
			frame: Frame;
			startAngle: number;
			/** The angle of the group's frame while it is being turned. */
			frameRot: number;
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

/** How far (px) the text tool may move and still count as a click, not a dragged area. */
const TEXT_DRAG_SLOP = 6;

/** The narrowest a text area made by dragging is, in board units. */
const MIN_TEXT_AREA = 40;

/** How much wider than a line its frame is, in screen px, so its handles do not sit on its end dots. */
const LINE_FRAME_PAD_PX = 16;

/** How far (px) the right button may move and still count as a click, not a pan. */
const RIGHT_CLICK_SLOP = 4;

/** The tools that drag out an element from two corners: the line and the shape tool (R-033). */
const isShapeTool = (t: Settings["tool"]): boolean =>
	t === "line" || t === "shape";

/** Turns pointer input into board changes: draws with pen/mouse, ignores touch (palm rejection). */
export class Controller {
	private activeId: number | null = null;
	private current: Stroke | null = null;
	private lastZ = 0;
	private panFrom: { x: number; y: number } | null = null;
	/** Set while the right button is down: where it went down and whether it has moved (R-029). */
	private rightPress: { x: number; y: number; moved: boolean } | null = null;
	/** Where the text tool was pressed (board and screen), until it is released (R-044). */
	private textStart: { world: Vec; sx: number; sy: number } | null = null;
	private selectedIds: string[] = [];
	/** The angle of a group's frame, so a turned group keeps the size of its frame. */
	private groupRot = 0;
	/** The selection as it was before a live style preview (R-031), until it is committed. */
	private styleBase: Stroke[] | null = null;
	/** Elements copied with copySelected, pasted by paste (not shared between clients). */
	private clipboard: Stroke[] = [];
	private edit: Edit | null = null;
	/** Called when the selected image changes, so the UI can show or hide its controls. */
	onSelectionChange: (() => void) | null = null;
	/** Called with a text element when it is double-clicked, so the UI can edit its content. */
	onTextEdit: ((el: Stroke) => void) | null = null;
	/**
	 * Called when the text tool is released: with the board position of a click, or with the top
	 * left corner and the size of the area that was dragged (R-044); the UI then asks for the text.
	 */
	onTextRequest:
		| ((at: [number, number], area?: { w: number; h: number }) => void)
		| null = null;
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
		if (this.selectedIds.length === 0) return [];
		const c = this.selectedCache;
		if (c && c.version === this.board.version && c.ids === this.selectedIds)
			return c.list;
		// The page asks for this several times in every render, which is every frame of a zoom: it
		// is counted once per change of the board or of the selection (and with a set, not a scan
		// of the ids for every element).
		const ids = new Set(this.selectedIds);
		const list = this.board.strokes.filter((s) => ids.has(s.id));
		this.selectedCache = {
			version: this.board.version,
			ids: this.selectedIds,
			list,
		};
		return list;
	}

	private selectedCache: {
		version: number;
		ids: string[];
		list: Stroke[];
		bounds?: Rect | null;
	} | null = null;

	/** The owner took away our right to draw: a drag only moves the view and nothing changes (R-016). */
	readOnly = false;

	/** True while the board is being dragged (hand tool, middle or right button). */
	get panning(): boolean {
		return this.panFrom !== null;
	}

	/** True while a selection is being turned by its handle. */
	get rotating(): boolean {
		return this.edit?.mode === "rotate";
	}

	/** True when the pointer (screen px) is on the turning handle of the selection. */
	overRotate(clientX: number, clientY: number): boolean {
		if (this.edit || this.settings.tool !== "select") return false;
		const frame = this.frameFor(this.selection, this.groupRot);
		if (!frame) return false;
		const px = 1 / this.viewport.scale;
		const p = this.viewport.toWorld(clientX, clientY);
		return (
			hitFrameHandle(frame, p, HANDLE_PX * px, ROT_OFFSET_PX * px) === "rot"
		);
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
		if (button === 1 || this.settings.tool === "pan" || this.readOnly) {
			this.panFrom = { x: e.clientX, y: e.clientY };
			return;
		}
		if (this.settings.tool === "select") {
			this.startSelect(e);
			this.onSelectionChange?.(); // the panel of tools steps aside while the pointer is down
			return;
		}
		// Anything that draws starts clean: what was selected before is let go of.
		if (["pen", "line", "shape", "text"].includes(this.settings.tool))
			this.select(null);
		if (this.settings.tool === "eraser") {
			this.erase(e);
			return;
		}
		if (this.settings.tool === "text") {
			// Acted on at release, so the text field is not stolen back by this click.
			this.textStart = {
				world: this.viewport.toWorld(e.clientX, e.clientY),
				sx: e.clientX,
				sy: e.clientY,
			};
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
			...(isShapeTool(tool)
				? { kind: tool === "shape" ? (this.settings.shape ?? "rect") : "line" }
				: {}),
			...this.newLook(tool),
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
			if (this.renderer.moveView) this.renderer.moveView();
			else this.renderer.redraw(this.board.strokes);
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
		if (this.textStart) {
			this.renderer.setMarquee?.(this.textArea(e));
			return;
		}
		if (!this.current) return;
		if (this.current.kind) {
			// A shape only needs where it ends.
			// A new object each time: what is computed from an element (its parts, its paths) is kept
			// per object, so an object that changes under it would keep an old, smaller shape.
			const [a] = this.current.points;
			this.current = {
				...this.current,
				points: [a, this.shapeEnd(e, this.current)],
			};
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
		this.finishPointer(e);
		// Whatever the gesture was, the UI is told it is over (the panel of tools comes back).
		this.onSelectionChange?.();
	}

	private finishPointer(e: PointerInput): void {
		this.activeId = null;
		this.panFrom = null;
		const press = this.rightPress;
		this.rightPress = null;
		if (press) {
			if (!press.moved) this.onRightClick?.(e);
			return;
		}
		if (this.textStart) {
			const area = this.textArea(e);
			this.textStart = null;
			this.renderer.setMarquee?.(null);
			const here = this.viewport.toWorld(e.clientX, e.clientY);
			if (area) {
				this.onTextRequest?.([area.minX, area.minY], {
					w: Math.max(MIN_TEXT_AREA, area.maxX - area.minX),
					h: area.maxY - area.minY,
				});
			} else {
				this.onTextRequest?.(here);
			}
			return;
		}
		if (this.edit) {
			this.finishEdit();
			return;
		}
		if (!this.current) return;
		if (this.current.kind) {
			const [a] = this.current.points; // Shift as it is on release
			this.current = {
				...this.current,
				points: [a, this.shapeEnd(e, this.current)],
			};
		}
		if (this.current.kind && this.tooSmall(this.current)) {
			this.current = null;
			this.renderer.drawLive(null);
			return;
		}
		const done = this.current;
		this.board.addStroke(done);
		this.current = null;
		this.renderer.drawLive(null);
		this.renderer.redraw(this.board.strokes);
		// Nothing is selected and the tool stays as it was, so the next shape is drawn at once (R-059).
	}

	pointerCancel(e: PointerInput): void {
		this.pointerUp(e);
	}

	/** The line style and opacity new elements get from the settings, where they fit the tool. */
	private newLook(tool: Settings["tool"]): { dash?: Dash; opacity?: number } {
		const style = this.settings.lineStyle;
		let dash: Dash | undefined;
		if (tool === "pen" && style && style !== "solid") dash = style;
		if (
			(tool === "line" || tool === "shape") &&
			(style === "dashed" || style === "dotted")
		)
			dash = style;
		const opacity = this.settings.opacity;
		return {
			...(dash ? { dash } : {}),
			...(opacity !== undefined && opacity < 1 ? { opacity } : {}),
		};
	}

	/**
	 * The area dragged with the text tool so far, in board coordinates; null while the pointer has
	 * hardly left where it was pressed, which is a click.
	 */
	private textArea(e: PointerInput): Rect | null {
		const start = this.textStart;
		if (
			!start ||
			Math.hypot(e.clientX - start.sx, e.clientY - start.sy) <= TEXT_DRAG_SLOP
		)
			return null;
		const [x, y] = this.viewport.toWorld(e.clientX, e.clientY);
		return {
			minX: Math.min(start.world[0], x),
			minY: Math.min(start.world[1], y),
			maxX: Math.max(start.world[0], x),
			maxY: Math.max(start.world[1], y),
		};
	}

	/** Adds a text element at a board position, an area with a `width` (R-044); blank text is ignored. */
	addText(
		text: string,
		x: number,
		y: number,
		width?: number,
		look?: {
			color?: string;
			size?: number;
			fontSize?: number;
			opacity?: number;
		},
	): void {
		if (!text.trim()) return;
		const settings = this.newLook("text");
		const opacity =
			look?.opacity !== undefined ? look.opacity : settings.opacity;
		this.board.addStroke({
			id: this.newId(),
			authorId: this.authorId,
			color: look?.color ?? this.settings.color,
			size: look?.size ?? this.settings.size,
			z: this.nextZ(),
			kind: "text",
			text,
			...(width ? { width } : {}),
			...(look?.fontSize ? { fontSize: look.fontSize } : {}),
			...(opacity !== undefined && opacity < 1 ? { opacity } : {}),
			points: [[x, y, 0.5]],
		});
		this.renderer.redraw(this.board.strokes);
	}

	/** The box around the selection, in board units; null when nothing is selected. */
	selectionBounds(): Rect | null {
		const sel = this.selection;
		if (sel.length === 0) return null;
		const c = this.selectedCache;
		if (c?.list === sel && c.bounds !== undefined) return c.bounds;
		let box: Rect | null = null;
		for (const s of sel) {
			const b = worldBounds(s);
			box = box
				? {
						minX: Math.min(box.minX, b.minX),
						minY: Math.min(box.minY, b.minY),
						maxX: Math.max(box.maxX, b.maxX),
						maxY: Math.max(box.maxY, b.maxY),
					}
				: b;
		}
		if (c?.list === sel) c.bounds = box;
		return box;
	}

	/** Adds an image element covering `rect` and selects it. Returns its id. */
	addImage(src: string, rect: Rect): string {
		if (this.readOnly) return "";
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
	/**
	 * Starts adding images one by one, as the pages of a PDF arrive (R-056): each appears at once
	 * and none is selected, and `done` makes the whole run one undo step.
	 */
	addImageBatch(): { add(src: string, rect: Rect): void; done(): void } {
		const batch = this.board.addBatch(this.authorId);
		return {
			add: (src, rect) => {
				if (this.readOnly) return;
				batch.add(
					withRect(
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
					),
				);
				this.renderer.redraw(this.board.strokes);
			},
			done: () => batch.done(),
		};
	}

	select(ids: string | string[] | null): void {
		this.dropStylePreview();
		this.groupRot = 0; // a new selection starts with an upright frame
		this.selectedIds =
			ids === null ? [] : Array.isArray(ids) ? [...ids] : [ids];
		this.showFrame();
		this.onSelectionChange?.();
	}

	/** Removes everything selected, as one undo step. Returns false if nothing is selected. */
	deleteSelected(): boolean {
		if (this.readOnly) return false;
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
		if (this.readOnly) return [];
		return this.addCopies(this.clipboard, at);
	}

	/**
	 * Adds elements that came from outside, from the system clipboard (R-035), as new elements
	 * of this author on top, selected, as one undo step. Same placement as `paste`.
	 */
	pasteSource(els: ClipElement[], at?: [number, number]): string[] {
		if (this.readOnly) return [];
		return this.addCopies(
			els.map((el) => ({ ...el, id: "", authorId: this.authorId, z: 0 })),
			at,
		);
	}

	/** Copies the selection a little below and right of it and selects the copies. */
	duplicateSelected(): boolean {
		if (this.readOnly) return false;
		return this.addCopies(this.selection).length > 0;
	}

	/** Moves the selection above every other element, keeping its own order. */
	bringToFront(): boolean {
		if (this.readOnly) return false;
		const sel = this.selection;
		if (sel.length === 0) return false;
		const moved = sel.map((el) => ({ ...el, z: this.nextZ() }));
		return this.reorder(moved);
	}

	/** Moves the selection below every other element, keeping its own order. */
	sendToBack(): boolean {
		if (this.readOnly) return false;
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
		// The empty inside of a group's frame belongs to the group.
		const group = this.selection;
		const frame = group.length > 1 ? frameOf(group, this.groupRot) : null;
		if (frame && pointInFrame(frame, [x, y])) return true;
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

	/**
	 * Shows a style change on the selection at once, without history and without sending it
	 * (a slider being dragged). `setProps` with the final value then records it as one step.
	 */
	previewStyle(patch: StylePatch): void {
		const base = this.styleBase ?? this.selection;
		if (base.length === 0) return;
		this.styleBase = base;
		const drafts = base.map((el) => applyStyle(el, patch));
		for (const d of drafts) this.board.applyRemote({ t: "update", stroke: d });
		this.showSelection(drafts);
		this.renderer.redraw(this.board.strokes);
	}

	/** Puts the selection back as it was before an uncommitted preview. */
	private dropStylePreview(): void {
		const base = this.styleBase;
		if (!base) return;
		this.styleBase = null;
		for (const o of base) this.board.applyRemote({ t: "update", stroke: o });
		this.renderer.redraw(this.board.strokes);
	}

	/** Applies a style change to the selection as one undo step; false if nothing changed. */
	setProps(patch: StylePatch): boolean {
		if (this.readOnly) return false;
		this.dropStylePreview(); // record from the original, not from the preview
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
		if (this.readOnly) return;
		const [x, y] = this.viewport.toWorld(clientX, clientY);
		const reach = HIT_PX / this.viewport.scale;
		const hit = [...this.board.strokes]
			.reverse()
			.find((s) => s.kind === "text" && objectHit(s, x, y, reach));
		if (hit) this.onTextEdit?.(hit);
	}

	/** Sets a text element's content; blank content deletes it. */
	commitText(id: string, text: string): void {
		if (this.readOnly) return;
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

	/**
	 * Puts the frame, the handles and the glow away while the view moves (R-060). The glow is a
	 * blurred shadow of every selected element, repainted at every frame of a scroll: with a big
	 * selection that alone made the scroll crawl.
	 */
	hideFrame(): void {
		if (this.edit || this.selection.length === 0) return;
		this.renderer.setHighlight?.([]);
		this.renderer.setSelection?.(null);
		this.renderer.setEndpoints?.(null);
		this.renderer.setVertices?.(null);
		this.renderer.setAdjust?.(null);
	}

	/** Brings them back once the view is still (not while the board is still being dragged). */
	restoreFrame(): void {
		if (this.edit || this.panning) return;
		this.showFrame();
	}

	/**
	 * Where the handle of the lone selected adjustable shape is on the board (its turn applied),
	 * or null when the selection has none (R-041).
	 */
	private adjustAt(els: Stroke[]): [number, number] | null {
		if (els.length !== 1) return null;
		const [el] = els;
		const [a, b] = el.points;
		if (!a || !b) return null;
		// A figure with corners has them to drag instead (R-047): the handle is for what has none.
		if (this.outline(el)) return null;
		const h = adjustHandle(
			el.kind ?? "stroke",
			[a[0], a[1]],
			[b[0], b[1]],
			el.adj,
		);
		return h ? rotatePoint(h, centerOf(el), el.rot ?? 0) : null;
	}

	/** The corners of a figure before its turn, or null if it has none to move (R-047). */
	private outline(el: Stroke): Vec[] | null {
		const [a, b] = el.points;
		if (!a || !b || !el.kind) return null;
		return outlineOf(el.kind, [a[0], a[1]], [b[0], b[1]], el.adj, el.verts);
	}

	/** Where the corner dots of the lone selected figure are on the board, its turn applied. */
	private vertexDots(els: Stroke[]): [number, number][] | null {
		if (els.length !== 1) return null;
		const outline = this.outline(els[0]);
		if (!outline) return null;
		const c = centerOf(els[0]);
		return outline.map((v) => rotatePoint(v, c, els[0].rot ?? 0));
	}

	/** The frame of a selection, always a little wider than what it holds, so handles never sit on it. */
	private frameFor(els: Stroke[], rot: number): Frame | null {
		const f = frameOf(els, rot);
		if (!f) return f;
		const pad = (2 * LINE_FRAME_PAD_PX) / this.viewport.scale;
		return { ...f, w: f.w + pad, h: f.h + pad };
	}

	/** The glow on every selected element, and the frame with the handles that edit them. */
	private showSelection(els: Stroke[], rot = this.groupRot): void {
		this.renderer.setHighlight?.(els);
		// A lone line has dots at its ends instead of a frame (R-041).
		const lone = els.length === 1 && els[0].kind === "line";
		this.renderer.setEndpoints?.(lone ? lineEnds(els[0]) : null);
		this.renderer.setAdjust?.(this.adjustAt(els));
		this.renderer.setVertices?.(this.vertexDots(els));
		this.renderer.setSelection?.(this.frameFor(els, rot));
	}

	private startSelect(e: PointerInput): void {
		const p = this.viewport.toWorld(e.clientX, e.clientY);
		const px = 1 / this.viewport.scale;
		const sel = this.selection;
		const dots = this.vertexDots(sel);
		const grabbed = dots?.findIndex(
			(d) => Math.hypot(p[0] - d[0], p[1] - d[1]) <= HANDLE_PX * px,
		);
		if (grabbed !== undefined && grabbed >= 0) {
			this.edit = {
				mode: "vertex",
				originals: sel,
				drafts: sel,
				index: grabbed,
			};
			return;
		}
		const adjustPoint = this.adjustAt(sel);
		if (
			adjustPoint &&
			Math.hypot(p[0] - adjustPoint[0], p[1] - adjustPoint[1]) <= HANDLE_PX * px
		) {
			this.edit = { mode: "adjust", originals: sel, drafts: sel };
			return;
		}
		if (sel.length === 1 && sel[0].kind === "line") {
			const ends = lineEnds(sel[0]);
			for (const i of [0, 1] as const) {
				if (
					Math.hypot(p[0] - ends[i][0], p[1] - ends[i][1]) <=
					HANDLE_PX * px
				) {
					// The turn goes into the points, so the end can be moved freely.
					const original = bakeRotation(sel[0]);
					this.edit = {
						mode: "endpoint",
						originals: [original],
						drafts: [original],
						index: i,
					};
					return;
				}
			}
		}
		const frame = this.frameFor(sel, this.groupRot);
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
					frameRot: frame.rot,
				};
				return;
			}
			if (handle) {
				// The scaling is worked out on the object's own frame, the handles stand off it.
				const base = frameOf(sel, this.groupRot) ?? frame;
				const gap = LINE_FRAME_PAD_PX * px;
				this.edit = {
					mode: "scale",
					originals: sel,
					drafts: sel,
					frame: base,
					anchor: handlePos(base, oppositeHandle(handle)),
					handle: handlePos(base, handle),
					pad: [
						(handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0) * gap,
						(handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0) * gap,
					],
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
		let p = this.viewport.toWorld(e.clientX, e.clientY);
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
		let offset: [number, number] | undefined;
		if (edit.mode === "move") {
			const dx = p[0] - edit.start[0];
			const dy = p[1] - edit.start[1];
			offset = [dx, dy];
			edit.drafts = edit.originals.map((el) => translateEl(el, dx, dy));
		} else if (edit.mode === "vertex") {
			const [orig] = edit.originals;
			const outline = this.outline(orig) as Vec[];
			const here = toLocal(orig, [p[0], p[1]]);
			const was = outline[edit.index];
			if (
				Math.abs(here[0] - was[0]) < 1e-9 &&
				Math.abs(here[1] - was[1]) < 1e-9
			) {
				edit.drafts = [orig];
			} else {
				const moved = outline.map((v, i): Vec => (i === edit.index ? here : v));
				const x0 = Math.min(...moved.map((v) => v[0]));
				const x1 = Math.max(...moved.map((v) => v[0]));
				const y0 = Math.min(...moved.map((v) => v[1]));
				const y1 = Math.max(...moved.map((v) => v[1]));
				const w = Math.max(x1 - x0, 1e-3);
				const h = Math.max(y1 - y0, 1e-3);
				// The box is re-fitted round the corners; its centre moves, so it is taken to where it
				// really is on the board and the turn about it still gives the same picture.
				const c = rotatePoint(
					[(x0 + x1) / 2, (y0 + y1) / 2],
					centerOf(orig),
					orig.rot ?? 0,
				);
				const [a, b] = orig.points;
				edit.drafts = [
					{
						...orig,
						kind: orig.kind === "rect" ? "parallelogram" : orig.kind,
						points: [
							[c[0] - w / 2, c[1] - h / 2, a[2]],
							[c[0] + w / 2, c[1] + h / 2, b[2]],
						],
						verts: moved.map((v): [number, number] => [
							(v[0] - x0) / w,
							(v[1] - y0) / h,
						]),
					},
				];
			}
		} else if (edit.mode === "adjust") {
			const [orig] = edit.originals;
			const kind = orig.kind ?? "stroke";
			const [a, b] = orig.points;
			const A: Vec = [a[0], a[1]];
			const B: Vec = [b[0], b[1]];
			const next = adjustFromPoint(kind, A, B, toLocal(orig, [p[0], p[1]]));
			const now = adjustFromPoint(
				kind,
				A,
				B,
				adjustHandle(kind, A, B, orig.adj) ?? A,
			);
			// Not moved off where it already is: leave the shape (and its default) alone.
			edit.drafts =
				Math.abs(next - now) < 1e-9 ? [orig] : [{ ...orig, adj: next }];
		} else if (edit.mode === "endpoint") {
			const [orig] = edit.originals;
			const fixed = orig.points[edit.index === 0 ? 1 : 0];
			const [x, y] = constrainEnd(
				"line",
				[fixed[0], fixed[1]],
				[p[0], p[1]],
				!!e.shiftKey,
			);
			edit.drafts = [
				{
					...orig,
					points: orig.points.map((pt, i) =>
						i === edit.index ? ([x, y, pt[2]] as Point) : pt,
					),
				},
			];
		} else if (edit.mode === "scale") {
			const { anchor, handle, frame, pad } = edit;
			if (pad[0] || pad[1]) {
				// The pointer holds a handle outside the object: bring it back onto the object's frame.
				const c: Vec = [frame.cx, frame.cy];
				const local = rotatePoint(p, c, -frame.rot);
				p = rotatePoint([local[0] - pad[0], local[1] - pad[1]], c, frame.rot);
			}
			const kMinX =
				MIN_SELECTION_PX / (this.viewport.scale * Math.max(frame.w, 1));
			const kMinY =
				MIN_SELECTION_PX / (this.viewport.scale * Math.max(frame.h, 1));
			let kx: number;
			let ky: number;
			if (e.shiftKey) {
				// Shift keeps the proportions: one factor, from the distance to the anchor.
				const reach =
					Math.hypot(handle[0] - anchor[0], handle[1] - anchor[1]) || 1;
				kx = ky = Math.max(
					Math.hypot(p[0] - anchor[0], p[1] - anchor[1]) / reach,
					kMinX,
				);
			} else {
				// Otherwise each side follows the pointer along the frame's own axes, never
				// flipping or collapsing.
				const v = rotatePoint(p, anchor, -frame.rot);
				const h = rotatePoint(handle, anchor, -frame.rot);
				const factor = (now: number, start: number, min: number) =>
					Math.abs(start) < 1e-6 ? 1 : Math.max(now / start, min);
				kx = factor(v[0] - anchor[0], h[0] - anchor[0], kMinX);
				ky = factor(v[1] - anchor[1], h[1] - anchor[1], kMinY);
			}
			edit.drafts = edit.originals.map((el) =>
				scaleElBy(el, anchor, kx, ky, frame.rot),
			);
		} else {
			const { frame } = edit;
			const raw =
				Math.atan2(p[1] - frame.cy, p[0] - frame.cx) - edit.startAngle;
			const target = frame.rot + raw;
			const snapped = e.shiftKey
				? snapAngle(target, SNAP_STEP)
				: softSnapAngle(target, SOFT_SNAP);
			const pivot: Vec = [frame.cx, frame.cy];
			edit.frameRot = snapped;
			edit.drafts = edit.originals.map((el) =>
				rotateEl(el, pivot, snapped - frame.rot),
			);
		}
		// A local preview only: nothing is sent and no history is written until release.
		if (this.renderer.setDrag) {
			// The renderer draws the dragged elements on a layer of its own; the board waits.
			this.renderer.setDrag({
				ids: edit.originals.map((s) => s.id),
				elements: offset ? edit.originals : edit.drafts,
				offset,
			});
		} else {
			for (const d of edit.drafts)
				this.board.applyRemote({ t: "update", stroke: d });
		}
		// Frame and handles are hidden for the whole gesture: only the glow follows (R-057).
		this.renderer.setHighlight?.(edit.drafts);
		this.renderer.setSelection?.(null);
		this.renderer.setEndpoints?.(null);
		this.renderer.setVertices?.(null);
		this.renderer.setAdjust?.(null);
		if (!this.renderer.setDrag) this.renderer.redraw(this.board.strokes);
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
		if (unchanged) {
			this.renderer.setDrag?.(null);
			this.showFrame(); // pressed and released without really moving: bring the frame back
			return;
		}
		// Put the originals back, then record the change once: one undo step, one update each.
		for (const o of edit.originals)
			this.board.applyRemote({ t: "update", stroke: o });
		this.board.updateMany(this.authorId, edit.drafts);
		this.renderer.setDrag?.(null);
		// A turned group's frame stays turned (and the same size) until the selection changes.
		if (edit.mode === "rotate" && edit.originals.length > 1)
			this.groupRot = edit.frameRot;
		this.showFrame();
		this.renderer.redraw(this.board.strokes);
	}

	/**
	 * Brings the glow, frame and handles in step with the board after it changed under the
	 * selection (a remote edit, an erase): what was selected may have moved or be gone.
	 */
	refreshSelection(): void {
		if (this.edit) return; // a gesture in progress draws its own preview
		const before = this.selectedIds.length;
		this.selectedIds = this.selection.map((s) => s.id);
		this.showFrame();
		if (before !== this.selectedIds.length) this.onSelectionChange?.();
	}

	/** Keeps the selection in step after undo or redo changed the board. */
	private syncSelection(): void {
		this.groupRot = 0;
		this.selectedIds = this.selection.map((s) => s.id);
		this.showFrame();
		this.onSelectionChange?.();
	}

	/** Where the shape being dragged ends at this pointer position, with Shift's drawing aids applied. */
	private shapeEnd(e: PointerInput, shape: Stroke): Point {
		const p = this.point(e);
		const [x, y] = constrainEnd(
			shape.kind === "line" ? "line" : "rect", // every other shape gets a square box
			[shape.points[0][0], shape.points[0][1]],
			[p[0], p[1]],
			!!e.shiftKey,
		);
		return [x, y, p[2]];
	}

	private tooSmall(shape: Stroke): boolean {
		const [a, b] = shape.points;
		return (
			Math.hypot(b[0] - a[0], b[1] - a[1]) * this.viewport.scale < MIN_SHAPE_PX
		);
	}

	undo(): void {
		if (this.readOnly) return;
		if (this.board.undo(this.authorId)) {
			this.renderer.redraw(this.board.strokes);
			this.syncSelection();
		}
	}

	redo(): void {
		if (this.readOnly) return;
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
			this.refreshSelection(); // an erased selected element must not leave its handles
		}
	}
}
