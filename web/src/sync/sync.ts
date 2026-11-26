import { type Background, isBackground } from "../board/background";
import type { Board, BoardOp, Point, Stroke } from "../board/board";
import type { Rect } from "../board/viewport";

/** The subset of WebSocket the client uses (lets tests supply a fake). */
export interface SocketLike {
	send(data: string): void;
	close(): void;
	onopen: (() => void) | null;
	onmessage: ((ev: { data: string }) => void) | null;
	onclose: (() => void) | null;
}

/** Another person's pointer, in board coordinates. */
/** Someone on the board: a stable id and the name they gave (R-046). */
export interface Peer {
	id: string;
	name: string;
	/** The owner took away this person's right to draw (R-016). */
	muted?: boolean;
	/** The id of the person whose view this one follows (R-093). */
	follows?: string;
	/** The picture of the person's account (R-111). */
	avatar?: string;
	/** This person records the lesson (R-094). */
	recording?: boolean;
	/** Account id when the participant is logged into an Inkroom account (R-123). */
	userId?: number;
	/** True when this participant owns or co-owns this board (R-122, R-123). */
	owner?: boolean;
}

export interface RemoteCursor {
	id: string;
	name: string;
	x: number;
	y: number;
}

interface Options {
	createSocket: () => SocketLike;
	/** Who we are, for the cursor we publish. */
	self?: { authorId: string; name: string };
	/** Called when other people's cursors changed (no need to repaint the board). */
	onCursors?: () => void;
	/** Called with the board's shared background, on joining and whenever the owner changes it. */
	onBackground?: (background: Background) => void;
	/** Called with who is on the board whenever that changes (and with nobody when we lose the connection). */
	onPeers?: (peers: Peer[]) => void;
	/** Called with the board's name whenever the owner renames it (R-045). */
	onName?: (name: string) => void;
	/** Called each time the connection opens, the first time and after every reconnect (R-099). */
	onOpen?: () => void;
	/** Clock in ms; tests replace it. */
	now?: () => number;
	/** Called whenever the board or the remote live strokes changed (time to redraw). */
	onUpdate: () => void;
	/** Called with another person's laser pointer points (R-068); `start` begins a new line. */
	onLaser?: (id: string, points: [number, number][], start: boolean) => void;
	/** Called when only other people's unfinished strokes changed; without it `onUpdate` is called. */
	onLive?: () => void;
	/** Runs `fn` on the next frame; used to send live strokes at most once per frame. */
	schedule?: (fn: () => void) => void;
}

/** What the follow-the-view messages of other people call back (R-093). */
export interface FollowHandlers {
	/** The visible board rectangle of the person we follow. */
	onView?: (id: string, rect: Rect) => void;
	/** The board's owner asks everyone to share their view. */
	onInvite?: (id: string) => void;
	/** How many people follow our view (the server counts them). */
	onFollowers?: (n: number) => void;
	/** The server refused to let us follow this person (it would make a circle, or they left). */
	onRefused?: (id: string) => void;
	/** The person we followed left the board: following has ended. */
	onEnded?: (id: string) => void;
}

interface LiveOut {
	stroke: Stroke;
	sent: number;
}

const CURSOR_INTERVAL_MS = 33; // about 30 updates per second
const VIEW_INTERVAL_MS = 50; // our view goes out about 20 times a second at most (R-093)
const CURSOR_TTL_MS = 15_000; // a cursor that stopped updating disappears
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 5000;
// A connection can die without a word (a tablet that slept, a Wi-Fi that changed): the page then
// shows a stale board until it is reloaded. So a quiet connection is asked whether it is alive.
const BEAT_MS = 5000; // how often the connection is looked at
const PING_AFTER_MS = 20_000; // quiet for this long: ask the server
const DEAD_AFTER_MS = 35_000; // quiet for this long: the connection is given up and opened again
const PROBE_MS = 4000; // after coming back to the page, this long is allowed for an answer

