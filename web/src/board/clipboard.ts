import type { ElementKind, Point, Stroke } from "./board";

/** The format of the system clipboard text: plain JSON, so other tools can read and write it. */
export const CLIPBOARD_VERSION = 1;
/** Refuses a clipboard with more elements than this (a mistake or an attack, not a drawing). */
const MAX_ELEMENTS = 5000;
const MAX_POINTS = 200_000;

/** An element as it travels in the clipboard: without what belongs to a board and an author. */
export type ClipElement = Omit<Stroke, "id" | "authorId" | "z">;

/** What the clipboard holds: the board it was copied from and the elements, back to front. */
export interface ParsedClip {
	board: string;
	elements: ClipElement[];
}

const KINDS: ElementKind[] = [
	"stroke",
	"line",
	"rect",
	"circle",
	"ellipse",
	"trapezoid",
	"rhombus",
	"parallelogram",
	"text",
	"image",
];
const DASHES = ["solid", "dashed", "dotted"];

/**
 * The text to put on the system clipboard for these elements (R-035): JSON with the marker
 * `inkroom`, the version, the board they come from and the elements in drawing order. The
 * id, author and `z` are left out; pasting gives the copies new ones.
 */
export function serializeSelection(els: Stroke[], boardId: string): string {
	const elements = els.map(({ id: _id, authorId: _a, z: _z, ...rest }) => rest);
	return JSON.stringify({
		inkroom: CLIPBOARD_VERSION,
		board: boardId,
		elements,
	});
}

const isNum = (v: unknown): v is number =>
	typeof v === "number" && Number.isFinite(v);
const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** One element from the clipboard, rebuilt from the known fields only; null if it is malformed. */
function cleanElement(raw: unknown): ClipElement | null {
	if (!isObject(raw)) return null;
	const { color, size, points } = raw;
	if (typeof color !== "string" || !isNum(size)) return null;
	if (!Array.isArray(points) || points.length === 0) return null;
	const pts: Point[] = [];
	for (const p of points) {
		if (!Array.isArray(p) || p.length < 2) return null;
		if (!isNum(p[0]) || !isNum(p[1])) return null;
		pts.push([p[0], p[1], isNum(p[2]) ? p[2] : 0.5]);
	}
	const out: ClipElement = { color, size, points: pts };
	if (raw.kind !== undefined) {
		if (
			typeof raw.kind !== "string" ||
			!KINDS.includes(raw.kind as ElementKind)
		)
			return null;
		out.kind = raw.kind as ElementKind;
	}
	if (raw.text !== undefined) {
		if (typeof raw.text !== "string") return null;
		out.text = raw.text;
	}
	if (raw.src !== undefined) {
		if (typeof raw.src !== "string") return null;
		out.src = raw.src;
	}
	if (raw.fill !== undefined) {
		if (typeof raw.fill !== "string") return null;
		out.fill = raw.fill;
	}
	if (raw.dash !== undefined) {
		if (typeof raw.dash !== "string" || !DASHES.includes(raw.dash)) return null;
		out.dash = raw.dash as ClipElement["dash"];
	}
	for (const key of ["rot", "fontSize"] as const) {
		if (raw[key] !== undefined) {
			if (!isNum(raw[key])) return null;
			out[key] = raw[key] as number;
		}
	}
	if (raw.opacity !== undefined) {
		if (!isNum(raw.opacity) || raw.opacity < 0 || raw.opacity > 1) return null;
		out.opacity = raw.opacity;
	}
	return out;
}

/**
 * Reads clipboard text written by `serializeSelection`. Returns null for anything else: other
 * text, another version, no usable element. Text from the clipboard is untrusted, so every
 * element is rebuilt from the known fields and the malformed ones are dropped.
 */
export function parseClipboard(text: string): ParsedClip | null {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isObject(json) || json.inkroom !== CLIPBOARD_VERSION) return null;
	if (typeof json.board !== "string" || !Array.isArray(json.elements))
		return null;
	if (json.elements.length > MAX_ELEMENTS) return null;
	const elements: ClipElement[] = [];
	let points = 0;
	for (const raw of json.elements) {
		const el = cleanElement(raw);
		if (!el) continue;
		points += el.points.length;
		if (points > MAX_POINTS) return null;
		elements.push(el);
	}
	return elements.length > 0 ? { board: json.board, elements } : null;
}

/**
 * The elements ready for `targetBoard`: a picture belongs to the board it was uploaded to, so
 * pictures from another board are copied over by `transfer` (which returns the new id).
 */
export async function rehomeImages(
	clip: ParsedClip,
	targetBoard: string,
	transfer: (fromBoard: string, src: string) => Promise<string>,
): Promise<ClipElement[]> {
	if (clip.board === targetBoard) return clip.elements;
	try {
		return await Promise.all(
			clip.elements.map(async (el) =>
				el.kind === "image" && el.src
					? { ...el, src: await transfer(clip.board, el.src) }
					: el,
			),
		);
	} catch {
		throw new Error("Nie można skopiować obrazu z innej tablicy");
	}
}
