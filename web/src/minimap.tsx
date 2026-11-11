import { useEffect, useRef } from "preact/hooks";
import type { Stroke } from "./board/board";
import {
	centreOn,
	contentBounds,
	fromMap,
	type MapFit,
	mapFit,
	toMap,
} from "./board/minimap";
import { worldBounds } from "./board/transform";
import type { Viewport } from "./board/viewport";

/** The size of the map in px. */
const MAP_W = 260;
const MAP_H = 170;

/** More elements than this are drawn as a thinned-out sample, so a huge board stays cheap. */
const MAX_DRAWN = 4000;

interface Props {
	strokes: Stroke[];
	viewport: Viewport;
	/** Size of the screen the viewport is shown on. */
	screen: { w: number; h: number };
	/** How an element's stored colour is painted (dark mode swaps black and white). */
	ink: (color: string) => string;
	/** Called after a click or drag on the map has moved the viewport. */
	onNavigate: () => void;
}

/**
 * A map of the whole board (R-049): every element as a small coloured box, the part on screen as
 * a frame. A click or a drag puts the middle of the screen where the pointer is.
 */
export function Minimap({ strokes, viewport, screen, ink, onNavigate }: Props) {
	const canvas = useRef<HTMLCanvasElement>(null);
	/** While dragging, the map is kept as it was at the press, or it would slide under the pointer. */
	const frozen = useRef<MapFit | null>(null);

	const view = viewport.worldRect(screen.w, screen.h);
	const fit =
		frozen.current ??
		mapFit(contentBounds(strokes), view, { w: MAP_W, h: MAP_H });

	// Drawn after every render: the board changes under it all the time.
	useEffect(() => {
		const el = canvas.current;
		const ctx = el?.getContext("2d");
		if (!el || !ctx) return;
		const dpr = window.devicePixelRatio || 1;
		if (el.width !== MAP_W * dpr) {
			el.width = MAP_W * dpr;
			el.height = MAP_H * dpr;
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, MAP_W, MAP_H);
		const step = Math.max(1, Math.ceil(strokes.length / MAX_DRAWN));
		ctx.globalAlpha = 0.7;
		for (let i = 0; i < strokes.length; i += step) {
			const s = strokes[i];
			const b = worldBounds(s);
			const [x0, y0] = toMap(fit, b.minX, b.minY);
			const [x1, y1] = toMap(fit, b.maxX, b.maxY);
			ctx.fillStyle = s.kind === "image" ? "#9aa3b2" : ink(s.color);
			ctx.fillRect(x0, y0, Math.max(x1 - x0, 2), Math.max(y1 - y0, 2));
		}
		ctx.globalAlpha = 1;
		const [vx0, vy0] = toMap(fit, view.minX, view.minY);
		const [vx1, vy1] = toMap(fit, view.maxX, view.maxY);
		const accent =
			getComputedStyle(el).getPropertyValue("--accent").trim() || "#5b5bf0";
		ctx.fillStyle = accent;
		ctx.globalAlpha = 0.14;
		ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
		ctx.globalAlpha = 1;
		ctx.strokeStyle = accent;
		ctx.lineWidth = 2;
		ctx.strokeRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
	});

	const go = (e: PointerEvent) => {
		const el = canvas.current;
		const f = frozen.current;
		if (!el || !f) return;
		const r = el.getBoundingClientRect();
		const at = fromMap(f, e.clientX - r.left, e.clientY - r.top);
		centreOn(viewport, at, screen.w, screen.h);
		onNavigate();
	};

	return (
		<div class="minimap">
			<canvas
				ref={canvas}
				aria-label="board map"
				style={{ width: `${MAP_W}px`, height: `${MAP_H}px` }}
				onPointerDown={(e) => {
					e.preventDefault();
					(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
					frozen.current = fit;
					go(e);
				}}
				onPointerMove={(e) => frozen.current && go(e)}
				onPointerUp={() => {
					frozen.current = null;
					onNavigate();
				}}
				onPointerCancel={() => {
					frozen.current = null;
				}}
			/>
		</div>
	);
}
