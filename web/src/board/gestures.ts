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

/**
 * Two-finger pan and pinch-zoom. One finger does nothing (palm rejection, N-010), and
 * touches are ignored while the pen is drawing. The view is computed from where the
 * gesture started, so it does not drift when fingers move one at a time.
 */
export class TouchGestures {
	private touches = new Map<number, { x: number; y: number }>();
	private baseline: Baseline | null = null;

	constructor(
		private viewport: Viewport,
		private penActive: () => boolean,
		private onChange: () => void,
	) {}

	/** True while two fingers are down. */
	get active(): boolean {
		return this.baseline !== null;
	}

	down(e: PointerInput): void {
		if (this.penActive()) return;
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
		const [a, b] = [...this.touches.values()];
		return {
			cx: (a.x + b.x) / 2,
			cy: (a.y + b.y) / 2,
			dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
		};
	}

	/** Starts a new gesture from the current finger positions (or ends it with fewer than two). */
	private rebase(): void {
		if (this.touches.size < 2) {
			this.baseline = null;
			return;
		}
		const { cx, cy, dist } = this.measure();
		const v = this.viewport;
		this.baseline = { x: v.x, y: v.y, scale: v.scale, cx, cy, dist };
	}
}
