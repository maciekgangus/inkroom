/** Every setting of the selection glow (R-058), tuned by eye with sliders. */
export interface Glow {
	/** How far the glow spreads, in px. */
	blur: number;
	/** How many times it is drawn on top of itself: more passes, a stronger glow. */
	passes: number;
	/** Opacity of the glow colour, in percent. */
	alpha: number;
	/** Hue of the glow colour, in degrees. */
	hue: number;
	/** Lightness of the glow colour, in percent. */
	light: number;
}

/** The nib colour of the logo (`#7C78FF`) as hue and lightness. */
export const DEFAULT_GLOW: Glow = {
	blur: 14,
	passes: 2,
	alpha: 100,
	hue: 244,
	light: 74,
};

/** The limits of each setting, as the sliders offer them. */
export const GLOW_RANGE: Record<keyof Glow, [number, number]> = {
	blur: [0, 60],
	passes: [1, 6],
	alpha: [5, 100],
	hue: [0, 360],
	light: [20, 95],
};

/** The CSS colour of the glow. */
export function glowColor(g: Glow): string {
	return `hsla(${g.hue}, 100%, ${g.light}%, ${g.alpha / 100})`;
}

/** Reads stored settings; anything missing or odd falls back to the default, and is kept in range. */
export function parseGlow(raw: string | null): Glow {
	let data: Partial<Record<keyof Glow, unknown>> = {};
	try {
		data = raw ? JSON.parse(raw) : {};
	} catch {
		// not JSON: use the defaults
	}
	const out = { ...DEFAULT_GLOW };
	for (const key of Object.keys(GLOW_RANGE) as (keyof Glow)[]) {
		const v = data?.[key];
		if (typeof v !== "number" || !Number.isFinite(v)) continue;
		const [lo, hi] = GLOW_RANGE[key];
		out[key] = Math.min(hi, Math.max(lo, v));
	}
	return out;
}