/**
 * Connects a Board to the server (ADR 0004): sends local operations, applies server
 * messages in server order, keeps unacknowledged operations and re-sends them after
 * a reconnect, and tracks other people's unfinished ("live") strokes.
 */
export class SyncClient {
	private socket: SocketLike | null = null;
	private peersIn: Peer[] = [];
	private isOpen = false;
	private closed = false;
	private attempts = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private lastIn = 0; // when anything last came from the server
	private lastPing = Number.NEGATIVE_INFINITY;
	private beat: ReturnType<typeof setInterval> | null = null;
	private probe: ReturnType<typeof setTimeout> | null = null;
	/**
	 * Operations the server has not confirmed yet, by element id. `merged` marks an add that
	 * already carries a later edit (so a re-send creates the element with its latest content).
	 */
	private pending = new Map<string, { op: BoardOp; merged: boolean }>();
	private liveOut = new Map<string, LiveOut>();
	private liveIn = new Map<string, Stroke>();
	private flushScheduled = false;
	private cursorsIn = new Map<string, RemoteCursor & { seen: number }>();
	private cursorOut: { x: number; y: number } | null = null; // latest position not yet sent
	private cursorSent: { x: number; y: number } | null = null;
	private cursorScheduled = false;
	private cursorLastSent = Number.NEGATIVE_INFINITY;
	private laserPending: { points: [number, number][]; start: boolean } | null =
		null;
	private laserScheduled = false;
	private following = ""; // id of the person whose view we follow (R-093)
	private recording = false; // we record the lesson (R-094): told again after a reconnect
	/** Sees every message in and out while a lesson is recorded (R-113); null the rest of the time. */
	private tap:
		| ((m: { t: string } & Record<string, unknown>, outgoing: boolean) => void)
		| null = null;
	private viewOut: Rect | null = null; // our latest view not yet sent
	private viewLastSent = Number.NEGATIVE_INFINITY;
	private viewSent: Rect | null = null; // what we last sent: an unchanged view is not sent again
	private viewTimer: ReturnType<typeof setTimeout> | null = null;
	private followHandlers: FollowHandlers = {};
	private schedule: (fn: () => void) => void;

	constructor(
		private board: Board,
		private opts: Options,
	) {
		this.schedule = opts.schedule ?? ((fn) => requestAnimationFrame(fn));
		board.onOp = (op) => this.local(op);
	}

	/** Opens the connection (and reopens it automatically after a drop). */
	connect(): void {
		const socket = this.opts.createSocket();
		this.socket = socket;
		socket.onopen = () => {
			this.isOpen = true;
			this.attempts = 0;
			this.lastIn = this.now();
			this.startBeat();
			this.opts.onOpen?.();
		};
		socket.onmessage = (ev) => this.receive(ev.data);
		socket.onclose = () => this.dropped();
	}

	/** Stops the connection for good. */
	close(): void {
		this.closed = true;
		if (this.timer) clearTimeout(this.timer);
		this.stopBeat();
		this.socket?.close();
	}

	/**
	 * To be called when the page comes back (visible again, online again): the connection may have
	 * died while nobody looked. It is asked at once and replaced when it does not answer; one that
	 * is waiting to retry is retried now.
	 */
	checkAlive(): void {
		if (this.closed) return;
		if (!this.isOpen) {
			if (this.timer) {
				clearTimeout(this.timer);
				this.timer = null;
				this.attempts = 0;
				this.connect();
			}
			return;
		}
		const asked = this.now();
		this.lastPing = asked;
		this.send({ t: "ping" });
		if (this.probe) clearTimeout(this.probe);
		this.probe = setTimeout(() => {
			if (this.isOpen && this.lastIn < asked) this.lost();
		}, PROBE_MS);
	}

