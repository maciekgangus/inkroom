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

/** What the follow state needs from the connection and the viewport. */
export interface FollowIo {
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

	constructor(private io: FollowIo) {}

	/** A person's chip was pressed: follow them, or stop when we already do. */
	toggle(id: string): void {
		if (this.following === id) this.stop();
		else this.start(id);
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
	peersChanged(ids: string[]): void {
		if (this.following && !ids.includes(this.following)) {
			this.lost = "";
			this.stop();
		}
		if (this.invite && !ids.includes(this.invite)) this.invite = "";
		if (this.lost && !ids.includes(this.lost)) this.lost = "";
	}
}
