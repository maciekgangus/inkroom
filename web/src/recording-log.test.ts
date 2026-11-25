import { describe, expect, test } from "vitest";
import { EventLog } from "./recording-log";

const stroke = (id: string) =>
	({
		id,
		authorId: "a",
		color: "#111",
		size: 4,
		z: 1,
		points: [[0, 0, 1]],
	}) as never;

describe("EventLog (R-113)", () => {
	let now = 1000;
	const log = () => new EventLog(() => now);

	test("stamps every event with the milliseconds since the log began", () => {
		now = 1000;
		const l = log();
		now = 1250;
		l.message({ t: "remove", id: "s1" }, false);
		now = 2000.4;
		l.message({ t: "background", value: "grid" }, false);
		expect(l.take()).toEqual([
			[250, "r", "s1"],
			[1000, "bg", "grid"],
		]);
	});

	test("what came from the server: elements, strokes in progress, cursors, lasers", () => {
		now = 0;
		const l = log();
		l.message({ t: "add", stroke: stroke("s1") }, false);
		l.message({ t: "update", stroke: stroke("s1") }, false);
		l.message(
			{
				t: "live",
				id: "s2",
				authorId: "b",
				color: "#f00",
				size: 3,
				z: 2,
				points: [[1, 2, 0.5]],
			},
			false,
		);
		l.message({ t: "live_drop", ids: ["s2"] }, false);
		l.message({ t: "cursor", id: "b", name: "Bob", x: 5, y: 6 }, false);
		l.message({ t: "cursor", id: "b", hidden: true }, false);
		l.message({ t: "cursor_drop", ids: ["b"] }, false);
		l.message({ t: "laser", id: "b", start: true, points: [[1, 1]] }, false);
		const kinds = l.take().map((e) => e[1]);
		expect(kinds).toEqual(["a", "u", "l", "ld", "c", "c", "cd", "z"]);
	});

	test("the payload is the message without its type", () => {
		now = 0;
		const l = log();
		l.message({ t: "cursor", id: "b", name: "Bob", x: 5, y: 6 }, false);
		l.message({ t: "laser", id: "b", start: true, points: [[1, 1]] }, false);
		expect(l.take()).toEqual([
			[0, "c", { id: "b", name: "Bob", x: 5, y: 6 }],
			[0, "z", { id: "b", start: true, points: [[1, 1]] }],
		]);
	});

	test("of what we send, only what the server does not send back is kept", () => {
		now = 0;
		const l = log();
		l.message({ t: "add", stroke: stroke("s1") }, true); // comes back as the server's add
		l.message({ t: "update", stroke: stroke("s1") }, true);
		l.message({ t: "remove", id: "s1" }, true);
		l.message({ t: "ping" }, true);
		l.message({ t: "follow", id: "x" }, true);
		l.message(
			{ t: "live", id: "s3", authorId: "me", points: [[1, 1, 1]] },
			true,
		);
		l.message({ t: "cursor", id: "me", name: "Ja", x: 1, y: 2 }, true);
		l.message({ t: "laser", id: "me", start: false, points: [[3, 3]] }, true);
		expect(l.take().map((e) => e[1])).toEqual(["l", "c", "z"]);
	});

	test("messages of no interest to a replay are left out", () => {
		now = 0;
		const l = log();
		for (const t of [
			"pong",
			"peers",
			"name",
			"followers",
			"view",
			"invite",
			"follow_end",
		]) {
			l.message({ t }, false);
		}
		expect(l.take()).toEqual([]);
	});

	test("a snapshot after a reconnect is a reset of the whole board", () => {
		now = 0;
		const l = log();
		l.message(
			{ t: "snapshot", strokes: [stroke("s1")], background: "dots" },
			false,
		);
		expect(l.take()).toEqual([
			[0, "reset", { strokes: [stroke("s1")], background: "dots" }],
		]);
	});

	test("take empties the log, so each segment holds only what is new", () => {
		now = 0;
		const l = log();
		l.message({ t: "remove", id: "a" }, false);
		expect(l.take()).toHaveLength(1);
		expect(l.take()).toEqual([]);
	});

	test("the view is noted when it changes, not every time it is looked at", () => {
		now = 0;
		const l = log();
		const rect = { minX: 0, minY: 0, maxX: 800, maxY: 600 };
		l.view(rect, { w: 800, h: 600 });
		l.view({ ...rect }, { w: 800, h: 600 }); // the same
		now = 50;
		l.view({ ...rect, minX: 10, maxX: 810 }, { w: 800, h: 600 });
		expect(l.take()).toEqual([
			[0, "v", { minX: 0, minY: 0, maxX: 800, maxY: 600, w: 800, h: 600 }],
			[50, "v", { minX: 10, minY: 0, maxX: 810, maxY: 600, w: 800, h: 600 }],
		]);
	});
});
