import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { BACKGROUNDS, type Background } from "./board/background";
import type { Stroke } from "./board/board";
import { Board } from "./board/board";
import { CanvasRenderer } from "./board/canvas-renderer";
import {
	type ParsedClip,
	parseClipboard,
	rehomeImages,
	serializeSelection,
} from "./board/clipboard";
import { Controller, type Renderer, type Settings } from "./board/controller";
import { TouchGestures } from "./board/gestures";
import { ImageCache } from "./board/image-cache";
import { defaultSize, placeCentered } from "./board/image-geometry";
import { prepareImage, uploadImage } from "./board/image-upload";
import { loadShape } from "./board/shapes";
import { fontSizeFor, fontSizeOf } from "./board/text";
import { MAX_SCALE, MIN_SCALE, Viewport } from "./board/viewport";
import { stepZoom, wheelZoomFactor } from "./board/zoom";
import { ContextMenu, type MenuItem } from "./context-menu";
import { Cursors } from "./cursors";
import { Icon } from "./icon";
import { hasFinePointer } from "./pointer";
import { PropertiesPanel } from "./properties-panel";
import { applyToolShortcut, dropsSelection } from "./shortcuts";
import { type SocketLike, SyncClient } from "./sync/sync";
import { TextEditor } from "./text-editor";
import { currentTheme, displayColor, useTheme } from "./theme";
import { toolCursor } from "./tool-cursor";
import { COLORS, SIZES, Toolbar } from "./toolbar";
import { ZoomControls } from "./zoom-controls";

