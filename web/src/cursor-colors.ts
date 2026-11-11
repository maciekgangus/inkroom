/** Colours for other people's cursors; readable on a white board. */
export const CURSOR_COLORS = [
	"#e53935",
	"#8e24aa",
	"#3949ab",
	"#00897b",
	"#f4511e",
	"#6d4c41",
	"#039be5",
	"#7cb342",
];

/** A stable colour for a person, derived from their id (every client computes the same one). */
export function cursorColor(authorId: string): string {
	let hash = 0;
	for (let i = 0; i < authorId.length; i++)
		hash = (hash * 31 + authorId.charCodeAt(i)) >>> 0;
	return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}

/**
 * Colours for everyone on the board at once, all different while the palette lasts. Each person
 * starts from their own colour; the ids are taken in sorted order, and a person whose colour is
 * already taken moves on to the next free one. Every client gets the same answer from the same
 * list, and people who do not collide keep the colour they always had.
 */
export function assignColors(ids: string[]): Map<string, string> {
	const out = new Map<string, string>();
	const used = new Set<number>();
	for (const id of [...new Set(ids)].sort()) {
		let i = CURSOR_COLORS.indexOf(cursorColor(id));
		for (let tries = 0; used.has(i) && tries < CURSOR_COLORS.length; tries++)
			i = (i + 1) % CURSOR_COLORS.length;
		used.add(i);
		out.set(id, CURSOR_COLORS[i]);
	}
	return out;
}
