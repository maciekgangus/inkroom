import type { Stroke } from "./board";
import { intersects, strokeBounds } from "./bounds";
import { isPolygonKind } from "./shapes";
import type { Rect } from "./viewport";

/**
 * The board's spatial tile index (R-118, ADR 0031): a grid of `CELL_SIZE` × `CELL_SIZE` board
 * units, so a hit test or a view cull does not scan every element. Owned and fed by `Board` only;
 * `queryRect`/`queryPoint` on the board are the public way in.
 *
 * Cells are keyed by a packed number (`Map<number, Set<Stroke>>`, no string keys), safe for
 * cell coordinates below 2^20 on both axes — over a billion board units in each direction.
 * An element covering more than `MAX_CELLS` cells, one outside the safe key range and one with
 * a non-finite box (no points) all go to the `large` bucket, which every query checks: they can
 * never hang a cell loop. Every insertion is remembered per id, so a remove or an update always
 * takes the element out of exactly the cells it was put into — never by recomputing its box,
 * which may have changed since (a font loaded, R-044/R-101).
 */

/** Side of a grid cell, in board units. */
export const CELL_SIZE = 1024;
/** |cx|, |cy| below this pack into an exact double key. */
const CELL_LIMIT = 2 ** 20;
const CELL_SPAN = 2 ** 21;
/** An element covering more cells than this goes to the `large` bucket. */
export const MAX_CELLS = 16;

/** The packed numeric key of a cell; only called for coordinates inside `CELL_LIMIT`. */
const cellKey = (cx: number, cy: number): number =>
	(cx + CELL_LIMIT) * CELL_SPAN + (cy + CELL_LIMIT);

/** How many cells `rect` covers, or Infinity when it has a non-finite side. */
export function cellSpan(rect: Rect): number {
	if (
		!Number.isFinite(rect.minX) ||
		!Number.isFinite(rect.minY) ||
		!Number.isFinite(rect.maxX) ||
		!Number.isFinite(rect.maxY)
	)
		return Number.POSITIVE_INFINITY;
	const minCx = Math.floor(rect.minX / CELL_SIZE);
	const maxCx = Math.floor(rect.maxX / CELL_SIZE);
	const minCy = Math.floor(rect.minY / CELL_SIZE);
	const maxCy = Math.floor(rect.maxY / CELL_SIZE);
	return (maxCx - minCx + 1) * (maxCy - minCy + 1);
}

/** Where an element was put: its box and the exact cell range (empty when `large`). */
interface Entry {
	stroke: Stroke;
	bounds: Rect;
	minCx: number;
	maxCx: number;
	minCy: number;
	maxCy: number;
	large: boolean;
}

export class SpatialIndex {
	private cells = new Map<number, Set<Stroke>>();
	private large = new Set<Stroke>();
	private entries = new Map<string, Entry>();

	/** How many elements are indexed. */
	get size(): number {
		return this.entries.size;
	}

	/** Puts an element in, remembered per id; an id already in is replaced. */
	add(stroke: Stroke): void {
		if (this.entries.has(stroke.id)) this.remove(stroke.id);
		const bounds = strokeBounds(stroke);
		const entry: Entry = {
			stroke,
			bounds,
			minCx: 0,
			maxCx: 0,
			minCy: 0,
			maxCy: 0,
			large: true,
		};
		// A point query must return a strict superset of what strokeHit/objectHit can catch, so
		// only elements whose hit geometry stays inside their box may sit in cells: an ellipse is
		// hit by a normalised-radius approximation that reaches far beyond its box along the major
		// axis, and a shape drawn from parts (a cube's back edges) can stick out of the box too.
		// Those always go to `large`, which every query checks.
		if (
			stroke.kind !== "ellipse" &&
			!isPolygonKind(stroke.kind) &&
			Number.isFinite(bounds.minX) &&
			Number.isFinite(bounds.minY) &&
			Number.isFinite(bounds.maxX) &&
			Number.isFinite(bounds.maxY)
		) {
			entry.minCx = Math.floor(bounds.minX / CELL_SIZE);
			entry.maxCx = Math.floor(bounds.maxX / CELL_SIZE);
			entry.minCy = Math.floor(bounds.minY / CELL_SIZE);
			entry.maxCy = Math.floor(bounds.maxY / CELL_SIZE);
			const count =
				(entry.maxCx - entry.minCx + 1) * (entry.maxCy - entry.minCy + 1);
			entry.large =
				count > MAX_CELLS ||
				entry.minCx < -CELL_LIMIT ||
				entry.maxCx >= CELL_LIMIT ||
				entry.minCy < -CELL_LIMIT ||
				entry.maxCy >= CELL_LIMIT;
		}
		this.entries.set(stroke.id, entry);
		if (entry.large) {
			this.large.add(stroke);
			return;
		}
		for (let cx = entry.minCx; cx <= entry.maxCx; cx++)
			for (let cy = entry.minCy; cy <= entry.maxCy; cy++) {
				const key = cellKey(cx, cy);
				let set = this.cells.get(key);
				if (!set) {
					set = new Set();
					this.cells.set(key, set);
				}
				set.add(stroke);
			}
	}

