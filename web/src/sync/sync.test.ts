import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Board, type Stroke } from "../board/board";
import { type SocketLike, SyncClient } from "./sync";

class FakeSocket implements SocketLike {
	sent: Record<string, unknown>[] = [];
	closed = false;
	onopen: (() => void) | null = null;
	onmessage: ((ev: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	send(data: string) {
		this.sent.push(JSON.parse(data));
	}
	close() {
		this.closed = true;
	}
	open() {
		this.onopen?.();
	}
	receive(msg: object) {
		this.onmessage?.({ data: JSON.stringify(msg) });
	}
	drop() {
		this.onclose?.();
	}
}

function stroke(id: string, z = Number(id), authorId = "me"): Stroke {
	return { id, authorId, color: "#111", size: 4, z, points: [[0, 0, 0.5]] };
}

describe("SyncClient", () => {
	let board: Board;
	let sockets: FakeSocket[];
	let onUpdate: () => void;
	let client: SyncClient;
	let flush: () => void;
	let onCursors: () => void;
	let clock: number;

	const sock = () => sockets[sockets.length - 1];
	const connectAndJoin = (strokes: Stroke[] = []) => {
		sock().open();
		sock().receive({ t: "snapshot", strokes });
	};

	beforeEach(() => {
		vi.useFakeTimers();
		board = new Board();
		sockets = [];
		onUpdate = vi.fn();
		onCursors = vi.fn();
		clock = 1_000_000;
		let scheduled: (() => void) | null = null;
		flush = () => {
			const f = scheduled;
			scheduled = null;
			f?.();
		};
		client = new SyncClient(board, {
			createSocket: () => {
				const s = new FakeSocket();
				sockets.push(s);
				return s;
			},
			onUpdate,
			onCursors,
			self: { authorId: "me", name: "Ola" },
			now: () => clock,
			schedule: (f) => {
				scheduled = f;
			},
		});
		client.connect();
	});

	afterEach(() => vi.useRealTimers());

	describe("the laser pointer", () => {
		const lasersSent = () => sock().sent.filter((m) => m.t === "laser");

		test("points of one frame go out together, the first of a stroke marked as its start", () => {
			connectAndJoin();
			client.laserMove(1, 2, true);
			client.laserMove(3, 4, false);
			client.laserMove(5, 6, false);
			expect(lasersSent()).toHaveLength(0); // not before the frame
			flush();
			expect(lasersSent()).toEqual([
				{
					t: "laser",
					id: "me",
					start: true,
					points: [
						[1, 2],
						[3, 4],
						[5, 6],
					],
				},
			]);
			client.laserMove(7, 8, false);
			flush();
			expect(lasersSent()[1]).toMatchObject({ start: false, points: [[7, 8]] });
		});

		test("a new stroke inside one frame does not run into the previous one", () => {
			connectAndJoin();
			client.laserMove(1, 1, true);
			client.laserMove(9, 9, true);
			flush();
			expect(lasersSent()).toHaveLength(2);
			expect(lasersSent()[1]).toMatchObject({ start: true, points: [[9, 9]] });
		});

		test("nothing is sent while the connection is down", () => {
			client.laserMove(1, 1, true);
			flush();
			expect(lasersSent()).toHaveLength(0);
		});

		test("the laser of another person is passed on, and the board is not repainted for it", () => {
			const onLaser = vi.fn();
			const c = new SyncClient(board, {
				createSocket: () => {
					const s = new FakeSocket();
					sockets.push(s);
					return s;
				},
				onUpdate,
				onLaser,
				self: { authorId: "me", name: "Ola" },
			});
			c.connect();
			sock().open();
			sock().receive({ t: "snapshot", strokes: [] });
			const before = (onUpdate as ReturnType<typeof vi.fn>).mock.calls.length;
			sock().receive({
				t: "laser",
				id: "ann",
				start: true,
				points: [
					[1, 2],
					[3, 4],
				],
			});
			expect(onLaser).toHaveBeenCalledWith(
				"ann",
				[
					[1, 2],
					[3, 4],
				],
				true,
			);
			expect((onUpdate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
				before,
			);
		});

		test("a broken laser message is ignored", () => {
			const onLaser = vi.fn();
			const c = new SyncClient(board, {
				createSocket: () => {
					const s = new FakeSocket();
					sockets.push(s);
					return s;
				},
				onUpdate,
				onLaser,
			});
			c.connect();
			sock().open();
			sock().receive({ t: "laser", id: "x", points: "no" });
			sock().receive({ t: "laser", points: [[1, 2]] });
			expect(onLaser).not.toHaveBeenCalled();
		});
	});

	test("local operations are sent while connected", () => {
		connectAndJoin();
		const s = stroke("1");
		board.addStroke(s);
		board.eraseStroke("me", "1");
		expect(sock().sent).toEqual([
			{ t: "add", stroke: s },
			{ t: "remove", id: "1" },
		]);
	});

	test("remote operations are applied to the board and reported", () => {
		connectAndJoin();
		sock().receive({ t: "add", stroke: stroke("2", 2, "other") });
		expect(board.strokes.map((s) => s.id)).toEqual(["2"]);
		sock().receive({ t: "remove", id: "2" });
		expect(board.strokes).toEqual([]);
		expect(onUpdate).toHaveBeenCalledTimes(3); // snapshot + add + remove
	});

	test("a snapshot replaces the board content", () => {
		sock().open();
		board.addStroke(stroke("9"));
		sock().receive({ t: "snapshot", strokes: [stroke("1"), stroke("2")] });
		expect(board.strokes.map((s) => s.id)).toEqual(["1", "2", "9"]); // 9 is still pending
	});

	test("the server echo of our own operation is harmless and clears it from the pending set", () => {
		connectAndJoin();
		board.addStroke(stroke("1"));
		sock().receive({ t: "add", stroke: stroke("1") });
		expect(board.strokes).toHaveLength(1);
		sock().drop();
		vi.advanceTimersByTime(10_000);
		sock().open();
		sock().receive({ t: "snapshot", strokes: [stroke("1")] });
		expect(sock().sent).toEqual([]); // nothing re-sent
	});

	test("the echo of an element we already have does not repaint the board", () => {
		connectAndJoin();
		board.addStroke(stroke("1")); // a paste of hundreds: each comes back from the server
		const before = (onUpdate as ReturnType<typeof vi.fn>).mock.calls.length;
		sock().receive({ t: "add", stroke: stroke("1") });
		expect((onUpdate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
			before,
		);
		sock().receive({ t: "add", stroke: stroke("9", 2, "other") }); // something new does
		expect((onUpdate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
			before + 1,
		);
	});

	test("operations made offline are sent after the next snapshot", () => {
		connectAndJoin();
		sock().drop();
		board.addStroke(stroke("5"));
		expect(sock().sent).toEqual([]);
		vi.advanceTimersByTime(10_000);
		expect(sockets).toHaveLength(2);
		sock().open();
		expect(sock().sent).toEqual([]); // wait for the snapshot first
		sock().receive({ t: "snapshot", strokes: [] });
		expect(sock().sent).toEqual([{ t: "add", stroke: stroke("5") }]);
		expect(board.strokes.map((s) => s.id)).toEqual(["5"]);
	});

	test("unacknowledged operations are re-sent after reconnecting", () => {
		connectAndJoin();
		board.addStroke(stroke("1"));
		sock().drop();
		vi.advanceTimersByTime(10_000);
		sock().open();
		sock().receive({ t: "snapshot", strokes: [] });
		expect(sock().sent).toEqual([{ t: "add", stroke: stroke("1") }]);
	});

	test("reconnect backs off and resets after a successful connection", () => {
		sock().drop();
		vi.advanceTimersByTime(499);
		expect(sockets).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(sockets).toHaveLength(2);
		sock().drop();
		vi.advanceTimersByTime(999);
		expect(sockets).toHaveLength(2);
		vi.advanceTimersByTime(1);
		expect(sockets).toHaveLength(3);
		sock().open();
		sock().drop();
		vi.advanceTimersByTime(500);
		expect(sockets).toHaveLength(4);
	});

	test("close() stops reconnecting", () => {
		client.close();
		sock().drop();
		vi.advanceTimersByTime(60_000);
		expect(sockets).toHaveLength(1);
		expect(sock().closed).toBe(true);
	});

	describe("live strokes", () => {
		test("liveUpdate sends only the new points, once per scheduled flush", () => {
			connectAndJoin();
			const s = stroke("7");
			s.points = [[0, 0, 0.5]];
			client.liveUpdate(s);
			s.points.push([1, 1, 0.5]);
			client.liveUpdate(s);
			flush();
			s.points.push([2, 2, 0.5]);
			client.liveUpdate(s);
			flush();
			const live = sock().sent.filter((m) => m.t === "live");
			expect(live).toHaveLength(2);
			expect((live[0].points as unknown[]).length).toBe(2);
			expect((live[1].points as unknown[]).length).toBe(1);
			expect(live[0]).toMatchObject({
				id: "7",
				authorId: "me",
				color: "#111",
				size: 4,
				z: 7,
			});
		});

		test("remote live chunks accumulate into one stroke", () => {
			connectAndJoin();
			const base = {
				t: "live",
				id: "x",
				authorId: "o",
				color: "#c00",
				size: 5,
				z: 3,
			};
			sock().receive({ ...base, points: [[0, 0, 0.5]] });
			sock().receive({ ...base, points: [[1, 1, 0.5]] });
			const live = client.liveStrokes();
			expect(live).toHaveLength(1);
			expect(live[0].points).toHaveLength(2);
			expect(live[0].color).toBe("#c00");
		});

		test("a finished stroke (add) or live_drop removes the live version", () => {
			connectAndJoin();
			const base = {
				t: "live",
				authorId: "o",
				color: "#c00",
				size: 5,
				z: 3,
				points: [[0, 0, 0.5]],
			};
			sock().receive({ ...base, id: "x" });
			sock().receive({ ...base, id: "y" });
			sock().receive({ t: "add", stroke: stroke("x", 3, "o") });
			expect(client.liveStrokes().map((s) => s.id)).toEqual(["y"]);
			sock().receive({ t: "live_drop", ids: ["y"] });
			expect(client.liveStrokes()).toEqual([]);
		});

		test("live strokes are forgotten when the connection drops", () => {
			connectAndJoin();
			sock().receive({
				t: "live",
				id: "x",
				authorId: "o",
				color: "#c00",
				size: 5,
				z: 3,
				points: [[0, 0, 0.5]],
			});
			sock().drop();
			expect(client.liveStrokes()).toEqual([]);
		});
	});

	describe("cursors", () => {
		const cursorsSent = () => sock().sent.filter((m) => m.t === "cursor");

		test("our pointer position goes out with our id and name", () => {
			connectAndJoin();
			client.cursorMove(12.5, 40);
			flush();
			expect(cursorsSent()).toEqual([
				{ t: "cursor", id: "me", name: "Ola", x: 12.5, y: 40 },
			]);
		});

		test("only the latest position is sent per flush, and an unchanged one is not repeated", () => {
			connectAndJoin();
			client.cursorMove(1, 1);
			client.cursorMove(2, 2);
			client.cursorMove(3, 3);
			flush();
			expect(cursorsSent()).toHaveLength(1);
			expect(cursorsSent()[0]).toMatchObject({ x: 3, y: 3 });
			clock += 100;
			client.cursorMove(3, 3);
			flush();
			expect(cursorsSent()).toHaveLength(1);
		});

		test("sending is rate limited to about 30 per second", () => {
			connectAndJoin();
			client.cursorMove(1, 1);
			flush();
			clock += 10;
			client.cursorMove(2, 2);
			flush(); // too soon: held back, rescheduled
			expect(cursorsSent()).toHaveLength(1);
			clock += 40;
			flush();
			expect(cursorsSent()).toHaveLength(2);
			expect(cursorsSent()[1]).toMatchObject({ x: 2, y: 2 });
		});

		test("cursorHide tells the others to hide us, once", () => {
			connectAndJoin();
			client.cursorMove(1, 1);
			flush();
			client.cursorHide();
			client.cursorHide();
			expect(cursorsSent().filter((m) => m.hidden)).toEqual([
				{ t: "cursor", id: "me", hidden: true },
			]);
		});

		test("nothing is sent while disconnected", () => {
			client.cursorMove(1, 1);
			flush();
			expect(cursorsSent()).toEqual([]);
		});

		test("other people's cursors are tracked and reported", () => {
			connectAndJoin();
			sock().receive({ t: "cursor", id: "b", name: "Kuba", x: 5, y: 6 });
			expect(client.cursors()).toEqual([{ id: "b", name: "Kuba", x: 5, y: 6 }]);
			expect(onCursors).toHaveBeenCalled();
		});

		test("a cursor message does not repaint the board", () => {
			connectAndJoin();
			const before = (onUpdate as ReturnType<typeof vi.fn>).mock.calls.length;
			sock().receive({ t: "cursor", id: "b", name: "Kuba", x: 5, y: 6 });
			expect((onUpdate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
				before,
			);
		});

		test("a newer position replaces the older one", () => {
			connectAndJoin();
			sock().receive({ t: "cursor", id: "b", name: "Kuba", x: 5, y: 6 });
			sock().receive({ t: "cursor", id: "b", name: "Kuba", x: 50, y: 60 });
			expect(client.cursors()).toEqual([
				{ id: "b", name: "Kuba", x: 50, y: 60 },
			]);
		});

		test("hidden and cursor_drop remove cursors", () => {
			connectAndJoin();
			sock().receive({ t: "cursor", id: "b", name: "Kuba", x: 1, y: 1 });
			sock().receive({ t: "cursor", id: "c", name: "Ewa", x: 2, y: 2 });
			sock().receive({ t: "cursor", id: "b", hidden: true });
			expect(client.cursors().map((c) => c.id)).toEqual(["c"]);
			sock().receive({ t: "cursor_drop", ids: ["c"] });
			expect(client.cursors()).toEqual([]);
		});

		test("a cursor that stopped updating expires after 15 seconds", () => {
			connectAndJoin();
			sock().receive({ t: "cursor", id: "b", name: "Kuba", x: 1, y: 1 });
			clock += 14_000;
			expect(client.cursors()).toHaveLength(1);
			clock += 2_000;
			expect(client.cursors()).toEqual([]);
		});

		test("cursors are forgotten when the connection drops", () => {
			connectAndJoin();
			sock().receive({ t: "cursor", id: "b", name: "Kuba", x: 1, y: 1 });
			sock().drop();
			expect(client.cursors()).toEqual([]);
		});
	});

	describe("updates", () => {
		const moved = (id: string): Stroke => ({
			...stroke(id),
			points: [[7, 7, 0.5]],
		});

		test("a local update is sent after the add", () => {
			connectAndJoin();
			board.addStroke(stroke("1"));
			board.updateElement("me", moved("1"));
			expect(sock().sent).toEqual([
				{ t: "add", stroke: stroke("1") },
				{ t: "update", stroke: moved("1") },
			]);
		});

		test("a remote update replaces the element and repaints", () => {
			connectAndJoin([stroke("1")]);
			sock().receive({ t: "update", stroke: moved("1") });
			expect(board.strokes[0].points[0]).toEqual([7, 7, 0.5]);
			expect(onUpdate).toHaveBeenCalled();
		});

		test("the echo of our own update clears it, so it is not re-sent", () => {
			connectAndJoin();
			board.addStroke(stroke("1"));
			board.updateElement("me", moved("1"));
			sock().receive({ t: "add", stroke: stroke("1") });
			sock().receive({ t: "update", stroke: moved("1") });
			sock().drop();
			vi.advanceTimersByTime(10_000);
			sock().open();
			sock().receive({ t: "snapshot", strokes: [moved("1")] });
			expect(sock().sent).toEqual([]);
		});

		test("an update the server never confirmed is re-sent after reconnecting", () => {
			connectAndJoin([stroke("1")]);
			board.updateElement("me", moved("1"));
			sock().drop();
			vi.advanceTimersByTime(10_000);
			sock().open();
			sock().receive({ t: "snapshot", strokes: [stroke("1")] });
			expect(sock().sent).toEqual([{ t: "update", stroke: moved("1") }]);
			expect(board.strokes[0].points[0]).toEqual([7, 7, 0.5]);
		});

		test("an element added and edited while offline is re-sent as one add with the latest content", () => {
			connectAndJoin();
			sock().drop();
			board.addStroke(stroke("1"));
			board.updateElement("me", moved("1"));
			vi.advanceTimersByTime(10_000);
			sock().open();
			sock().receive({ t: "snapshot", strokes: [] });
			expect(sock().sent).toEqual([{ t: "add", stroke: moved("1") }]);
		});

		test("the add being confirmed does not forget an update still in flight", () => {
			connectAndJoin();
			board.addStroke(stroke("1"));
			board.updateElement("me", moved("1"));
			sock().receive({ t: "add", stroke: stroke("1") }); // only the add came back so far
			sock().drop();
			vi.advanceTimersByTime(10_000);
			sock().open();
			sock().receive({ t: "snapshot", strokes: [stroke("1")] });
			expect(sock().sent).toEqual([{ t: "update", stroke: moved("1") }]);
		});
	});

	describe("board background", () => {
		test("the snapshot and later changes report the background without repainting twice", () => {
			const onBackground = vi.fn();
			const b = new Board();
			const socket = new FakeSocket();
			const update = vi.fn();
			const c = new SyncClient(b, {
				createSocket: () => socket,
				onUpdate: update,
				onBackground,
			});
			c.connect();
			socket.open();
			socket.receive({ t: "snapshot", strokes: [], background: "grid" });
			expect(onBackground).toHaveBeenLastCalledWith("grid");
			update.mockClear();
			socket.receive({ t: "background", value: "dots" });
			expect(onBackground).toHaveBeenLastCalledWith("dots");
			expect(update).not.toHaveBeenCalled();
			socket.receive({ t: "background", value: "stars" });
			expect(onBackground).toHaveBeenCalledTimes(2);
			c.close();
		});
	});

	describe("who is on the board and its name (R-045, R-046)", () => {
		const connected = (extra: Record<string, unknown> = {}) => {
			const socket = new FakeSocket();
			const update = vi.fn();
			const c = new SyncClient(new Board(), {
				createSocket: () => socket,
				onUpdate: update,
				...extra,
			});
			c.connect();
			socket.open();
			return { socket, update, c };
		};

		test("the list of people is reported as it arrives, without repainting the board", () => {
			const onPeers = vi.fn();
			const { socket, update, c } = connected({ onPeers });
			socket.receive({ t: "snapshot", strokes: [] });
			update.mockClear();
			socket.receive({
				t: "peers",
				peers: [
					{ id: "a1", name: "Ann" },
					{ id: "b1", name: "Bob" },
				],
			});
			expect(onPeers).toHaveBeenLastCalledWith([
				{ id: "a1", name: "Ann" },
				{ id: "b1", name: "Bob" },
			]);
			expect(c.peers()).toEqual([
				{ id: "a1", name: "Ann" },
				{ id: "b1", name: "Bob" },
			]);
			expect(update).not.toHaveBeenCalled();
			c.close();
		});

		test("a person who may not draw is marked", () => {
			const { socket, c } = connected();
			socket.receive({
				t: "peers",
				peers: [
					{ id: "a1", name: "Ann", muted: true },
					{ id: "b1", name: "Bob" },
				],
			});
			expect(c.peers()).toEqual([
				{ id: "a1", name: "Ann", muted: true },
				{ id: "b1", name: "Bob" },
			]);
			c.close();
		});

		test("the owner can take away and give back drawing by sending a perm", () => {
			const { socket, c } = connected();
			socket.open();
			c.setDrawing("a1", false);
			c.setDrawing("a1", true);
			expect(socket.sent.slice(-2)).toEqual([
				{ t: "perm", id: "a1", draw: false },
				{ t: "perm", id: "a1", draw: true },
			]);
			c.close();
		});

		test("entries that are not a person are skipped", () => {
			const onPeers = vi.fn();
			const { socket, c } = connected({ onPeers });
			socket.receive({
				t: "peers",
				peers: [
					{ id: "a1", name: "Ann" },
					{ id: 3 },
					"x",
					null,
					{ name: "no id" },
				],
			});
			expect(onPeers).toHaveBeenLastCalledWith([{ id: "a1", name: "Ann" }]);
			socket.receive({ t: "peers", peers: "nope" });
			expect(onPeers).toHaveBeenCalledTimes(1);
			c.close();
		});

		test("when the connection drops nobody is shown as here until the server says so again", () => {
			const onPeers = vi.fn();
			const { socket, c } = connected({ onPeers });
			socket.receive({ t: "peers", peers: [{ id: "a1", name: "Ann" }] });
			socket.drop();
			expect(onPeers).toHaveBeenLastCalledWith([]);
			expect(c.peers()).toEqual([]);
			c.close();
		});

		test("a new name of the board is reported, only a real text", () => {
			const onName = vi.fn();
			const { socket, update, c } = connected({ onName });
			socket.receive({ t: "name", value: "Lekcja 5" });
			expect(onName).toHaveBeenLastCalledWith("Lekcja 5");
			expect(update).not.toHaveBeenCalled();
			socket.receive({ t: "name", value: 7 });
			socket.receive({ t: "name", value: "" });
			expect(onName).toHaveBeenCalledTimes(1);
			c.close();
		});
	});
});