	private startBeat(): void {
		this.stopBeat();
		this.beat = setInterval(() => {
			if (!this.isOpen) return;
			const now = this.now();
			const quiet = now - this.lastIn;
			if (quiet >= DEAD_AFTER_MS) this.lost();
			else if (quiet >= PING_AFTER_MS && now - this.lastPing >= PING_AFTER_MS) {
				this.lastPing = now;
				this.send({ t: "ping" });
			}
		}, BEAT_MS);
	}

	private stopBeat(): void {
		if (this.beat) clearInterval(this.beat);
		if (this.probe) clearTimeout(this.probe);
		this.beat = null;
		this.probe = null;
	}

	/** Gives up a connection that went silent; a dead one may take minutes to report its end. */
	private lost(): void {
		const socket = this.socket;
		if (!socket) return;
		socket.onopen = null;
		socket.onmessage = null;
		socket.onclose = null;
		socket.close();
		this.dropped();
	}

	/** Reports our pointer position (board coordinates); sent at most about 30 times a second. */
	cursorMove(x: number, y: number): void {
		this.cursorOut = { x, y };
		this.scheduleCursor();
	}

	/** Tells the others to hide our cursor (the pointer left the board). */
	cursorHide(): void {
		this.cursorOut = null;
		if (!this.cursorSent) return;
		this.cursorSent = null;
		this.send({
			t: "cursor",
			id: this.opts.self?.authorId ?? "",
			hidden: true,
		});
	}

	/** The owner gives (draw true) or takes away a person's right to draw; others are ignored by the server (R-016). */
	setDrawing(id: string, draw: boolean): void {
		this.send({ t: "perm", id, draw });
	}

	/** Who is on the board, as the server last told us. */
	peers(): Peer[] {
		return this.peersIn;
	}

	/** Other people's cursors that updated recently. */
	cursors(): RemoteCursor[] {
		const cutoff = this.now() - CURSOR_TTL_MS;
		for (const [id, c] of this.cursorsIn)
			if (c.seen < cutoff) this.cursorsIn.delete(id);
		return [...this.cursorsIn.values()].map(({ id, name, x, y }) => ({
			id,
			name,
			x,
			y,
		}));
	}

	/** Keeps the entries that are a person (a text id and a text name) and reports the list. */
	private setPeers(raw: unknown[]): void {
		this.peersIn = raw.flatMap((p) => {
			if (typeof p !== "object" || p === null) return [];
			const { id, name, muted, follows, avatar, recording, userId, owner } =
				p as {
					id?: unknown;
					name?: unknown;
					muted?: unknown;
					follows?: unknown;
					avatar?: unknown;
					recording?: unknown;
					userId?: unknown;
					owner?: unknown;
				};
			if (typeof id !== "string" || typeof name !== "string") return [];
			return [
				{
					id,
					name,
					...(muted === true ? { muted } : {}),
					...(typeof follows === "string" && follows ? { follows } : {}),
					...(typeof avatar === "string" && avatar ? { avatar } : {}),
					...(recording === true ? { recording } : {}),
					...(typeof userId === "number" && userId > 0 ? { userId } : {}),
					...(owner === true ? { owner } : {}),
				},
			];
		});
		this.opts.onPeers?.(this.peersIn);
	}

	private now(): number {
		return this.opts.now?.() ?? Date.now();
	}

	private scheduleCursor(): void {
		if (this.cursorScheduled) return;
		this.cursorScheduled = true;
		this.schedule(() => this.flushCursor());
	}

	private flushCursor(): void {
		this.cursorScheduled = false;
		const pos = this.cursorOut;
		if (
			!pos ||
			(this.cursorSent &&
				pos.x === this.cursorSent.x &&
				pos.y === this.cursorSent.y)
		)
			return;
		if (this.now() - this.cursorLastSent < CURSOR_INTERVAL_MS) {
			this.scheduleCursor(); // too soon, try again next frame
			return;
		}
		if (!this.isOpen || !this.opts.self) return;
		this.send({
			t: "cursor",
			id: this.opts.self.authorId,
			name: this.opts.self.name,
			x: pos.x,
			y: pos.y,
		});
		this.cursorSent = pos;
		this.cursorOut = null;
		this.cursorLastSent = this.now();
	}

