import { type Background, isBackground } from "../board/background";
import { Board, type Point, type Stroke } from "../board/board";
import { LASER_TTL_MS, LaserTrails } from "../board/laser";
import type { Rect } from "../board/viewport";
import type { LogEvent } from "../recording-log";

// The state of a recorded board at any time (R-114): the starting state plus the event log of
// R-113 applied in order, with a keyframe every minute so seeking does not start from the beginning.

/** What `seek` reports changed: the elements, the strokes being drawn, the background. */
export const BOARD = 1;
export const LIVE = 2;
export const BG = 4;

/** A keyframe is saved this often (in the log's time) to jump back and forward quickly. */
export const KEYFRAME_MS = 60_000;
/** A cursor that stopped moving is not shown after this long, as on the live board. */
const CURSOR_TTL_MS = 15_000;

/** The first object of a recording: the board when the recording began. */
export interface Snapshot {
	v: number;
	strokes: Stroke[];
	background: Background;
	view: Rect;
	win: { w: number; h: number };
}

/** Where the person who recorded looked, as the centre and the size in board units. */
export interface Camera {
	cx: number;
	cy: number;
	rw: number;
	rh: number;
}

interface View {
	t: number;
	cx: number;
	cy: number;
	rw: number;
	rh: number;
}

interface Keyframe {
	/** The time of the keyframe and the index of the first event after it. */
	t: number;
	index: number;
	strokes: Stroke[];
	background: Background;
}

interface LiveData {
	id: string;
	authorId?: string;
	color?: string;
	size?: number;
	z?: number;
	dash?: Stroke["dash"];
	opacity?: number;
	points?: Point[];
}

export class ReplayEngine {
	/** The elements at the time last sought; the renderer draws from it. */
	readonly board = new Board();
	background: Background;
	/** The laser trails, faded by the replayed time (`visible(t)`). */
	lasers = new LaserTrails();

	private liveStrokes = new Map<string, Stroke>();
	private cursorsIn = new Map<
		string,
		{ name: string; x: number; y: number; seen: number }
	>();
	private index = 0;
	private now = 0;
	private keyframes: Keyframe[] = [];
	private views: View[] = [];

	constructor(
		private start: Snapshot,
		private events: LogEvent[],
	) {
		this.background = start.background;
		this.board.setStrokes(start.strokes.slice());
		this.events = [...events].sort((a, b) => a[0] - b[0]);
		this.buildIndexes();
	}

	/** The camera samples and the keyframes, from one pass over the log. */
	private buildIndexes(): void {
		const first = this.start.view;
		this.views.push(viewOf(0, first));
		const map = new Map(this.start.strokes.map((s) => [s.id, s]));
		let background = this.start.background;
		this.keyframes.push({
			t: 0,
			index: 0,
			strokes: [...map.values()],
			background,
		});
		let nextKey = KEYFRAME_MS;
		this.events.forEach(([t, type, data], i) => {
			while (t >= nextKey) {
				this.keyframes.push({
					t: nextKey,
					index: i,
					strokes: [...map.values()],
					background,
				});
				nextKey += KEYFRAME_MS;
			}
			switch (type) {
				case "a":
				case "u":
					map.set((data as Stroke).id, data as Stroke);
					break;
				case "r":
					map.delete(data as string);
					break;
				case "bg":
					if (isBackground(data)) background = data;
					break;
				case "reset": {
					const r = data as { strokes?: Stroke[]; background?: unknown };
					map.clear();
					for (const s of r.strokes ?? []) map.set(s.id, s);
					if (isBackground(r.background)) background = r.background;
					break;
				}
				case "v": {
					const v = data as Rect;
					if (t === 0) this.views[0] = viewOf(0, v);
					else this.views.push(viewOf(t, v));
					break;
				}
			}
		});
	}

	/** The time of the last event: the log's own length. */
	get lastEventMs(): number {
		return this.events.length ? this.events[this.events.length - 1][0] : 0;
	}

	/**
	 * Moves the state to time `t` (ms), forward or back, and tells what changed (BOARD, LIVE, BG
	 * added together). Going back, or far forward, starts from the nearest keyframe.
	 */
	seek(t: number): number {
		let changed = 0;
		if (t < this.now || t - this.now > KEYFRAME_MS) {
			const kf = this.keyframeBefore(t);
			if (t < this.now || kf.index > this.index) changed |= this.restore(kf);
		}
		const laserFrom = t - LASER_TTL_MS;
		while (this.index < this.events.length && this.events[this.index][0] <= t) {
			changed |= this.apply(this.events[this.index], laserFrom);
			this.index++;
		}
		this.now = t;
		return changed;
	}

	private keyframeBefore(t: number): Keyframe {
		let found = this.keyframes[0];
		for (const kf of this.keyframes) {
			if (kf.t > t) break;
			found = kf;
		}
		return found;
	}

