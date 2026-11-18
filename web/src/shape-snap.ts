const KEY = "inkroom.snapShapes";

/**
 * Whether holding the pen straightens a stroke into a shape (R-095): what was chosen on this
 * device, else on where a stylus is the natural tool (a touch screen) and off on a computer, so
 * handwriting is not spoiled.
 */
export function loadSnapShapes(): boolean {
	try {
		const saved = localStorage.getItem(KEY);
		if (saved === "1") return true;
		if (saved === "0") return false;
	} catch {
		// nothing stored: the default below
	}
	return typeof matchMedia === "function"
		? matchMedia("(pointer: coarse)").matches
		: false;
}

/** Remembers the choice on this device. */
export function saveSnapShapes(on: boolean): void {
	try {
		localStorage.setItem(KEY, on ? "1" : "0");
	} catch {
		// it then lasts until the page is closed
	}
}
