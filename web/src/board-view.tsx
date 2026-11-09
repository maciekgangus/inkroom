import { useEffect, useMemo, useRef } from "preact/hooks";
import { Board } from "./board/board";
import { CanvasRenderer } from "./board/canvas-renderer";
import { Controller, type Renderer, type Settings } from "./board/controller";
import { type SocketLike, SyncClient } from "./sync/sync";
import { COLORS, SIZES, Toolbar } from "./toolbar";

/** Not crypto.randomUUID: it is missing on http:// pages (LAN testing on an iPad). */
export const newId = () =>
	`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

interface Props {
	authorId: string;
	/** Opens the board's websocket. */
	connect: () => SocketLike;
}

/** A shared drawing board: two canvas layers, a tool palette and live sync. */
export function BoardView({ authorId, connect }: Props) {
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

		const canvas = new CanvasRenderer(committed, live);
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
			authorId,
			newId,
		);
		ctl.current = controller;

		const resize = () => {
			canvas.resize();
			canvas.redraw(board.strokes);
		};
		resize();
		sync.connect();

		const down = (e: PointerEvent) => {
			if (e.pointerType !== "touch") live.setPointerCapture(e.pointerId);
			controller.pointerDown(e);
		};
		const move = (e: PointerEvent) => controller.pointerMove(e);
		const up = (e: PointerEvent) => controller.pointerUp(e);
		const cancel = (e: PointerEvent) => controller.pointerCancel(e);
		const prevent = (e: Event) => e.preventDefault();
		const key = (e: KeyboardEvent) => {
			if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
			e.preventDefault();
			if (e.shiftKey) controller.redo();
			else controller.undo();
		};
		const gestures = ["gesturestart", "gesturechange", "contextmenu"];

		addEventListener("resize", resize);
		addEventListener("keydown", key);
		live.addEventListener("pointerdown", down);
		live.addEventListener("pointermove", move);
		live.addEventListener("pointerup", up);
		live.addEventListener("pointercancel", cancel);
		// Block Safari gestures and the context menu over the board.
		for (const ev of gestures) document.addEventListener(ev, prevent);
		document.addEventListener("touchmove", prevent, { passive: false });

		return () => {
			sync.close();
			removeEventListener("resize", resize);
			removeEventListener("keydown", key);
			live.removeEventListener("pointerdown", down);
			live.removeEventListener("pointermove", move);
			live.removeEventListener("pointerup", up);
			live.removeEventListener("pointercancel", cancel);
			for (const ev of gestures) document.removeEventListener(ev, prevent);
			document.removeEventListener("touchmove", prevent);
		};
	}, [settings, authorId, connect]);

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
