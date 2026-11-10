import { type Background, isBackground } from "../board/background";
import type { Board, BoardOp, Point, Stroke } from "../board/board";

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
	/** Clock in ms; tests replace it. */
	now?: () => number;
	/** Called whenever the board or the remote live strokes changed (time to redraw). */
	onUpdate: () => void;
	/** Runs `fn` on the next frame; used to send live strokes at most once per frame. */
	schedule?: (fn: () => void) => void;
}

interface LiveOut {
	stroke: Stroke;
	sent: number;
}

const CURSOR_INTERVAL_MS = 33; // about 30 updates per second
const CURSOR_TTL_MS = 15_000; // a cursor that stopped updating disappears
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 5000;

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
		};
		socket.onmessage = (ev) => this.receive(ev.data);
		socket.onclose = () => this.dropped();
	}

	/** Stops the connection for good. */
	close(): void {
		this.closed = true;
		if (this.timer) clearTimeout(this.timer);
		this.socket?.close();
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
			const { id, name } = p as { id?: unknown; name?: unknown };
			return typeof id === "string" && typeof name === "string"
				? [{ id, name }]
				: [];
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
			this.send({
				t: "live",
				id: stroke.id,
				authorId: stroke.authorId,
				color: stroke.color,
				size: stroke.size,
				z: stroke.z,
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
		if (this.isOpen && this.socket) this.socket.send(JSON.stringify(msg));
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
		switch (m.t) {
			case "background":
				if (isBackground(m.value)) this.opts.onBackground?.(m.value);
				return; // the pattern is not on the canvas
			case "peers":
				if (Array.isArray(m.peers)) this.setPeers(m.peers as unknown[]);
				return;
			case "name":
				if (typeof m.value === "string" && m.value) this.opts.onName?.(m.value);
				return;
			case "snapshot":
				if (isBackground(m.background)) this.opts.onBackground?.(m.background);
				this.board.setStrokes(m.strokes ?? []);
				for (const { op, merged } of this.pending.values()) {
					this.board.applyRemote(op);
					if (merged && op.t === "add")
						this.board.applyRemote({ t: "update", stroke: op.stroke });
					this.send(op);
				}
				break;
			case "add":
				if (!m.stroke) return;
				this.board.applyRemote({ t: "add", stroke: m.stroke });
				this.liveIn.delete(m.stroke.id);
				this.acknowledge("add", m.stroke.id);
				break;
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
				break;
			case "live_drop":
				for (const id of m.ids ?? []) this.liveIn.delete(id);
				break;
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
