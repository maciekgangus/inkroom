export const MIN_SCALE = 0.1;
export const MAX_SCALE = 5;

/** The visible part of the board, in board coordinates. */
export interface Rect {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/**
 * Which part of the infinite board this client looks at (local, not synced).
 * (x, y) is the board point at the top-left of the screen; screen = (board - xy) * scale.
 */
export class Viewport {
	x = 0;
	y = 0;
	scale = 1;

	/** Screen position -> board position. */
	toWorld(sx: number, sy: number): [number, number] {
		return [this.x + sx / this.scale, this.y + sy / this.scale];
	}

	/** Board position -> screen position. */
	toScreen(wx: number, wy: number): [number, number] {
		return [(wx - this.x) * this.scale, (wy - this.y) * this.scale];
	}

	/** Drags the content by (dx, dy) screen pixels. */
	panBy(dx: number, dy: number): void {
		this.x -= dx / this.scale;
		this.y -= dy / this.scale;
	}

	/** Multiplies the scale by `factor`, keeping the board point under (sx, sy) in place. */
	zoomAt(sx: number, sy: number, factor: number): void {
		this.setScaleAt(sx, sy, this.scale * factor);
	}

	/** Sets the scale (clamped), keeping the board point under (sx, sy) in place. */
	setScaleAt(sx: number, sy: number, scale: number): void {
		const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
		if (next === this.scale) return;
		const [wx, wy] = this.toWorld(sx, sy);
		this.scale = next;
		this.x = wx - sx / next;
		this.y = wy - sy / next;
	}

	/** The board area visible on a screen of the given size. */
	worldRect(width: number, height: number): Rect {
		return {
			minX: this.x,
			minY: this.y,
			maxX: this.x + width / this.scale,
			maxY: this.y + height / this.scale,
		};
	}
}
