/** How long a point of the laser's trail stays visible, fading all the while. */
export const LASER_TTL_MS = 1500;
/** The most points one line of a trail keeps; older ones are dropped (they have faded anyway). */
const MAX_POINTS = 600;

interface Stamped {
	x: number;
	y: number;
	t: number;
}

/** What is drawn of a trail: its points with their strength (1 new, 0 gone). */
export interface LaserLine {
	id: string;
	points: { x: number; y: number; alpha: number }[];
}

/**
 * The trails of the red laser pointer, ours and other people's: lines of points that fade away
 * and are never kept on the board (a pointer, not a drawing). A line is one press of the button;
 * a new press starts a new line, so two strokes are not joined.
 */
export class LaserTrails {
	private lines = new Map<string, Stamped[][]>();

	/** Adds points of a person's trail seen at `now`; `start` begins a new line. */
	add(
		id: string,
		points: [number, number][],
		start: boolean,
		now: number,
	): void {
		const fresh = points.filter(
			(p) => Number.isFinite(p[0]) && Number.isFinite(p[1]),
		);
		if (fresh.length === 0) return;
		const mine = this.lines.get(id) ?? [];
		if (start || mine.length === 0) mine.push([]);
		const line = mine[mine.length - 1];
		for (const [x, y] of fresh) line.push({ x, y, t: now });
		if (line.length > MAX_POINTS) line.splice(0, line.length - MAX_POINTS);
		this.lines.set(id, mine);
	}

	/** The lines that can still be seen at `now`, the dead points left out; forgets the rest. */
	visible(now: number): LaserLine[] {
		const out: LaserLine[] = [];
		for (const [id, mine] of this.lines) {
			const alive: Stamped[][] = [];
			for (const line of mine) {
				const kept = line.filter((p) => now - p.t < LASER_TTL_MS);
				if (kept.length === 0) continue;
				alive.push(kept);
				out.push({
					id,
					points: kept.map((p) => ({
						x: p.x,
						y: p.y,
						alpha: Math.max(0, 1 - (now - p.t) / LASER_TTL_MS),
					})),
				});
			}
			if (alive.length === 0) this.lines.delete(id);
			else this.lines.set(id, alive);
		}
		return out;
	}

	/** Whether anything is still visible at `now` (so the screen must go on being drawn). */
	active(now: number): boolean {
		return this.visible(now).length > 0;
	}
}