	/** Reports a point of our laser pointer; the points of a frame go out together. */
	laserMove(x: number, y: number, start: boolean): void {
		if (start && this.laserPending) this.flushLaser(); // a new line does not join the last
		if (!this.laserPending) this.laserPending = { points: [], start };
		this.laserPending.points.push([x, y]);
		if (this.laserScheduled) return;
		this.laserScheduled = true;
		this.schedule(() => {
			this.laserScheduled = false;
			this.flushLaser();
		});
	}

	private flushLaser(): void {
		const p = this.laserPending;
		this.laserPending = null;
		if (!p || p.points.length === 0 || !this.isOpen) return;
		this.send({
			t: "laser",
			id: this.opts.self?.authorId ?? "",
			start: p.start,
			points: p.points,
		});
	}

	/**
	 * Lets `fn` see every message that comes from the server and every one we send, for the event
	 * log of a recorded lesson (R-113); null stops it. Costs nothing while it is not set.
	 */
	setTap(
		fn:
			| ((
					m: { t: string } & Record<string, unknown>,
					outgoing: boolean,
			  ) => void)
			| null,
	): void {
		this.tap = fn;
	}

	/** Tells everyone whether we record the lesson now, for their red dot (R-094). */
	setRecording(on: boolean): void {
		this.recording = on;
		this.send({ t: "recording", on });
	}

	/** Starts following the view of the person with this id; an empty id stops (R-093). */
	follow(id: string): void {
		this.following = id;
		this.send({ t: "follow", id });
	}

	/**
	 * Reports the board rectangle we look at; sent at most about 20 times a second, and not again
	 * while it does not change unless `force` (R-093).
	 */
	sendView(rect: Rect, force = false): void {
		if (force) this.viewSent = null; // a new follower has not seen it yet
		this.viewOut = rect;
		const wait = VIEW_INTERVAL_MS - (this.now() - this.viewLastSent);
		if (wait <= 0) {
			this.flushView();
		} else if (!this.viewTimer) {
			this.viewTimer = setTimeout(() => this.flushView(), wait);
		}
	}

	private flushView(): void {
		if (this.viewTimer) clearTimeout(this.viewTimer);
		this.viewTimer = null;
		const r = this.viewOut;
		this.viewOut = null;
		const s = this.viewSent;
		if (
			!r ||
			!this.isOpen ||
			(s &&
				Math.abs(s.minX - r.minX) < 0.5 &&
				Math.abs(s.minY - r.minY) < 0.5 &&
				Math.abs(s.maxX - r.maxX) < 0.5 &&
				Math.abs(s.maxY - r.maxY) < 0.5)
		)
			return;
		this.viewSent = r;
		this.viewLastSent = this.now();
		this.send({
			t: "view",
			id: this.opts.self?.authorId ?? "",
			minX: r.minX,
			minY: r.minY,
			maxX: r.maxX,
			maxY: r.maxY,
		});
	}

	/** Asks everyone on the board to join our view (the board's owner only; the server checks). */
	invite(): void {
		this.send({ t: "invite", id: this.opts.self?.authorId ?? "" });
	}

	/** Sets what the follow-the-view messages call back. */
	setFollowHandlers(h: FollowHandlers): void {
		this.followHandlers = h;
	}

	/** Other people's unfinished strokes, to be drawn on the live layer. */
	liveStrokes(): Stroke[] {
		return [...this.liveIn.values()];
	}

	/** Reports progress of our own unfinished stroke; new points go out at most once per frame. */
	liveUpdate(stroke: Stroke): void {
		if (!this.liveOut.has(stroke.id))
			this.liveOut.set(stroke.id, { stroke, sent: 0 });
		if (this.flushScheduled) return;
		this.flushScheduled = true;
		this.schedule(() => this.flushLive());
	}

