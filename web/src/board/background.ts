import type { Viewport } from "./viewport";

/** The board's shared backdrop (ADR 0010). */
export const BACKGROUNDS = ["plain", "dots", "grid", "lines"] as const;
export type Background = (typeof BACKGROUNDS)[number];

export const isBackground = (v: unknown): v is Background =>
	BACKGROUNDS.includes(v as Background);

const SPACING = 24; // board units between grid lines and dots
const LINE_SPACING = 32;
const MIN_SCREEN_SPACING = 12;
const INK = "var(--grid)";

/** Inline CSS properties: backgroundImage, backgroundSize and backgroundPosition, or none. */
export type BackgroundStyle = Record<string, string>;

const px = (n: number) => `${Math.round(n * 1000) / 1000}px`;
const mod = (n: number, m: number) => ((n % m) + m) % m;

/**
 * CSS for the layer under the canvases: a tiled pattern that pans and zooms with the view.
 * When zoomed far out the spacing doubles until the pattern is readable again.
 */
export function backgroundStyle(
	kind: Background,
	viewport: Viewport,
): BackgroundStyle {
	if (kind === "plain") return {};
	let step = (kind === "lines" ? LINE_SPACING : SPACING) * viewport.scale;
	while (step < MIN_SCREEN_SPACING) step *= 2;
	// Dots are drawn in the middle of a tile, so shift them onto the crossings.
	const shift = kind === "dots" ? step / 2 : 0;
	const horizontal = `linear-gradient(${INK} 1px, transparent 1px)`;
	const images = {
		dots: `radial-gradient(circle, ${INK} 1.25px, transparent 1.75px)`,
		grid: `${horizontal}, linear-gradient(90deg, ${INK} 1px, transparent 1px)`,
		lines: horizontal,
	};
	return {
		backgroundImage: images[kind],
		backgroundSize: `${px(step)} ${px(step)}`,
		backgroundPosition: `${px(mod(-viewport.x * viewport.scale + shift, step))} ${px(mod(-viewport.y * viewport.scale + shift, step))}`,
	};
}
