import { clampScale, type Rect } from "./viewport";

/** Free space left round the followed rectangle, as a share of the window (R-093). */
const MARGIN = 0.04;
/** How fast our view catches up with the one we follow: the gap shrinks by 1/e per this many ms. */
const CATCH_UP_MS = 90;

/** A view as the viewport keeps it: the board point at the top-left of the window, and the zoom. */
export interface View {
	x: number;
	y: number;
	scale: number;
}

/**
 * The view that shows all of `rect` in a window of another size: centred, as large as fits with
 * a margin, so a tablet sees the same as the big monitor of the presenter (R-093).
 */
export function fitRect(rect: Rect, screenW: number, screenH: number): View {
	const w = Math.max(rect.maxX - rect.minX, 1);
	const h = Math.max(rect.maxY - rect.minY, 1);
	const scale = clampScale(
		Math.min(screenW / w, screenH / h) * (1 - 2 * MARGIN),
	);
	return {
		scale,
		x: (rect.minX + rect.maxX) / 2 - screenW / 2 / scale,
		y: (rect.minY + rect.maxY) / 2 - screenH / 2 / scale,
	};
}

/** One step of easing `cur` towards `target` for a frame of `dtMs`; lands on it when close. */
export function stepView(cur: View, target: View, dtMs: number): View {
	const f = 1 - Math.exp(-dtMs / CATCH_UP_MS);
	const scale = cur.scale * (target.scale / cur.scale) ** f;
	const x = cur.x + (target.x - cur.x) * f;
	const y = cur.y + (target.y - cur.y) * f;
	const close =
		Math.abs(target.x - x) * scale < 0.5 &&
		Math.abs(target.y - y) * scale < 0.5 &&
		Math.abs(Math.log(target.scale / scale)) < 0.002;
	return close ? { ...target } : { x, y, scale };
}

/** Said to the person who tries to follow someone who follows them. */
const CYCLE_NOTICE = "Ta osoba właśnie śledzi Ciebie";

/**
 * One frame of following: the view eased towards the followed one for a window of this size, or
 * null when there is nothing to do: not following, no view yet, arrived, or `frozen` (the pen is
 * down or a text is being edited, so the picture is not moved under the hand; it catches up
 * once the hand is up) (R-093).
 */
export function followStep(
	st: FollowState,
	cur: View,
	screenW: number,
	screenH: number,
	dtMs: number,
	frozen: boolean,
): View | null {
	if (!st.following || !st.target || frozen) return null;
	const target = fitRect(st.target, screenW, screenH);
	if (cur.x === target.x && cur.y === target.y && cur.scale === target.scale)
		return null;
	return stepView(cur, target, dtMs);
}

/** What the follow state needs from the connection and the viewport. */
export interface FollowIo {
	/** Our own id, to see a circle coming back to us. */
	self: string;
	follow(id: string): void;
	sendView(rect: Rect): void;
	invite(): void;
	/** The rectangle of the board we look at now. */
	rect(): Rect;
}

/**
 * "Look where I look" (R-093): whom we follow, the invitation of the owner, and, for the one who
 * is followed, whether to send the view at all. Free of the screen so it can be tested alone.
 */
export class FollowState {
	/** Id of the person whose view we follow, or "". */
	following = "";
	/** Id of the owner who invited us to a shared view, or "" (the banner shows while set). */
	invite = "";
	/** The person we followed until we moved the view ourselves: the way back is offered. */
	lost = "";
	/** The rectangle the followed person shows now, once it has arrived. */
	target: Rect | null = null;
	/** How many people follow our view. */
	followers = 0;
	/** A short word for the person when something was not allowed (shown for a moment). */
	notice = "";
	/** Whom each person on the board follows, from the presence list. */
	private follows = new Map<string, string>();

	constructor(private io: FollowIo) {}

	/** A person's chip was pressed: follow them, or stop when we already do. */
	toggle(id: string): void {
		if (this.following === id) {
			this.stop();
		} else if (this.wouldCycle(id)) {
			this.notice = CYCLE_NOTICE;
		} else {
			this.start(id);
		}
	}

	/** Whether following `to` would close a circle: `to` follows us, directly or through others. */
	private wouldCycle(to: string): boolean {
		let cur: string | undefined = to;
		for (let i = 0; cur && i <= this.follows.size; i++) {
			if (cur === this.io.self) return true;
			cur = this.follows.get(cur);
		}
		return cur !== undefined && cur !== ""; // a circle that does not end: do not join it
	}

	/** The server would not let us follow this person. */
	refused(id: string): void {
		if (this.following !== id) return;
		this.following = "";
		this.target = null;
		this.notice = CYCLE_NOTICE;
	}

	/** The person we followed left the board. */
	ended(id: string): void {
		if (this.following !== id) return;
		this.following = "";
		this.target = null;
		this.lost = "";
	}

	clearNotice(): void {
		this.notice = "";
	}

	private start(id: string): void {
		this.following = id;
		this.lost = "";
		this.target = null;
		if (this.invite === id) this.invite = "";
		this.io.follow(id);
	}

	private stop(): void {
		this.following = "";
		this.target = null;
		this.io.follow("");
	}

	/** We moved or zoomed the view ourselves: following ends and the way back is offered. */
	userMoved(): void {
		if (!this.following) return;
		this.lost = this.following;
		this.stop();
	}

	/** "Back to the presenter's view". */
	back(): void {
		if (this.lost) this.start(this.lost);
	}

	/** The banner's "Join". */
	join(): void {
		if (this.invite) this.start(this.invite);
	}

	dismissInvite(): void {
		this.invite = "";
	}

	/** The owner asks everyone to follow their view. */
	showMyView(): void {
		this.io.invite();
	}

	onInvite(id: string): void {
		if (this.following !== id) this.invite = id;
	}

	onView(id: string, rect: Rect): void {
		if (id === this.following) this.target = rect;
	}

	/** The server says how many follow us; the first follower gets our view at once. */
	onFollowers(n: number): void {
		const grew = n > this.followers;
		this.followers = n;
		if (grew) this.io.sendView(this.io.rect());
	}

	/** Our own view changed (we may be the one followed). */
	viewChanged(rect: Rect): void {
		if (this.followers > 0) this.io.sendView(rect);
	}

	/** Who is on the board now: whoever we follow or who invited us may have left. */
	peersChanged(peers: { id: string; follows?: string }[]): void {
		const ids = peers.map((p) => p.id);
		this.follows = new Map(
			peers.flatMap((p) => (p.follows ? [[p.id, p.follows] as const] : [])),
		);
		if (this.following && !ids.includes(this.following)) {
			this.lost = "";
			this.stop();
		}
		if (this.invite && !ids.includes(this.invite)) this.invite = "";
		if (this.lost && !ids.includes(this.lost)) this.lost = "";
	}
}
