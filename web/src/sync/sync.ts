import type { Board, BoardOp, Point, Stroke } from "../board/board";

/** The subset of WebSocket the client uses (lets tests supply a fake). */
export interface SocketLike {
	send(data: string): void;
	close(): void;
	onopen: (() => void) | null;
	onmessage: ((ev: { data: string }) => void) | null;
	onclose: (() => void) | null;
}

interface Options {
	createSocket: () => SocketLike;
	/** Called whenever the board or the remote live strokes changed (time to redraw). */
	onUpdate: () => void;
	/** Runs `fn` on the next frame; used to send live strokes at most once per frame. */
	schedule?: (fn: () => void) => void;
}

interface LiveOut {
	stroke: Stroke;
	sent: number;
}

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 5000;

/**
 * Connects a Board to the server (ADR 0004): sends local operations, applies server
 * messages in server order, keeps unacknowledged operations and re-sends them after
 * a reconnect, and tracks other people's unfinished ("live") strokes.
 */
export class SyncClient {
	private socket: SocketLike | null = null;
	private isOpen = false;
	private closed = false;
	private attempts = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private pending = new Map<string, BoardOp>();
	private liveOut = new Map<string, LiveOut>();
	private liveIn = new Map<string, Stroke>();
	private flushScheduled = false;
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
		const id = op.t === "add" ? op.stroke.id : op.id;
		this.pending.delete(id);
		this.pending.set(id, op);
		if (op.t === "add") this.liveOut.delete(id);
		this.send(op);
	}

	private send(msg: object): void {
		if (this.isOpen && this.socket) this.socket.send(JSON.stringify(msg));
	}

	private receive(data: string): void {
		let m: {
			t: string;
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
			case "snapshot":
				this.board.setStrokes(m.strokes ?? []);
				for (const op of this.pending.values()) {
					this.board.applyRemote(op);
					this.send(op);
				}
				break;
			case "add":
				if (!m.stroke) return;
				this.board.applyRemote({ t: "add", stroke: m.stroke });
				this.liveIn.delete(m.stroke.id);
				this.acknowledge("add", m.stroke.id);
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
	private acknowledge(type: BoardOp["t"], id: string): void {
		if (this.pending.get(id)?.t === type) this.pending.delete(id);
	}

	private dropped(): void {
		this.isOpen = false;
		this.liveIn.clear();
		this.liveOut.clear();
		this.opts.onUpdate();
		if (this.closed) return;
		const delay = Math.min(BASE_DELAY_MS * 2 ** this.attempts, MAX_DELAY_MS);
		this.attempts++;
		this.timer = setTimeout(() => this.connect(), delay);
	}
}
