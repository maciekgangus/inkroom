/**
 * The pictures an account may show instead of its first letter (R-111): Microsoft Fluent Emoji
 * (Flat, MIT) in public/avatars, named by id. The server keeps the same list.
 */
export const AVATARS: readonly { id: string; label: string }[] = [
	{ id: "dog", label: "Pies" },
	{ id: "cat", label: "Kot" },
	{ id: "fox", label: "Lis" },
	{ id: "panda", label: "Panda" },
	{ id: "koala", label: "Koala" },
	{ id: "tiger", label: "Tygrys" },
	{ id: "lion", label: "Lew" },
	{ id: "frog", label: "Żaba" },
	{ id: "monkey", label: "Małpka" },
	{ id: "rabbit", label: "Królik" },
	{ id: "bear", label: "Miś" },
	{ id: "pig", label: "Świnka" },
	{ id: "cow", label: "Krowa" },
	{ id: "unicorn", label: "Jednorożec" },
	{ id: "octopus", label: "Ośmiornica" },
	{ id: "penguin", label: "Pingwin" },
	{ id: "owl", label: "Sowa" },
	{ id: "hamster", label: "Chomik" },
	{ id: "wolf", label: "Wilk" },
	{ id: "raccoon", label: "Szop" },
	{ id: "hedgehog", label: "Jeż" },
	{ id: "turtle", label: "Żółw" },
	{ id: "whale", label: "Wieloryb" },
	{ id: "butterfly", label: "Motyl" },
	{ id: "ladybug", label: "Biedronka" },
	{ id: "bee", label: "Pszczoła" },
	{ id: "dragon", label: "Smok" },
	{ id: "sloth", label: "Leniwiec" },
	{ id: "cool", label: "Buźka w okularach" },
	{ id: "starstruck", label: "Zachwyt" },
	{ id: "nerd", label: "Kujon" },
	{ id: "party", label: "Impreza" },
	{ id: "cowboy", label: "Kowboj" },
	{ id: "robot", label: "Robot" },
	{ id: "alien", label: "Kosmita" },
	{ id: "ghost", label: "Duszek" },
];

const KNOWN = new Set(AVATARS.map((a) => a.id));

/** The address of a known picture, or null for anything else (never built from an unknown id). */
export function avatarUrl(id: string | undefined): string | null {
	return id && KNOWN.has(id) ? `/avatars/${id}.svg` : null;
}