/** Not crypto.randomUUID: it is missing on http:// pages (LAN testing on an iPad). */
export const newId = () =>
	`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const ZOOM_STEP = 1.25;
const LINE_HEIGHT_PX = 16;

interface Props {
	/** The board's id, needed to upload and load its images. */
	boardId: string;
	authorId: string;
	/** Shown next to our cursor on other people's screens. */
	name: string;
	/** Opens the board's websocket. */
	connect: () => SocketLike;
	/** Saves a new shared background; given only to the board's owner (R-027). */
	onSetBackground?: (background: Background) => Promise<void>;
}

const BACKGROUND_NAMES: Record<Background, string> = {
	plain: "Gładkie tło",
	dots: "Kropki",
	grid: "Kratka",
	lines: "Linie",
};

/** A shared infinite board: two canvas layers, a tool palette, zoom buttons and live sync. */
export function BoardView({
	boardId,
	authorId,
	name,
	connect,
	onSetBackground,
}: Props) {
	const [background, setBackground] = useState<Background>("plain");
	const committedRef = useRef<HTMLCanvasElement>(null);
	const liveRef = useRef<HTMLCanvasElement>(null);
	const settings = useMemo<Settings>(
		() => ({
			tool: "pen",
			color: COLORS[0],
			size: SIZES[1],
			shape: loadShape(),
		}),
		[],
	);
	const viewport = useMemo(() => new Viewport(), []);
	const [scale, setScale] = useState(1);
	/** Board position of the text being typed, if any. */
	/** An existing text being edited (double-click), if any. */
	const [editingText, setEditingText] = useState<Stroke | null>(null);
	const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);
	const [, setTick] = useState(0); // bumped when the view changes, so the text field follows it
	const ctl = useRef<Controller | null>(null);
	const syncRef = useRef<SyncClient | null>(null);
	const rendererRef = useRef<CanvasRenderer | null>(null);
	const theme = useTheme();
	/** Repaints after the view changed (set up by the effect below). */
	const viewChanged = useRef<() => void>(() => {});
	/** Adds a picked, pasted or dropped image to the board (set up by the effect below). */
	const insertImage = useRef<(file: Blob) => void>(() => {});
	const [imageError, setImageError] = useState("");
	/** Smooth zoom: eases the view towards a target scale around a screen point (set up below). */
	const zoomAnim = useRef<{
		to: (scale: number, sx: number, sy: number) => void;
		target: () => number;
	}>({ to: () => {}, target: () => 1 });
	/** Pastes elements read from the system clipboard (set up by the effect below). */
	const pasteClip = useRef<(clip: ParsedClip, at?: [number, number]) => void>(
		() => {},
	);
	/** Shows the cursor of the active tool on the board (set up by the effect below). */
	const applyCursor = useRef<() => void>(() => {});
	/** The open right-click menu: where, what is under it and the board position clicked. */
	const [menu, setMenu] = useState<{
		x: number;
		y: number;
		onObject: boolean;
		at: [number, number];
	} | null>(null);

	useEffect(() => {
		const committed = committedRef.current;
		const live = liveRef.current;
		if (!committed || !live) return;

		const board = new Board();
		const images = new ImageCache(boardId, () => canvas.redraw(board.strokes));
		const canvas = new CanvasRenderer(committed, live, viewport, images);
		canvas.ink = (c) => displayColor(c, currentTheme());
		rendererRef.current = canvas;
		const sync = new SyncClient(board, {
			createSocket: connect,
			self: { authorId, name },
			onCursors: () => setTick((t) => t + 1),
			onBackground: setBackground,
			onUpdate: () => {
				canvas.redraw(board.strokes);
				canvas.setRemoteLive(sync.liveStrokes());
			},
		});
		syncRef.current = sync;
		const renderer: Renderer = {
			drawLive: (stroke) => {
				canvas.drawLive(stroke);
				// Shapes and text are only shared once finished (ADR 0006).
				if (stroke && !stroke.kind) sync.liveUpdate(stroke);
			},
			redraw: (strokes) => canvas.redraw(strokes),
			setSelection: (frame) => canvas.setSelection(frame),
			setHighlight: (els) => canvas.setHighlight(els),
			setEndpoints: (ends) => canvas.setEndpoints(ends),
			setDrag: (drag) => canvas.setDrag(drag),
			setMarquee: (rect) => canvas.setMarquee(rect),
		};
		const controller = new Controller(
			board,
			renderer,
			settings,
			viewport,
			authorId,
			newId,
		);
		ctl.current = controller;
		let shownCursor = "";
		applyCursor.current = () => {
			const want = toolCursor(settings.tool, controller.panning);
			if (want === shownCursor) return;
			shownCursor = want;
			live.style.cursor = want;
		};
		applyCursor.current();
		controller.onTextRequest = ([x, y]) => setTextAt({ x, y });
		controller.onTextEdit = (el) => setEditingText(el);
		controller.onSelectionChange = () => setTick((t) => t + 1);
		// A right click (R-029): the menu, but only with a mouse; tablets have none (R-028).
		controller.onRightClick = (e) => {
			if (!hasFinePointer()) return;
			const onObject = controller.contextTarget(e.clientX, e.clientY);
			const at = viewport.toWorld(e.clientX, e.clientY);
			setMenu({ x: e.clientX, y: e.clientY, onObject, at });
		};

		const changed = () => {
			canvas.redraw(board.strokes);
			setScale(viewport.scale);
			setTick((t) => t + 1);
		};
		viewChanged.current = changed;
		// Zoom eases towards its target one frame at a time, so the percent runs on smoothly.
		const anim = { target: viewport.scale, sx: 0, sy: 0, raf: 0, last: 0 };
		const frame = (now: number) => {
			const dt = Math.min(now - anim.last, 100);
			anim.last = now;
			const next = stepZoom(viewport.scale, anim.target, dt);
			viewport.setScaleAt(anim.sx, anim.sy, next);
			changed();
			anim.raf = next === anim.target ? 0 : requestAnimationFrame(frame);
		};
		zoomAnim.current = {
			to: (scale, sx, sy) => {
				anim.target = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
				anim.sx = sx;
				anim.sy = sy;
				if (!anim.raf) {
					anim.last = performance.now();
					anim.raf = requestAnimationFrame(frame);
				}
			},
			// While it runs, the next zoom builds on where it is going, not where it is.
			target: () => (anim.raf ? anim.target : viewport.scale),
		};
		const gestures = new TouchGestures(
			viewport,
			() => controller.busy,
			changed,
		);

		insertImage.current = async (file) => {
			setImageError("");
			try {
				const { blob, w, h } = await prepareImage(file);
				const src = await uploadImage(boardId, blob);
				const size = defaultSize(
					w,
					h,
					viewport.worldRect(innerWidth, innerHeight),
				);
				const [x, y] = placeCentered(
					size,
					viewport.worldRect(innerWidth, innerHeight),
				);
				controller.addImage(src, {
					minX: x,
					minY: y,
					maxX: x + size.w,
					maxY: y + size.h,
				});
				settings.tool = "select"; // so it can be resized right away
				setTick((t) => t + 1);
			} catch (e) {
				setImageError(
					e instanceof Error ? e.message : "Nie udało się dodać obrazu",
				);
			}
		};

		/** Copies a picture from another board onto this one and returns its new id. */
		const transferImage = async (
			from: string,
			src: string,
		): Promise<string> => {
			const res = await fetch(`/api/boards/${from}/images/${src}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return uploadImage(boardId, await res.blob());
		};
		pasteClip.current = async (clip, at) => {
			setImageError("");
			try {
				const elements = await rehomeImages(clip, boardId, transferImage);
				controller.pasteSource(elements, at);
				settings.tool = "select"; // the pasted elements are selected, ready to move
				setTick((t) => t + 1);
			} catch (e) {
				setImageError(e instanceof Error ? e.message : "Nie udało się wkleić");
			}
		};
		/** Where the pointer last was on the board: pasted elements land there. */
		let lastPointer: [number, number] | undefined;

		const resize = () => {
			canvas.resize();
			canvas.redraw(board.strokes);
		};
		resize();
		sync.connect();

		const down = (e: PointerEvent) => {
			if (e.pointerType === "touch") return gestures.down(e);
			live.setPointerCapture(e.pointerId);
			controller.pointerDown(e);
			applyCursor.current();
		};
		const move = (e: PointerEvent) => {
			if (e.pointerType === "touch") return gestures.move(e);
			// Mouse and pen are shared as a cursor, also while hovering without pressing.
			const [x, y] = viewport.toWorld(e.clientX, e.clientY);
			lastPointer = [x, y];
			sync.cursorMove(x, y);
			controller.pointerMove(e);
			applyCursor.current(); // a safety net: whichever way the tool changed, it shows
		};
		const leave = (e: PointerEvent) => {
			if (e.pointerType !== "touch") sync.cursorHide();
		};
		const up = (e: PointerEvent) => {
			if (e.pointerType === "touch") return gestures.up(e);
			controller.pointerUp(e);
			applyCursor.current();
		};
		const cancel = (e: PointerEvent) => {
			if (e.pointerType === "touch") return gestures.cancel(e);
			controller.pointerCancel(e);
			applyCursor.current();
		};
		const wheel = (e: WheelEvent) => {
			e.preventDefault(); // otherwise Ctrl + wheel (and trackpad pinch) zooms the whole page
			const k = e.deltaMode === 1 ? LINE_HEIGHT_PX : 1;
			if (e.ctrlKey || e.metaKey) {
				zoomAnim.current.to(
					zoomAnim.current.target() * wheelZoomFactor(e.deltaY, e.deltaMode),
					e.clientX,
					e.clientY,
				);
				return;
			}
			viewport.panBy(-e.deltaX * k, -e.deltaY * k);
			changed();
		};
		const prevent = (e: Event) => e.preventDefault();
		// A middle-button press would start the browser's autoscroll instead of panning the board.
		const dblclick = (e: MouseEvent) => {
			if (settings.tool === "select")
				controller.editTextAt(e.clientX, e.clientY);
		};
		const middle = (e: MouseEvent) => {
			if (e.button === 1) e.preventDefault();
		};
		const typing = (e: Event) =>
			["TEXTAREA", "INPUT"].includes(
				(e.target as HTMLElement | null)?.tagName ?? "",
			);
		const paste = (e: ClipboardEvent) => {
			if (typing(e)) return;
			const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
				i.type.startsWith("image/"),
			);
			const file = item?.getAsFile();
			if (file) {
				e.preventDefault();
				insertImage.current(file);
				return;
			}
			// Elements copied on a board, on this one or another, travel as JSON text (R-035).
			const clip = parseClipboard(e.clipboardData?.getData("text/plain") ?? "");
			if (clip) {
				e.preventDefault();
				pasteClip.current(clip, lastPointer);
				return;
			}
			// Nothing of ours in the system clipboard: paste what was copied on this board.
			if (controller.hasClipboard) {
				e.preventDefault();
				controller.paste(lastPointer);
			}
		};
		/** Puts the selection on the system clipboard as JSON; false if nothing is selected. */
		const copyToEvent = (e: ClipboardEvent): boolean => {
			if (typing(e) || !controller.copySelected()) return false;
			e.clipboardData?.setData(
				"text/plain",
				serializeSelection(controller.selection, boardId),
			);
			e.preventDefault();
			return true;
		};
		const copy = (e: ClipboardEvent) => void copyToEvent(e);
		const cut = (e: ClipboardEvent) => {
			if (copyToEvent(e)) controller.deleteSelected();
		};
		const dragover = (e: DragEvent) => e.preventDefault(); // allow dropping files here
		const drop = (e: DragEvent) => {
			const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
				f.type.startsWith("image/"),
			);
			if (files.length === 0) return;
			e.preventDefault();
			for (const f of files) insertImage.current(f);
		};
		const key = (e: KeyboardEvent) => {
			if (typing(e)) return; // typing, not undoing the board
			if (
				!e.repeat &&
				applyToolShortcut(e, settings, () => controller.select(null))
			) {
				e.preventDefault();
				setTick((t) => t + 1);
				return;
			}
			if (
				(e.key === "Delete" || e.key === "Backspace") &&
				controller.deleteSelected()
			) {
				e.preventDefault();
				return;
			}
			const ctrlKey = e.ctrlKey || e.metaKey;
			if (ctrlKey && e.key.toLowerCase() === "c" && controller.copySelected()) {
				e.preventDefault();
				return;
			}
			if (
				ctrlKey &&
				e.key.toLowerCase() === "d" &&
				controller.duplicateSelected()
			) {
				e.preventDefault();
				return;
			}
			if (!ctrlKey || e.key.toLowerCase() !== "z") return;
			e.preventDefault();
			if (e.shiftKey) controller.redo();
			else controller.undo();
		};
		const gestureEvents = ["gesturestart", "gesturechange", "contextmenu"];

		addEventListener("resize", resize);
		addEventListener("keydown", key);
		addEventListener("paste", paste);
		addEventListener("copy", copy);
		addEventListener("cut", cut);
		live.addEventListener("dragover", dragover);
		live.addEventListener("drop", drop);
		live.addEventListener("pointerdown", down);
		live.addEventListener("pointermove", move);
		live.addEventListener("pointerup", up);
		live.addEventListener("pointercancel", cancel);
		live.addEventListener("pointerleave", leave);
		live.addEventListener("wheel", wheel, { passive: false });
		live.addEventListener("dblclick", dblclick);
		live.addEventListener("mousedown", middle);
		// Block Safari gestures and the context menu over the board.
		for (const ev of gestureEvents) document.addEventListener(ev, prevent);
		document.addEventListener("touchmove", prevent, { passive: false });

		return () => {
			cancelAnimationFrame(anim.raf);
			sync.close();
			removeEventListener("resize", resize);
			removeEventListener("keydown", key);
			removeEventListener("paste", paste);
			removeEventListener("copy", copy);
			removeEventListener("cut", cut);
			live.removeEventListener("dragover", dragover);
			live.removeEventListener("drop", drop);
			live.removeEventListener("pointerdown", down);
			live.removeEventListener("pointermove", move);
			live.removeEventListener("pointerup", up);
			live.removeEventListener("pointercancel", cancel);
			live.removeEventListener("pointerleave", leave);
			live.removeEventListener("wheel", wheel);
			live.removeEventListener("dblclick", dblclick);
			live.removeEventListener("mousedown", middle);
			for (const ev of gestureEvents) document.removeEventListener(ev, prevent);
			document.removeEventListener("touchmove", prevent);
		};
	}, [settings, viewport, boardId, authorId, name, connect]);

	// The grid is drawn on the board canvas (R-032): tell it the kind and the theme's colour.
	useEffect(() => {
		const canvas = rendererRef.current;
		if (!canvas) return;
		canvas.background = background;
		canvas.gridColor =
			getComputedStyle(document.documentElement)
				.getPropertyValue("--grid")
				.trim() || canvas.gridColor;
		canvas.refresh();
	}, [background, theme]);

	// Whatever changed the tool (a key, the toolbar, adding an image), the cursor follows.
	useEffect(() => applyCursor.current());

	// The ink colours depend on the theme (black and white swap in dark mode).
	useEffect(() => {
		if (theme) viewChanged.current();
	}, [theme]);

	// Expired cursors vanish even if nothing else happens on the board.
	useEffect(() => {
		const timer = setInterval(() => setTick((t) => t + 1), 5000);
		return () => clearInterval(timer);
	}, []);

	// The buttons zoom around the centre of the screen.
	const zoomTo = (next: (current: number) => number) =>
		zoomAnim.current.to(
			next(zoomAnim.current.target()),
			innerWidth / 2,
			innerHeight / 2,
		);

	const canReadClipboard =
		typeof navigator !== "undefined" &&
		window.isSecureContext === true &&
		!!navigator.clipboard?.read;
	/**
	 * Pastes from the system clipboard (R-035): a picture, or elements copied on a board as JSON,
	 * here or elsewhere; failing that, what was last copied on this board.
	 */
	const pasteFromClipboard = async (at?: [number, number]) => {
		setImageError("");
		const internal = () => {
			const ctrl = ctl.current;
			if (!ctrl?.hasClipboard) return false;
			ctrl.paste(at);
			return true;
		};
		try {
			for (const item of await navigator.clipboard.read()) {
				const type = item.types.find((t) => t.startsWith("image/"));
				if (type) return insertImage.current(await item.getType(type));
				if (item.types.includes("text/plain")) {
					const text = await (await item.getType("text/plain")).text();
					const clip = parseClipboard(text);
					if (clip) return pasteClip.current(clip, at);
				}
			}
			if (!internal())
				setImageError("W schowku nie ma obrazu ani elementów tablicy");
		} catch {
			if (!internal()) setImageError("Nie można odczytać schowka (brak zgody)");
		}
	};

	/** Opens the system file picker (used by the menu, which has no input of its own). */
	const pickImage = () => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/*";
		input.onchange = () => {
			for (const file of Array.from(input.files ?? []))
				insertImage.current(file);
		};
		input.click();
	};

	const menuItems = (): MenuItem[] => {
		const ctrl = ctl.current;
		if (!menu || !ctrl) return [];
		const paste: MenuItem = {
			label: "Wklej",
			icon: "paste",
			disabled: !ctrl.hasClipboard && !canReadClipboard,
			onSelect: () =>
				canReadClipboard ? pasteFromClipboard(menu.at) : ctrl.paste(menu.at),
		};
		if (!menu.onObject) {
			return [
				paste,
				{
					label: "Wstaw obraz z pliku",
					icon: "image",
					onSelect: pickImage,
				},
			];
		}
		return [
			{
				label: "Kopiuj",
				icon: "copy",
				onSelect: () => {
					if (!ctrl.copySelected()) return;
					// Also to the system clipboard, so it can be pasted on another board.
					navigator.clipboard
						?.writeText(serializeSelection(ctrl.selection, boardId))
						.catch(() => {});
				},
			},
			paste,
			{
				label: "Duplikuj",
				icon: "duplicate",
				onSelect: () => ctrl.duplicateSelected(),
			},
			{
				label: "Na wierzch",
				icon: "front",
				onSelect: () => ctrl.bringToFront(),
			},
			{ label: "Na spód", icon: "back", onSelect: () => ctrl.sendToBack() },
			{ label: "Usuń", icon: "trash", onSelect: () => ctrl.deleteSelected() },
		];
	};

	return (
		<>
			<div class="board-bg" data-background={background} />
			<canvas id="board" ref={committedRef} />
			<canvas id="live" ref={liveRef} />
			{editingText && (
				<TextEditor
					key={editingText.id}
					x={
						viewport.toScreen(
							editingText.points[0][0],
							editingText.points[0][1],
						)[0]
					}
					y={
						viewport.toScreen(
							editingText.points[0][0],
							editingText.points[0][1],
						)[1]
					}
					fontSize={fontSizeOf(editingText) * viewport.scale}
					color={displayColor(editingText.color, currentTheme())}
					initialText={editingText.text ?? ""}
					onCommit={(text) => {
						ctl.current?.commitText(editingText.id, text);
						setEditingText(null);
					}}
					onCancel={() => setEditingText(null)}
				/>
			)}
			<PropertiesPanel
				elements={ctl.current?.selection ?? []}
				colors={COLORS}
				display={(c) => displayColor(c, currentTheme())}
				onPreview={(patch) => {
					ctl.current?.previewStyle(patch);
					setTick((t) => t + 1);
				}}
				onChange={(patch) => {
					ctl.current?.setProps(patch);
					setTick((t) => t + 1);
				}}
			/>
			{textAt && (
				<TextEditor
					key={`${textAt.x},${textAt.y}`}
					x={viewport.toScreen(textAt.x, textAt.y)[0]}
					y={viewport.toScreen(textAt.x, textAt.y)[1]}
					fontSize={fontSizeFor(settings.size) * viewport.scale}
					color={displayColor(settings.color, theme)}
					onCommit={(text) => {
						ctl.current?.addText(text, textAt.x, textAt.y);
						setTextAt(null);
					}}
					onCancel={() => setTextAt(null)}
				/>
			)}
			<Cursors cursors={syncRef.current?.cursors() ?? []} viewport={viewport} />
			<Toolbar
				settings={settings}
				onToolChange={() => {
					// Choosing a drawing tool lets go of the selection, so colour and width are back.
					if (dropsSelection(settings.tool)) ctl.current?.select(null);
					applyCursor.current();
				}}
				hasSelection={(ctl.current?.selection.length ?? 0) > 0}
				images={{
					fine: hasFinePointer(),
					hasSelection: (ctl.current?.selection.length ?? 0) > 0,
					canPaste: canReadClipboard,
					onFile: (file) => insertImage.current(file),
					onPaste: () => pasteFromClipboard(),
					onDelete: () => ctl.current?.deleteSelected(),
				}}
				onUndo={() => ctl.current?.undo()}
				onRedo={() => ctl.current?.redo()}
			/>
			{menu && (
				<ContextMenu
					x={menu.x}
					y={menu.y}
					items={menuItems()}
					onClose={() => setMenu(null)}
				/>
			)}
			{imageError && (
				<div class="toast" role="alert">
					{imageError}
				</div>
			)}
			{onSetBackground && (
				<div class="backgrounds">
					{BACKGROUNDS.map((b) => (
						<button
							type="button"
							key={b}
							aria-label={`background ${b}`}
							aria-pressed={background === b}
							title={BACKGROUND_NAMES[b]}
							class={background === b ? "active" : ""}
							onClick={() => {
								setBackground(b); // shown at once; the server tells everyone else
								onSetBackground(b).catch(() => {});
							}}
						>
							<Icon name={b} />
						</button>
					))}
				</div>
			)}
			<ZoomControls
				scale={scale}
				onZoomIn={() => zoomTo((s) => s * ZOOM_STEP)}
				onZoomOut={() => zoomTo((s) => s / ZOOM_STEP)}
				onReset={() => zoomTo(() => 1)}
			/>
		</>
	);
}
