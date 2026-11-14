/**
 * Gathers many small reasons to repaint into one repaint per frame. Messages from the network
 * can come faster than the screen is drawn; each only marks what changed (a bit), and the flush
 * runs once on the next frame with all the bits. So the cost of a frame does not grow with the
 * number of messages, and they can never queue up behind the painting.
 */
export function frameBatch(
	flush: (kinds: number) => void,
	schedule: (fn: () => void) => void = (fn) =>
		typeof requestAnimationFrame === "function"
			? requestAnimationFrame(fn)
			: fn(),
): { mark(kind: number): void; cancel(): void } {
	let kinds = 0;
	let waiting = false;
	let cancelled = false;
	return {
		mark(kind) {
			kinds |= kind;
			if (waiting || cancelled) return;
			waiting = true;
			schedule(() => {
				waiting = false;
				const k = kinds;
				kinds = 0;
				if (!cancelled && k) flush(k);
			});
		},
		cancel() {
			cancelled = true;
		},
	};
}
