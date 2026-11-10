/** Where a user looks on a board: the board point at the top left of the screen, and the zoom. */
export interface SavedView {
	x: number;
	y: number;
	scale: number;
}

const same = (a: SavedView | null, b: SavedView) =>
	a !== null && a.x === b.x && a.y === b.y && a.scale === b.scale;

/**
 * Sends the view to the server once it has settled (a pan or a zoom changes it many times a
 * second), not again if it is the one already saved, and at once on `flush` (leaving the page).
 */
export function createViewSaver(save: (v: SavedView) => void, delay = 1000) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let waiting: SavedView | null = null;
	let saved: SavedView | null = null;

	const send = () => {
		timer = null;
		const v = waiting;
		waiting = null;
		if (!v || same(saved, v)) return;
		saved = v;
		save(v);
	};
	return {
		/** The view the server already has (the one just loaded), so it is not sent back. */
		known(v: SavedView) {
			saved = v;
		},
		/** The view changed: send it when it stops changing. */
		schedule(v: SavedView) {
			waiting = v;
			if (timer) clearTimeout(timer);
			timer = setTimeout(send, delay);
		},
		/** Send what is waiting now. */
		flush() {
			if (timer) clearTimeout(timer);
			send();
		},
	};
}
