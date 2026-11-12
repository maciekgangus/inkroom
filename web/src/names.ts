/** The name only the owner's admin panel may appear under on a board (R-065). */
export const ADMIN_NAME = "Administrator";

/**
 * True for the reserved name Administrator, in any letter case and with anything between the
 * letters (spaces, dots, dashes). The server decides; this only tells a guest early.
 */
export function isReservedName(name: string): boolean {
	const letters = [...name]
		.filter((c) => /[\p{L}\p{N}]/u.test(c))
		.join("")
		.toLowerCase();
	return letters === ADMIN_NAME.toLowerCase();
}