	private flushLive(): void {
		this.flushScheduled = false;
		for (const entry of this.liveOut.values()) {
			const { stroke } = entry;
			if (stroke.points.length <= entry.sent) continue;
			// Style fields go with the first chunk only; the receiver keeps them (R-089).
			const style =
				entry.sent === 0
					? {
							...(stroke.dash ? { dash: stroke.dash } : {}),
							...(stroke.opacity !== undefined
								? { opacity: stroke.opacity }
								: {}),
						}
					: {};
			this.send({
				t: "live",
				id: stroke.id,
				authorId: stroke.authorId,
				color: stroke.color,
				size: stroke.size,
				z: stroke.z,
				...style,
				points: stroke.points.slice(entry.sent),
			});
			entry.sent = stroke.points.length;
		}
	}

	private local(op: BoardOp): void {
		const id = op.t === "remove" ? op.id : op.stroke.id;
		const prev = this.pending.get(id);
		// An edit of an element the server may not know yet must not turn into a lone update.
		const merged = op.t === "update" && prev?.op.t === "add";
		this.pending.delete(id);
		this.pending.set(
			id,
			merged
				? { op: { t: "add", stroke: op.stroke }, merged: true }
				: { op, merged: false },
		);
		if (op.t === "add") this.liveOut.delete(id);
		this.send(op);
	}

	private send(msg: object): void {
		if (!this.isOpen || !this.socket) return;
		this.socket.send(JSON.stringify(msg));
		this.tap?.(msg as { t: string } & Record<string, unknown>, true);
	}

	private receive(data: string): void {
		let m: {
			name?: string;
			x?: number;
			y?: number;
			hidden?: boolean;
			t: string;
			background?: unknown;
			peers?: unknown;
			value?: unknown;
			strokes?: Stroke[];
			stroke?: Stroke;
			id?: string;
			ids?: string[];
			points?: Point[];
		} & Partial<Stroke>;
		try {
			m = JSON.parse(data);
		} catch {
			return;
		}
		this.lastIn = this.now();
		this.tap?.(m as unknown as { t: string } & Record<string, unknown>, false);
		switch (m.t) {
			case "background":
				if (isBackground(m.value)) this.opts.onBackground?.(m.value);
				return; // the pattern is not on the canvas
			case "pong":
				return; // only proof that the connection is alive (lastIn is already set)
			case "peers":
				if (Array.isArray(m.peers)) this.setPeers(m.peers as unknown[]);
				return;
			case "name":
				if (typeof m.value === "string" && m.value) this.opts.onName?.(m.value);
				return;
			case "snapshot":
				if (isBackground(m.background)) this.opts.onBackground?.(m.background);
				this.board.setStrokes(m.strokes ?? []);
				if (this.following) this.send({ t: "follow", id: this.following });
				if (this.recording) this.send({ t: "recording", on: true });
				for (const { op, merged } of this.pending.values()) {
					this.board.applyRemote(op);
					if (merged && op.t === "add")
						this.board.applyRemote({ t: "update", stroke: op.stroke });
					this.send(op);
				}
				break;
			case "add": {
				if (!m.stroke) return;
				const added = this.board.applyRemote({ t: "add", stroke: m.stroke });
				this.liveIn.delete(m.stroke.id);
				this.acknowledge("add", m.stroke.id);
				if (!added) return; // the echo of our own: it is on the board already, nothing to draw
				break;
			}
			case "update":
				if (!m.stroke) return;
				this.board.applyRemote({ t: "update", stroke: m.stroke });
				this.acknowledge("update", m.stroke.id, m.stroke);
				break;
			case "remove":
				if (!m.id) return;
				this.board.applyRemote({ t: "remove", id: m.id });
				this.acknowledge("remove", m.id);
				break;
			case "live":
				this.addLive(m);
				(this.opts.onLive ?? this.opts.onUpdate)();
				return; // the board itself did not change
			case "live_drop":
				for (const id of m.ids ?? []) this.liveIn.delete(id);
				(this.opts.onLive ?? this.opts.onUpdate)();
				return;
			case "cursor":
				if (!m.id) return;
				if (m.hidden) {
					this.cursorsIn.delete(m.id);
				} else if (typeof m.x === "number" && typeof m.y === "number") {
					this.cursorsIn.set(m.id, {
						id: m.id,
						name: m.name ?? "",
						x: m.x,
						y: m.y,
						seen: this.now(),
					});
				}
				this.opts.onCursors?.();
				return; // cursors never repaint the board
			case "laser":
				if (typeof m.id !== "string" || !m.id || !Array.isArray(m.points))
					return;
				this.opts.onLaser?.(
					m.id,
					(m.points as unknown[]).filter(
						(p): p is [number, number] =>
							Array.isArray(p) &&
							typeof p[0] === "number" &&
							typeof p[1] === "number",
					),
					(m as { start?: boolean }).start === true,
				);
				return; // a pointer, not the board
			case "view": {
				const r = m as unknown as Rect & { id?: unknown };
				if (
					typeof r.id !== "string" ||
					![r.minX, r.minY, r.maxX, r.maxY].every(Number.isFinite) ||
					r.maxX <= r.minX ||
					r.maxY <= r.minY
				)
					return;
				this.followHandlers.onView?.(r.id, {
					minX: r.minX,
					minY: r.minY,
					maxX: r.maxX,
					maxY: r.maxY,
				});
				return; // a view, not the board
			}
			case "follow_refused":
			case "follow_end":
				if (typeof m.id === "string" && m.id) {
					this.following = ""; // not to be asked for again after a reconnect
					if (m.t === "follow_end") this.followHandlers.onEnded?.(m.id);
					else this.followHandlers.onRefused?.(m.id);
				}
				return;
			case "invite":
				if (typeof m.id === "string" && m.id)
					this.followHandlers.onInvite?.(m.id);
				return;
			case "followers": {
				const n = (m as unknown as { n?: unknown }).n;
				if (typeof n === "number") this.followHandlers.onFollowers?.(n);
				return;
			}
			case "cursor_drop":
				for (const id of m.ids ?? []) this.cursorsIn.delete(id);
				this.opts.onCursors?.();
				return;
			default:
				return;
		}
		this.opts.onUpdate();
	}

