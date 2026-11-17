const KEY = "inkroom.extraColor";
let kept: string | null | undefined;

/**
 * The colour held in the fourth slot of the colour bar (R-079): the last one picked from beyond
 * the quick colours. It stays there when a quick colour is chosen, and is remembered on this
 * device. Null until one was picked.
 */
export function getExtraColor(): string | null {
	if (kept !== undefined) return kept;
	try {
		const v = localStorage.getItem(KEY);
		kept = v && /^#[0-9a-f]{3,8}$/i.test(v) ? v : null;
	} catch {
		kept = null;
	}
	return kept;
}

/** Remembers the colour of the fourth slot. */
export function setExtraColor(color: string): void {
	kept = color;
	try {
		localStorage.setItem(KEY, color);
	} catch {
		// it then lasts until the page is closed
	}
}

/** Forgets what was kept (tests). */
export function resetExtraColor(): void {
	kept = undefined;
	try {
		localStorage.removeItem(KEY);
	} catch {
		// nothing to remove
	}
}
