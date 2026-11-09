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
