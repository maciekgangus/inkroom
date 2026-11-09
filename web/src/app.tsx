import { useEffect, useMemo, useRef } from "preact/hooks";
import { Board } from "./board/board";
import { CanvasRenderer } from "./board/canvas-renderer";
import { Controller, type Settings } from "./board/controller";
import { COLORS, SIZES, Toolbar } from "./toolbar";

const AUTHOR = "local";

/** Not crypto.randomUUID: it is missing on http:// pages (LAN testing on an iPad). */
const newId = () =>
	`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Root component: local drawing board with a tool palette. */
export function App() {
	const committedRef = useRef<HTMLCanvasElement>(null);
	const liveRef = useRef<HTMLCanvasElement>(null);
	const settings = useMemo<Settings>(
		() => ({ tool: "pen", color: COLORS[0], size: SIZES[1] }),
		[],
	);
	const ctl = useRef<Controller | null>(null);

	useEffect(() => {
		const committed = committedRef.current;
		const live = liveRef.current;
		if (!committed || !live) return;

		const renderer = new CanvasRenderer(committed, live);
		const board = new Board();
		const controller = new Controller(board, renderer, settings, AUTHOR, newId);
		ctl.current = controller;

		const resize = () => {
			renderer.resize();
			renderer.redraw(board.strokes);
		};
		resize();

		const down = (e: PointerEvent) => {
			if (e.pointerType !== "touch") live.setPointerCapture(e.pointerId);
			controller.pointerDown(e);
		};
		const prevent = (e: Event) => e.preventDefault();
		const key = (e: KeyboardEvent) => {
			if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
			e.preventDefault();
			if (e.shiftKey) controller.redo();
			else controller.undo();
		};

		addEventListener("resize", resize);
		addEventListener("keydown", key);
		live.addEventListener("pointerdown", down);
		live.addEventListener("pointermove", (e) => controller.pointerMove(e));
		live.addEventListener("pointerup", (e) => controller.pointerUp(e));
		live.addEventListener("pointercancel", (e) => controller.pointerCancel(e));
		// Block Safari gestures and the context menu over the board.
		for (const ev of ["gesturestart", "gesturechange", "contextmenu"])
			document.addEventListener(ev, prevent);
		document.addEventListener("touchmove", prevent, { passive: false });

		return () => {
			removeEventListener("resize", resize);
			removeEventListener("keydown", key);
			for (const ev of ["gesturestart", "gesturechange", "contextmenu"])
				document.removeEventListener(ev, prevent);
			document.removeEventListener("touchmove", prevent);
		};
	}, [settings]);

	return (
		<>
			<canvas id="board" ref={committedRef} />
			<canvas id="live" ref={liveRef} />
			<Toolbar
				settings={settings}
				onUndo={() => ctl.current?.undo()}
				onRedo={() => ctl.current?.redo()}
			/>
		</>
	);
}
