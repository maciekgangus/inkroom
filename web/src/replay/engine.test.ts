import { describe, expect, test } from "vitest";
import type { Stroke } from "../board/board";
import type { LogEvent } from "../recording-log";
import {
	BG,
	BOARD,
	KEYFRAME_MS,
	LIVE,
	ReplayEngine,
	type Snapshot,
} from "./engine";

const stroke = (id: string, z = 1, x = 0): Stroke =>
	({
		id,
		authorId: "a",
		color: "#111",
		size: 4,
		z,
		points: [
			[x, 0, 1],
			[x + 1, 1, 1],
			[x + 2, 2, 1],
		],
	}) as Stroke;

const snapshot = (strokes: Stroke[] = []): Snapshot => ({
	v: 1,
	strokes,
	background: "plain",
	view: { minX: 0, minY: 0, maxX: 800, maxY: 600 },
	win: { w: 800, h: 600 },
});
const ids = (e: ReplayEngine) => e.board.strokes.map((s) => s.id);

describe("ReplayEngine: the board over time (R-114)", () => {
	test("begins with the starting state", () => {
		const e = new ReplayEngine(snapshot([stroke("s0")]), []);
		expect(ids(e)).toEqual(["s0"]);
	});

	test("applies the events up to the time, no further, and says what changed", () => {
		const events: LogEvent[] = [
			[100, "a", stroke("s1", 2)],
			[200, "a", stroke("s2", 3)],
			[300, "r", "s1"],
		];
		const e = new ReplayEngine(snapshot(), events);
		expect(e.seek(50)).toBe(0);
		expect(e.seek(250) & BOARD).toBe(BOARD);
		expect(ids(e)).toEqual(["s1", "s2"]);
		expect(e.seek(250)).toBe(0); // nothing new
		expect(e.seek(300) & BOARD).toBe(BOARD);
		expect(ids(e)).toEqual(["s2"]);
	});

	test("an update replaces the element, a background change is reported", () => {
		const moved = { ...stroke("s1"), color: "#f00" };
		const e = new ReplayEngine(snapshot(), [
			[10, "a", stroke("s1")],
			[20, "u", moved],
			[30, "bg", "grid"],
		]);
		expect(e.seek(25)).toBe(BOARD);
		expect(e.board.strokes[0].color).toBe("#f00");
		expect(e.seek(30)).toBe(BG);
		expect(e.background).toBe("grid");
	});

	test("seeking back gives the state of that time, not a mix", () => {
		const e = new ReplayEngine(snapshot([stroke("s0")]), [
			[100, "a", stroke("s1")],
			[200, "r", "s0"],
			[300, "bg", "dots"],
		]);
		e.seek(1000);
		expect(ids(e)).toEqual(["s1"]);
		expect(e.background).toBe("dots");
		e.seek(150);
		expect(ids(e)).toEqual(["s0", "s1"]);
		expect(e.background).toBe("plain");
		e.seek(0);
		expect(ids(e)).toEqual(["s0"]);
	});

	test("a jump over a long stretch restarts from a keyframe and gets the same result", () => {
		const events: LogEvent[] = [];
		for (let i = 1; i <= 50; i++) {
			events.push([i * 5000, "a", stroke(`s${i}`, i)]);
			if (i % 3 === 0) events.push([i * 5000 + 1, "r", `s${i - 1}`]);
		}
		const stepped = new ReplayEngine(snapshot(), events);
		for (let t = 0; t <= 200_000; t += 1000) stepped.seek(t);
		const jumped = new ReplayEngine(snapshot(), events);
		jumped.seek(200_000);
		expect(ids(jumped)).toEqual(ids(stepped));
		// And back to the middle, across keyframes, still the same as stepping there.
		jumped.seek(KEYFRAME_MS * 2 + 7);
		const fresh = new ReplayEngine(snapshot(), events);
		for (let t = 0; t <= KEYFRAME_MS * 2 + 7; t += 1000) fresh.seek(t);
		fresh.seek(KEYFRAME_MS * 2 + 7);
		expect(ids(jumped)).toEqual(ids(fresh));
	});

	test("a reset (the connection was lost and the board came again) replaces everything", () => {
		const e = new ReplayEngine(snapshot([stroke("s0")]), [
			[
				100,
				"reset",
				{ strokes: [stroke("n1"), stroke("n2", 2)], background: "grid" },
			],
		]);
		e.seek(100);
		expect(ids(e)).toEqual(["n1", "n2"]);
		expect(e.background).toBe("grid");
	});
});

