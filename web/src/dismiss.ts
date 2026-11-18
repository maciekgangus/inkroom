/**
 * Calls `close` on Escape, or on a press outside the element matching `inside` (seen in the
 * capture phase, so nothing can swallow it). Returns the function that stops listening, for an
 * effect to hand back.
 */
export function closeOnDismiss(inside: string, close: () => void): () => void {
	const key = (e: KeyboardEvent) => e.key === "Escape" && close();
	const outside = (e: Event) => {
		if (!(e.target as HTMLElement).closest?.(inside)) close();
	};
	addEventListener("keydown", key);
	addEventListener("pointerdown", outside, true);
	return () => {
		removeEventListener("keydown", key);
		removeEventListener("pointerdown", outside, true);
	};
}