	private restore(kf: Keyframe): number {
		this.board.setStrokes(kf.strokes.slice());
		this.background = kf.background;
		this.liveStrokes.clear();
		this.cursorsIn.clear();
		this.lasers = new LaserTrails();
		this.index = kf.index;
		this.now = kf.t;
		return BOARD | LIVE | BG;
	}

	private apply([t, type, data]: LogEvent, laserFrom: number): number {
		switch (type) {
			case "a": {
				const s = data as Stroke;
				this.board.applyRemote({ t: "add", stroke: s });
				return BOARD | (this.liveStrokes.delete(s.id) ? LIVE : 0);
			}
			case "u":
				this.board.applyRemote({ t: "update", stroke: data as Stroke });
				return BOARD;
			case "r":
				this.board.applyRemote({ t: "remove", id: data as string });
				return BOARD;
			case "bg":
				if (!isBackground(data)) return 0;
				this.background = data;
				return BG;
			case "reset": {
				const r = data as { strokes?: Stroke[]; background?: unknown };
				this.board.setStrokes((r.strokes ?? []).slice());
				this.liveStrokes.clear();
				if (isBackground(r.background)) this.background = r.background;
				return BOARD | LIVE | BG;
			}
			case "l":
				this.addLive(data as LiveData);
				return LIVE;
			case "ld": {
				for (const id of data as string[]) this.liveStrokes.delete(id);
				return LIVE;
			}
			case "c": {
				const c = data as {
					id: string;
					name?: string;
					x?: number;
					y?: number;
					hidden?: boolean;
				};
				if (c.hidden) this.cursorsIn.delete(c.id);
				else if (typeof c.x === "number" && typeof c.y === "number")
					this.cursorsIn.set(c.id, {
						name: c.name ?? "",
						x: c.x,
						y: c.y,
						seen: t,
					});
				return 0;
			}
			case "cd":
				for (const id of data as string[]) this.cursorsIn.delete(id);
				return 0;
			case "z": {
				if (t < laserFrom) return 0; // faded long before the time we look at
				const z = data as {
					id: string;
					start?: boolean;
					points?: [number, number][];
				};
				this.lasers.add(z.id, z.points ?? [], z.start === true, t);
				return 0;
			}
			default:
				return 0; // the camera ("v") is read by `camera`
		}
	}

	private addLive(m: LiveData): void {
		if (!m.id || !m.points) return;
		const have = this.liveStrokes.get(m.id);
		if (have) {
			have.points.push(...m.points);
			return;
		}
		this.liveStrokes.set(m.id, {
			id: m.id,
			authorId: m.authorId ?? "",
			color: m.color ?? "#111",
			size: m.size ?? 4,
			z: m.z ?? 0,
			...(m.dash ? { dash: m.dash } : {}),
			...(m.opacity !== undefined ? { opacity: m.opacity } : {}),
			points: [...m.points],
		});
	}

	/** The strokes being drawn at the time last sought. */
	live(): Stroke[] {
		return [...this.liveStrokes.values()];
	}

	/** The cursors that moved within the last seconds before `t`. */
	cursors(t: number): { id: string; name: string; x: number; y: number }[] {
		const out = [];
		for (const [id, c] of this.cursorsIn)
			if (t - c.seen < CURSOR_TTL_MS)
				out.push({ id, name: c.name, x: c.x, y: c.y });
		return out;
	}

	/**
	 * Where the person who recorded looked at time `t`: between two samples the centre moves
	 * evenly and the size changes by an even ratio, so a pan or a zoom is smooth.
	 */
	camera(t: number): Camera {
		const v = this.views;
		if (t <= v[0].t) return of(v[0]);
		const last = v[v.length - 1];
		if (t >= last.t) return of(last);
		let lo = 0;
		let hi = v.length - 1;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (v[mid].t <= t) lo = mid;
			else hi = mid;
		}
		const a = v[lo];
		const b = v[hi];
		const f = (t - a.t) / (b.t - a.t);
		const rw = a.rw * (b.rw / a.rw) ** f;
		const aspect = a.rh / a.rw + (b.rh / b.rw - a.rh / a.rw) * f;
		return {
			cx: a.cx + (b.cx - a.cx) * f,
			cy: a.cy + (b.cy - a.cy) * f,
			rw,
			rh: rw * aspect,
		};
	}
}

const of = (v: View): Camera => ({ cx: v.cx, cy: v.cy, rw: v.rw, rh: v.rh });

function viewOf(t: number, r: Rect): View {
	const rw = r.maxX - r.minX;
	const rh = r.maxY - r.minY;
	return { t, cx: r.minX + rw / 2, cy: r.minY + rh / 2, rw, rh };
}
