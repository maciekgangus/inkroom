/** How long after the pen is lifted from a button the browser may still send its click. */
const WAIT_MS = 80;

/**
 * Makes the pen press buttons (R-069). Some browsers (Safari on an iPad) do not always send a
 * click when an Apple Pencil taps a button; if none follows the lift within a moment, the click
 * is sent here. A click that does come cancels it, so a button is never pressed twice.
 * Returns a function that removes the listeners.
 */
export function installPenClick(target: Document = document): () => void {
	let pending: { button: HTMLElement; timer: number } | null = null;
	const clear = () => {
		if (pending) clearTimeout(pending.timer);
		pending = null;
	};
	const up = (e: Event) => {
		const pe = e as PointerEvent;
		if (pe.pointerType !== "pen") return;
		const button = (e.target as HTMLElement | null)?.closest?.(
			"button",
		) as HTMLElement | null;
		clear();
		if (!button || (button as HTMLButtonElement).disabled) return;
		pending = {
			button,
			timer: window.setTimeout(() => {
				pending = null;
				button.click();
			}, WAIT_MS),
		};
	};
	target.addEventListener("pointerup", up, true);
	target.addEventListener("click", clear, true);
	return () => {
		clear();
		target.removeEventListener("pointerup", up, true);
		target.removeEventListener("click", clear, true);
	};
}
