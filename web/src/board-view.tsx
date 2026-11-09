import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Board } from "./board/board";
import { CanvasRenderer } from "./board/canvas-renderer";
import { Controller, type Renderer, type Settings } from "./board/controller";
import { TouchGestures } from "./board/gestures";
import { Viewport } from "./board/viewport";
import { type SocketLike, SyncClient } from "./sync/sync";
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
	/** Opens the board's websocket. */
	connect: () => SocketLike;
}

/** A shared infinite board: two canvas layers, a tool palette, zoom buttons and live sync. */
export function BoardView({ authorId, connect }: Props) {
	const committedRef = useRef<HTMLCanvasElement>(null);
	const liveRef = useRef<HTMLCanvasElement>(null);
	const settings = useMemo<Settings>(
		() => ({ tool: "pen", color: COLORS[0], size: SIZES[1] }),
		[],
	);
	const viewport = useMemo(() => new Viewport(), []);
	const [scale, setScale] = useState(1);
	const ctl = useRef<Controller | null>(null);
	/** Repaints after the view changed (set up by the effect below). */
	const viewChanged = useRef<() => void>(() => {});

	useEffect(() => {
		const committed = committedRef.current;
		const live = liveRef.current;
		if (!committed || !live) return;

		const canvas = new CanvasRenderer(committed, live, viewport);
		const board = new Board();
		const sync = new SyncClient(board, {
			createSocket: connect,
			onUpdate: () => {
				canvas.redraw(board.strokes);
				canvas.setRemoteLive(sync.liveStrokes());
			},
		});
		const renderer: Renderer = {
			drawLive: (stroke) => {
				canvas.drawLive(stroke);
				if (stroke) sync.liveUpdate(stroke);
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

		const changed = () => {
			canvas.redraw(board.strokes);
			setScale(viewport.scale);
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
		const move = (e: PointerEvent) =>
			e.pointerType === "touch" ? gestures.move(e) : controller.pointerMove(e);
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
			live.removeEventListener("wheel", wheel);
			live.removeEventListener("mousedown", middle);
			for (const ev of gestureEvents) document.removeEventListener(ev, prevent);
			document.removeEventListener("touchmove", prevent);
		};
	}, [settings, viewport, authorId, connect]);

	// The buttons zoom around the centre of the screen.
	const zoomTo = (next: (current: number) => number) => {
		viewport.setScaleAt(innerWidth / 2, innerHeight / 2, next(viewport.scale));
		viewChanged.current();
	};

	return (
		<>
			<canvas id="board" ref={committedRef} />
			<canvas id="live" ref={liveRef} />
			<Toolbar
				settings={settings}
				onUndo={() => ctl.current?.undo()}
				onRedo={() => ctl.current?.redo()}
			/>
			<ZoomControls
				scale={scale}
				onZoomIn={() => zoomTo((s) => s * ZOOM_STEP)}
				onZoomOut={() => zoomTo((s) => s / ZOOM_STEP)}
				onReset={() => zoomTo(() => 1)}
			/>
		</>
	);
}
