import type { PointerInput } from "./controller";
import type { Viewport } from "./viewport";

interface Baseline {
	x: number;
	y: number;
	scale: number;
	cx: number;
	cy: number;
	dist: number;
}

/** How long after the pen was last seen a new finger still counts as a resting palm (N-010). */
const PALM_MS = 500;

/**
 * One finger pans, two fingers pan and pinch-zoom (R-070). Touches are ignored while the pen
 * is drawing, and for a moment after it was last seen (a palm resting beside it, N-010). The
 * view is computed from where the gesture started, so it does not drift when fingers move
 * one at a time.
 */
export class TouchGestures {
	private touches = new Map<number, { x: number; y: number }>();
	private baseline: Baseline | null = null;
	private lastPen = -Infinity;

	constructor(
		private viewport: Viewport,
		private penActive: () => boolean,
		private onChange: () => void,
		private now: () => number = () => performance.now(),
	) {}

	/** Notes that the pen is at the screen (touching or hovering): fingers now are a palm. */
	penSeen(): void {
		this.lastPen = this.now();
	}

	/** True while a finger is down and moves the view. */
	get active(): boolean {
		return this.baseline !== null;
	}

	down(e: PointerInput): void {
		if (this.penActive() || this.now() - this.lastPen < PALM_MS) return;
		this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
		this.rebase();
	}

	move(e: PointerInput): void {
		const t = this.touches.get(e.pointerId);
		if (!t) return;
		t.x = e.clientX;
		t.y = e.clientY;
		const b = this.baseline;
		if (!b || this.penActive()) return;
		const { cx, cy, dist } = this.measure();
		const v = this.viewport;
		// Board point that was under the starting centre must end up under the current centre.
		const wx = b.x + b.cx / b.scale;
		const wy = b.y + b.cy / b.scale;
		v.x = b.x;
		v.y = b.y;
		v.scale = b.scale;
		v.setScaleAt(b.cx, b.cy, b.scale * (dist / b.dist));
		const [sx, sy] = v.toScreen(wx, wy);
		v.panBy(cx - sx, cy - sy);
		this.onChange();
	}

	up(e: PointerInput): void {
		this.touches.delete(e.pointerId);
		this.rebase();
	}

	cancel(e: PointerInput): void {
		this.up(e);
	}

	private measure(): { cx: number; cy: number; dist: number } {
		const [a, b = a] = [...this.touches.values()];
		return {
			cx: (a.x + b.x) / 2,
			cy: (a.y + b.y) / 2,
			dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
		};
	}

	/** Starts a new gesture from the current finger positions (or ends it with fewer than two). */
	private rebase(): void {
		if (this.touches.size < 1) {
			this.baseline = null;
			return;
		}
		const { cx, cy, dist } = this.measure();
		const v = this.viewport;
		this.baseline = { x: v.x, y: v.y, scale: v.scale, cx, cy, dist };
	}
}
