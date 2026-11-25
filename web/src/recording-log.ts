import type { Rect } from "./board/viewport";

// The event log of a recorded lesson (R-113, ADR 0028): what happened on the board, each event with
// the milliseconds since the recording began. The player (R-114) applies them again in order.

/** The version of the log's format, kept in the starting state so a player can read old ones. */
export const LOG_VERSION = 1;

/** One entry: [ms since the start, type, data]. */
export type LogEvent = [number, string] | [number, string, unknown];

/** A message of the sync client: what came from the server, or what we sent. */
export type SyncMessage = { t: string } & Record<string, unknown>;

/** The board's elements as the server sends them: kept as they are in the log. */
const FROM_SERVER: Record<string, string> = {
	add: "a",
	update: "u",
	remove: "r",
	live: "l",
	live_drop: "ld",
	cursor: "c",
	cursor_drop: "cd",
	laser: "z",
	background: "bg",
	snapshot: "reset",
};

/** What we send that the server does not send back to us (it sends back our own add, update, remove). */
const OUR_OWN = new Set(["live", "cursor", "laser"]);

export class EventLog {
	private events: LogEvent[] = [];
	private t0: number;
	private lastView = "";

	/** `clock` gives milliseconds; the log begins now. */
	constructor(private clock: () => number) {
		this.t0 = clock();
	}

	private at(): number {
		return Math.round(this.clock() - this.t0);
	}

	/** Notes a message of the sync client; `outgoing` is true for what we sent. */
	message(m: SyncMessage, outgoing: boolean): void {
		const type = FROM_SERVER[m.t];
		if (!type || (outgoing && !OUR_OWN.has(m.t))) return;
		let data: unknown;
		switch (m.t) {
			case "add":
			case "update":
				data = m.stroke;
				break;
			case "remove":
				data = m.id;
				break;
			case "live_drop":
			case "cursor_drop":
				data = m.ids;
				break;
			case "background":
				data = m.value;
				break;
			case "snapshot":
				data = { strokes: m.strokes, background: m.background };
				break;
			default: {
				const { t: _t, ...rest } = m;
				data = rest;
			}
		}
		this.events.push([this.at(), type, data]);
	}

	/** Notes the view we look at (the visible board rectangle and the window), if it changed. */
	view(rect: Rect, win: { w: number; h: number }): void {
		const data = { ...rect, ...win };
		const key = JSON.stringify(data);
		if (key === this.lastView) return;
		this.lastView = key;
		this.events.push([this.at(), "v", data]);
	}

	/** Hands over the events noted since the last call, so each segment holds only what is new. */
	take(): LogEvent[] {
		const out = this.events;
		this.events = [];
		return out;
	}
}
