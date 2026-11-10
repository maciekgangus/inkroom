const FINE = "(hover: hover) and (pointer: fine)";

/** True when the main pointer is a mouse or trackpad (a PC), false on a tablet (R-028). */
export function hasFinePointer(): boolean {
	return typeof matchMedia === "function" && matchMedia(FINE).matches === true;
}
