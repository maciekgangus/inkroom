import type { Settings } from "./board/controller";
import { ERASER_RADIUS } from "./board/controller";

/** An SVG cursor image: a dark outline under a white line, so it shows on any background. */
function svgCursor(
	svg: string,
	x: number,
	y: number,
	fallback: string,
): string {
	return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`;
}

// A pencil from the toolbar icon, drawn at 24 px; the tip (the hotspot) is at its bottom left.
const PEN = (() => {
	const path = "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z";
	const stroke = (c: string, w: number) =>
		`<path d="${path}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${stroke("#000", 3.5)}${stroke("#fff", 1.75)}</svg>`;
})();

// A ring as big as the eraser itself, so it shows what the eraser will touch.
const ERASER = (() => {
	const d = ERASER_RADIUS * 2 + 2;
	const c = d / 2;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}" viewBox="0 0 ${d} ${d}"><circle cx="${c}" cy="${c}" r="${ERASER_RADIUS}" fill="none" stroke="#000" stroke-width="3"/><circle cx="${c}" cy="${c}" r="${ERASER_RADIUS}" fill="none" stroke="#fff" stroke-width="1.5"/></svg>`;
})();

/** The mouse cursor for the active tool (R-030), so it is always clear what is switched on. */
export function toolCursor(tool: Settings["tool"], panning = false): string {
	if (panning) return "grabbing";
	switch (tool) {
		case "pan":
			return "grab";
		case "text":
			return "text";
		case "select":
			return "default";
		case "pen":
			return svgCursor(PEN, 3, 21, "crosshair");
		case "eraser":
			return svgCursor(ERASER, ERASER_RADIUS + 1, ERASER_RADIUS + 1, "cell");
		default:
			return "crosshair"; // line and shapes
	}
}
