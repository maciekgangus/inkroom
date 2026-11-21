/**
 * Level of detail of a freehand stroke (R-100). A board seen from far away needs no more of a
 * stroke than the screen can show: below half scale the stroke's samples are thinned out, so its
 * outline has a fraction of the vertices (less native memory and quicker painting).
 */

/** The finest scale that still needs every sample. */
const FULL_DETAIL_SCALE = 0.5;
/** The coarsest tier; farther views gain nothing more. */
const MAX_TIER = 4;
/** What may be lost from the picture, in screen px, at the closest scale of a tier. */
const TOLERANCE_PX = 0.4;

/** 0 (every sample) at half scale or closer, one more for every halving of the scale. */
export function lodTier(scale: number): number {
	if (scale >= FULL_DETAIL_SCALE) return 0;
	return Math.min(MAX_TIER, Math.ceil(Math.log2(FULL_DETAIL_SCALE / scale)));
}

/** The most a sample may be off the thinned stroke, in board units; none for the finest tier. */
export function lodTolerance(tier: number): number {
	return tier ? TOLERANCE_PX * 2 ** tier : 0;
}

/**
 * Douglas-Peucker thinning: the points that stay are those of the original (the same objects),
 * the ends always among them. Pressure counts as a third dimension: a point also stays when the
 * pen's width, as the straight run between its neighbours would give it, is off by more than
 * `tolerance` (half the stroke's `size` per unit of pressure).
 */
export function decimate<T extends number[]>(
	points: T[],
	tolerance: number,
	size: number,
): T[] {
	const n = points.length;
	if (tolerance <= 0 || n <= 2) return points;
	const keep = new Uint8Array(n);
	keep[0] = keep[n - 1] = 1;
	const stack: [number, number][] = [[0, n - 1]];
	while (stack.length) {
		const [a, b] = stack.pop() as [number, number];
		if (b - a < 2) continue;
		const [ax, ay, ap = 0] = points[a];
		const dx = points[b][0] - ax;
		const dy = points[b][1] - ay;
		const dp = (points[b][2] ?? 0) - ap;
		const len2 = dx * dx + dy * dy;
		let worst = -1;
		let at = -1;
		for (let i = a + 1; i < b; i++) {
			const p = points[i];
			const t = len2
				? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2))
				: 0;
			const off = Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy));
			const width = Math.abs((p[2] ?? 0) - (ap + t * dp)) * size * 0.5;
			const e = Math.max(off, width);
			if (e > worst) {
				worst = e;
				at = i;
			}
		}
		if (worst > tolerance) {
			keep[at] = 1;
			stack.push([a, at], [at, b]);
		}
	}
	const out: T[] = [];
	for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
	return out;
}
