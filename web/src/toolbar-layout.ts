import { useEffect, useState } from "preact/hooks";

/**
 * How the tool bar is laid out (R-082): "rail" is a column down the left edge for a tablet held
 * upright, "compact" one short row where the colour, width and style are one button with a list,
 * and "full" the bar with everything in it, kept wherever it fits in one row.
 */
export type ToolbarLayout = "full" | "compact" | "rail";

/** A tablet (finger as the main pointer) in portrait. */
const RAIL = "(orientation: portrait) and (pointer: coarse)";
/** Narrower than this, the full bar no longer fits one row next to the name and the people. */
const COMPACT = "(max-width: 1500px)";

const matches = (q: string): boolean =>
	typeof matchMedia === "function" && matchMedia(q).matches === true;

/** The layout for the screen as it is now. */
export function currentLayout(): ToolbarLayout {
	if (matches(RAIL)) return "rail";
	if (matches(COMPACT)) return "compact";
	return "full";
}

/** A phone: too narrow for the board's name in the top bar, so it folds into a button (R-110). */
const PHONE = "(max-width: 600px)";

/** Whether the screen is a phone's now. */
export function isPhone(): boolean {
	return matches(PHONE);
}

/** Whether the screen is a phone's, kept up to date when it is resized or turned. */
export function usePhone(): boolean {
	const [phone, setPhone] = useState(isPhone);
	useEffect(() => {
		if (typeof matchMedia !== "function") return;
		const list = matchMedia(PHONE);
		const update = () => setPhone(isPhone());
		list.addEventListener("change", update);
		update();
		return () => list.removeEventListener("change", update);
	}, []);
	return phone;
}

/** The layout, kept up to date when the window is resized or the tablet is turned. */
export function useToolbarLayout(): ToolbarLayout {
	const [layout, setLayout] = useState(currentLayout);
	useEffect(() => {
		if (typeof matchMedia !== "function") return;
		const update = () => setLayout(currentLayout());
		const lists = [RAIL, COMPACT].map((q) => matchMedia(q));
		for (const l of lists) l.addEventListener("change", update);
		update();
		return () => {
			for (const l of lists) l.removeEventListener("change", update);
		};
	}, []);
	return layout;
}