describe("ReplayEngine: strokes in progress, cursors and lasers", () => {
	test("a stroke being drawn grows with every message and is replaced by the finished one", () => {
		const e = new ReplayEngine(snapshot(), [
			[
				10,
				"l",
				{
					id: "s1",
					authorId: "b",
					color: "#f00",
					size: 3,
					z: 1,
					points: [[0, 0, 1]],
				},
			],
			[
				20,
				"l",
				{
					id: "s1",
					authorId: "b",
					points: [
						[1, 1, 1],
						[2, 2, 1],
					],
				},
			],
			[40, "a", stroke("s1")],
		]);
		expect(e.seek(25) & LIVE).toBe(LIVE);
		expect(e.live().map((s) => [s.id, s.points.length, s.color])).toEqual([
			["s1", 3, "#f00"],
		]);
		e.seek(45);
		expect(e.live()).toEqual([]);
		expect(ids(e)).toEqual(["s1"]);
	});

	test("live_drop removes a stroke that was never finished", () => {
		const e = new ReplayEngine(snapshot(), [
			[10, "l", { id: "s1", authorId: "b", points: [[0, 0, 1]] }],
			[20, "ld", ["s1"]],
		]);
		e.seek(15);
		expect(e.live()).toHaveLength(1);
		e.seek(25);
		expect(e.live()).toEqual([]);
	});

	test("a cursor is shown while it is fresh, hidden when asked, and forgotten when it goes quiet", () => {
		const e = new ReplayEngine(snapshot(), [
			[100, "c", { id: "b", name: "Bob", x: 5, y: 6 }],
			[200, "c", { id: "b", name: "Bob", x: 7, y: 8 }],
			[300, "c", { id: "c", name: "Cy", x: 1, y: 1 }],
			[400, "c", { id: "c", hidden: true }],
		]);
		e.seek(250);
		expect(e.cursors(250)).toEqual([{ id: "b", name: "Bob", x: 7, y: 8 }]);
		e.seek(350);
		expect(
			e
				.cursors(350)
				.map((c) => c.id)
				.sort(),
		).toEqual(["b", "c"]);
		e.seek(450);
		expect(e.cursors(450).map((c) => c.id)).toEqual(["b"]);
		e.seek(200 + 16_000);
		expect(e.cursors(200 + 16_000)).toEqual([]);
	});

	test("laser trails fade with the replayed time, and seeking back forgets what was not yet drawn", () => {
		const e = new ReplayEngine(snapshot(), [
			[
				1000,
				"z",
				{
					id: "b",
					start: true,
					points: [
						[1, 1],
						[2, 2],
					],
				},
			],
		]);
		e.seek(1100);
		expect(e.lasers.visible(1100)).toHaveLength(1);
		e.seek(500);
		expect(e.lasers.visible(500)).toEqual([]);
		e.seek(5000);
		expect(e.lasers.visible(5000)).toEqual([]); // long gone
	});
});

describe("ReplayEngine: the camera", () => {
	const view = (t: number, minX: number, w = 800): LogEvent => [
		t,
		"v",
		{ minX, minY: 0, maxX: minX + w, maxY: w * 0.75, w: 800, h: 600 },
	];

	test("starts where the recording began", () => {
		const e = new ReplayEngine(snapshot(), []);
		const c = e.camera(0);
		expect([c.cx, c.cy, c.rw, c.rh].map(Math.round)).toEqual([
			400, 300, 800, 600,
		]);
	});

	test("a step glides: it starts after the sample, never overshoots and ends on the target", () => {
		const e = new ReplayEngine(snapshot(), [view(0, 0), view(1000, 1000)]);
		let last = e.camera(0).cx;
		for (let t = 100; t <= 3000; t += 100) {
			const cx = e.camera(t).cx;
			expect(cx).toBeGreaterThanOrEqual(last - 1e-9);
			expect(cx).toBeLessThanOrEqual(1400 + 1e-9);
			last = cx;
		}
		expect(e.camera(600).cx).toBeLessThan(450); // not yet: the step is at 1000 ms
		const mid = e.camera(1000).cx; // a gliding step, neither at the start nor on the target
		expect(mid).toBeGreaterThan(450);
		expect(mid).toBeLessThan(1350);
		expect(e.camera(3000).cx).toBeCloseTo(1400, 1);
	});

	test("a rest stays a rest: no drift while nothing was sampled", () => {
		// The view moved at the start and then again 27 s later; in between it did not move.
		const e = new ReplayEngine(snapshot(), [
			view(0, 0),
			view(50, 100),
			view(27_000, 100),
			view(27_050, 600),
		]);
		expect(e.camera(5000).cx).toBeCloseTo(500, 3);
		expect(e.camera(20_000).cx).toBeCloseTo(500, 3);
	});

	test("a seek gives the same camera as playing up to it (nothing depends on the way there)", () => {
		const log = [view(0, 0), view(50, 40), view(100, 90), view(150, 200)];
		const a = new ReplayEngine(snapshot(), log);
		const b = new ReplayEngine(snapshot(), log);
		for (let t = 0; t < 600; t += 25) a.camera(t);
		expect(b.camera(300)).toEqual(a.camera(300));
	});

	test("a zoom eases in its ratio, so it feels even", () => {
		const e = new ReplayEngine(snapshot(), [
			view(0, 0, 800),
			view(1000, 0, 3200),
		]);
		const early = e.camera(900).rw;
		expect(early).toBeGreaterThan(800);
		expect(early).toBeLessThan(3200);
		expect(e.camera(4000).rw).toBeCloseTo(3200, 0);
		// halfway along the ease the ratio is the geometric mean, not the arithmetic one
		const w = 1 - Math.exp(-0.5);
		const t = 1000 - 140 + 140 * 0.5; // t + 140 ms ahead is 0.5 time constants after the step
		expect(e.camera(t).rw).toBeCloseTo(800 * 4 ** w, 3);
	});

	test("after the last sample the camera ends on it; before the first it is at the start", () => {
		const e = new ReplayEngine(snapshot(), [view(1000, 50)]);
		expect(e.camera(10_000).cx).toBeCloseTo(450, 3);
		expect(e.camera(0).cx).toBeCloseTo(400, 1);
	});
});
