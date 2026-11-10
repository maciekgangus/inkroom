import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
	BACKGROUNDS,
	type Background,
	backgroundStyle,
} from "./board/background";
import { Board } from "./board/board";
import { CanvasRenderer } from "./board/canvas-renderer";
import { Controller, type Renderer, type Settings } from "./board/controller";
import { TouchGestures } from "./board/gestures";
import { fontSizeFor } from "./board/text";
import { Viewport } from "./board/viewport";
import { Cursors } from "./cursors";
import { Icon } from "./icon";
import { type SocketLike, SyncClient } from "./sync/sync";
import { TextEditor } from "./text-editor";
import { currentTheme, displayColor, useTheme } from "./theme";
import { COLORS, SIZES, Toolbar } from "./toolbar";
import { ZoomControls } from "./zoom-controls";

/** Not crypto.randomUUID: it is missing on http:// pages (LAN testing on an iPad). */
export const newId = () =>
	`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const ZOOM_STEP = 1.25;
const WHEEL_ZOOM_SPEED = 0.01;
const LINE_HEIGHT_PX = 16;

interface Props {
	authorId: string;
	/** Shown next to our cursor on other people's screens. */
	name: string;
	/** Opens the board's websocket. */
	connect: () => SocketLike;
	/** Saves a new shared background; given only to the board's owner (R-023). */
	onSetBackground?: (background: Background) => Promise<void>;
}

const BACKGROUND_NAMES: Record<Background, string> = {
	plain: "Gładkie tło",
	dots: "Kropki",
	grid: "Kratka",
	lines: "Linie",
};

/** A shared infinite board: two canvas layers, a tool palette, zoom buttons and live sync. */
export function BoardView({ authorId, name, connect, onSetBackground }: Props) {
	const [background, setBackground] = useState<Background>("plain");
	const committedRef = useRef<HTMLCanvasElement>(null);
	const liveRef = useRef<HTMLCanvasElement>(null);
	const settings = useMemo<Settings>(
		() => ({ tool: "pen", color: COLORS[0], size: SIZES[1] }),
		[],
	);
	const viewport = useMemo(() => new Viewport(), []);
	const [scale, setScale] = useState(1);
	/** Board position of the text being typed, if any. */
	const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);
	const [, setTick] = useState(0); // bumped when the view changes, so the text field follows it
	const ctl = useRef<Controller | null>(null);
	const syncRef = useRef<SyncClient | null>(null);
	const rendererRef = useRef<CanvasRenderer | null>(null);
	const theme = useTheme();
	/** Repaints after the view changed (set up by the effect below). */
	const viewChanged = useRef<() => void>(() => {});

	useEffect(() => {
		const committed = committedRef.current;
		const live = liveRef.current;
		if (!committed || !live) return;

		const canvas = new CanvasRenderer(committed, live, viewport);
		canvas.ink = (c) => displayColor(c, currentTheme());
		rendererRef.current = canvas;
		const board = new Board();
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
		controller.onTextRequest = ([x, y]) => setTextAt({ x, y });

		const changed = () => {
			canvas.redraw(board.strokes);
			setScale(viewport.scale);
			setTick((t) => t + 1);
		};
		viewChanged.current = changed;
		const gestures = new TouchGestures(
			viewport,
			() => controller.busy,
			changed,
		);

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
		};
		const move = (e: PointerEvent) => {
			if (e.pointerType === "touch") return gestures.move(e);
			// Mouse and pen are shared as a cursor, also while hovering without pressing.
			const [x, y] = viewport.toWorld(e.clientX, e.clientY);
			sync.cursorMove(x, y);
			controller.pointerMove(e);
		};
		const leave = (e: PointerEvent) => {
			if (e.pointerType !== "touch") sync.cursorHide();
		};
		const up = (e: PointerEvent) =>
			e.pointerType === "touch" ? gestures.up(e) : controller.pointerUp(e);
		const cancel = (e: PointerEvent) =>
			e.pointerType === "touch"
				? gestures.cancel(e)
				: controller.pointerCancel(e);
		const wheel = (e: WheelEvent) => {
			e.preventDefault(); // otherwise Ctrl + wheel (and trackpad pinch) zooms the whole page
			const k = e.deltaMode === 1 ? LINE_HEIGHT_PX : 1;
			if (e.ctrlKey || e.metaKey) {
				viewport.zoomAt(
					e.clientX,
					e.clientY,
					Math.exp(-e.deltaY * k * WHEEL_ZOOM_SPEED),
				);
			} else {
				viewport.panBy(-e.deltaX * k, -e.deltaY * k);
			}
			changed();
		};
		const prevent = (e: Event) => e.preventDefault();
		// A middle-button press would start the browser's autoscroll instead of panning the board.
		const middle = (e: MouseEvent) => {
			if (e.button === 1) e.preventDefault();
		};
		const key = (e: KeyboardEvent) => {
			if ((e.target as HTMLElement | null)?.tagName === "TEXTAREA") return; // typing, not undoing the board
			if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
			e.preventDefault();
			if (e.shiftKey) controller.redo();
			else controller.undo();
		};
		const gestureEvents = ["gesturestart", "gesturechange", "contextmenu"];

		addEventListener("resize", resize);
		addEventListener("keydown", key);
		live.addEventListener("pointerdown", down);
		live.addEventListener("pointermove", move);
		live.addEventListener("pointerup", up);
		live.addEventListener("pointercancel", cancel);
		live.addEventListener("pointerleave", leave);
		live.addEventListener("wheel", wheel, { passive: false });
		live.addEventListener("mousedown", middle);
		// Block Safari gestures and the context menu over the board.
		for (const ev of gestureEvents) document.addEventListener(ev, prevent);
		document.addEventListener("touchmove", prevent, { passive: false });

		return () => {
			sync.close();
			removeEventListener("resize", resize);
			removeEventListener("keydown", key);
			live.removeEventListener("pointerdown", down);
			live.removeEventListener("pointermove", move);
			live.removeEventListener("pointerup", up);
			live.removeEventListener("pointercancel", cancel);
			live.removeEventListener("pointerleave", leave);
			live.removeEventListener("wheel", wheel);
			live.removeEventListener("mousedown", middle);
			for (const ev of gestureEvents) document.removeEventListener(ev, prevent);
			document.removeEventListener("touchmove", prevent);
		};
	}, [settings, viewport, authorId, name, connect]);

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
	const zoomTo = (next: (current: number) => number) => {
		viewport.setScaleAt(innerWidth / 2, innerHeight / 2, next(viewport.scale));
		viewChanged.current();
	};

	return (
		<>
			<div
				class="board-bg"
				data-background={background}
				style={backgroundStyle(background, viewport)}
			/>
			<canvas id="board" ref={committedRef} />
			<canvas id="live" ref={liveRef} />
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
				onUndo={() => ctl.current?.undo()}
				onRedo={() => ctl.current?.redo()}
			/>
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