	private addLive(m: Partial<Stroke> & { points?: Point[] }): void {
		if (!m.id || !m.points) return;
		const existing = this.liveIn.get(m.id);
		if (existing) {
			existing.points.push(...m.points);
		} else {
			this.liveIn.set(m.id, {
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
	}

	/** The server echoed an operation of ours: it no longer needs re-sending. */
	private acknowledge(type: BoardOp["t"], id: string, stroke?: Stroke): void {
		const entry = this.pending.get(id);
		if (!entry || entry.op.t !== type) return;
		if (type === "add" && entry.merged && entry.op.t === "add") {
			// Only the add came back; the edit made after it is still in flight.
			entry.op = { t: "update", stroke: entry.op.stroke };
			entry.merged = false;
		} else if (
			type === "update" &&
			stroke &&
			entry.op.t === "update" &&
			JSON.stringify(entry.op.stroke) !== JSON.stringify(stroke)
		) {
			// A newer edit of ours is still waiting for its own echo.
		} else {
			this.pending.delete(id);
		}
	}

	private dropped(): void {
		this.isOpen = false;
		this.stopBeat();
		this.viewSent = null; // after a reconnect the followers need our view again
		this.setPeers([]); // the server lists everyone again when we are back
		this.cursorSent = null;
		this.cursorsIn.clear();
		this.opts.onCursors?.();
		this.liveIn.clear();
		this.liveOut.clear();
		this.opts.onUpdate();
		if (this.closed) return;
		const delay = Math.min(BASE_DELAY_MS * 2 ** this.attempts, MAX_DELAY_MS);
		this.attempts++;
		this.timer = setTimeout(() => this.connect(), delay);
	}
}