	/** Takes an element out of exactly the cells it was put into. */
	remove(id: string): boolean {
		const entry = this.entries.get(id);
		if (!entry) return false;
		this.entries.delete(id);
		if (entry.large) {
			this.large.delete(entry.stroke);
			return true;
		}
		for (let cx = entry.minCx; cx <= entry.maxCx; cx++)
			for (let cy = entry.minCy; cy <= entry.maxCy; cy++) {
				const key = cellKey(cx, cy);
				const set = this.cells.get(key);
				if (!set) continue;
				set.delete(entry.stroke);
				if (set.size === 0) this.cells.delete(key); // no empty cells left behind
			}
		return true;
	}

	/** Puts a new version of an element in, out of the old one's cells first. */
	update(stroke: Stroke): void {
		this.remove(stroke.id);
		this.add(stroke);
	}

	clear(): void {
		this.cells.clear();
		this.large.clear();
		this.entries.clear();
	}

	/**
	 * The indexed elements whose remembered box intersects `rect`, each once, in no particular
	 * order (the board sorts what it returns). The `large` bucket is always checked; with
	 * `looseLarge` its elements are returned without the box check — a point query needs a
	 * superset of what the hit tests can catch, and for elements in `large` the box alone does
	 * not guarantee that (an ellipse's hit reaches beyond its box).
	 */
	query(rect: Rect, looseLarge = false): Stroke[] {
		const out: Stroke[] = [];
		const seen = new Set<string>();
		const keep = (e: Entry, loose = false): void => {
			if (seen.has(e.stroke.id)) return;
			seen.add(e.stroke.id);
			if (loose || intersects(e.bounds, rect)) out.push(e.stroke);
		};
		for (const s of this.large) {
			const e = this.entries.get(s.id);
			if (e) keep(e, looseLarge);
		}
		const inRange =
			Number.isFinite(rect.minX) &&
			Number.isFinite(rect.minY) &&
			Number.isFinite(rect.maxX) &&
			Number.isFinite(rect.maxY);
		if (inRange) {
			const minCx = Math.floor(rect.minX / CELL_SIZE);
			const maxCx = Math.floor(rect.maxX / CELL_SIZE);
			const minCy = Math.floor(rect.minY / CELL_SIZE);
			const maxCy = Math.floor(rect.maxY / CELL_SIZE);
			if (
				minCx >= -CELL_LIMIT &&
				maxCx < CELL_LIMIT &&
				minCy >= -CELL_LIMIT &&
				maxCy < CELL_LIMIT
			) {
				for (let cx = minCx; cx <= maxCx; cx++)
					for (let cy = minCy; cy <= maxCy; cy++) {
						const set = this.cells.get(cellKey(cx, cy));
						if (!set) continue;
						for (const s of set) {
							const e = this.entries.get(s.id);
							if (e) keep(e);
						}
					}
				return out;
			}
		}
		// A rect outside the safe key range: every cell is a candidate.
		for (const e of this.entries.values()) keep(e);
		return out;
	}
}
