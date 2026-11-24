import { useEffect, useState } from "preact/hooks";
import { Icon } from "./icon";

export type Theme = "light" | "dark";

const KEY = "inkroom.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

function stored(): Theme | null {
	try {
		const v = localStorage.getItem(KEY);
		return v === "light" || v === "dark" ? v : null;
	} catch {
		return null; // storage can be unavailable (private mode)
	}
}

/** The theme in use: the user's choice on this device, otherwise the system setting (ADR 0010). */
export function currentTheme(): Theme {
	const system = globalThis.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";
	return stored() ?? system;
}

function apply(): void {
	document.documentElement.dataset.theme = currentTheme();
	for (const fn of listeners) fn();
}

/** Applies the theme at startup and follows later changes of the system setting. */
export function initTheme(): void {
	apply();
	globalThis.matchMedia?.(DARK_QUERY).addEventListener("change", apply);
}

/** Switches the theme and remembers the choice on this device. */
export function setTheme(theme: Theme): void {
	try {
		localStorage.setItem(KEY, theme);
	} catch {
		// Not remembering is fine.
	}
	apply();
}

/** The current theme; the component re-renders when it changes. */
export function useTheme(): Theme {
	const [, rerender] = useState(0);
	useEffect(() => {
		const fn = () => rerender((n) => n + 1);
		listeners.add(fn);
		return () => {
			listeners.delete(fn);
		};
	}, []);
	return currentTheme();
}

const BLACK = "#111111";
const WHITE = "#ffffff";
/** The light violet of the logo: seen on the dark board and on white pages and images alike. */
const DARK_INK = "#8f8fff";

/**
 * The colour to paint a stored ink colour with. In dark mode the default black is shown
 * as light violet (white would vanish on a white page or image) and white as black, so one
 * board reads well in both themes (R-026).
 */
export function displayColor(color: string, theme: Theme): string {
	if (theme !== "dark") return color;
	const c = color.toLowerCase();
	if (c === BLACK) return DARK_INK;
	if (c === WHITE) return BLACK;
	return color;
}

type WithTransition = Document & {
	startViewTransition?: (update: () => Promise<void>) => unknown;
};

/**
 * Switches the theme with a short cross-fade where the browser can (View Transitions), and at
 * once where it cannot or the user asked for less motion. The fade waits two frames, so the
 * board's canvas is already painted in the new colours when it starts.
 */
function switchTheme(theme: Theme): void {
	const doc = document as WithTransition;
	const calm = globalThis.matchMedia?.(
		"(prefers-reduced-motion: reduce)",
	).matches;
	if (!doc.startViewTransition || calm) {
		setTheme(theme);
		return;
	}
	doc.startViewTransition(
		() =>
			new Promise<void>((done) => {
				setTheme(theme);
				requestAnimationFrame(() => requestAnimationFrame(() => done()));
			}),
	);
}

/** A button that switches between the light and the dark theme. */
export function ThemeToggle() {
	const dark = useTheme() === "dark";
	return (
		<button
			type="button"
			aria-label="toggle theme"
			aria-pressed={dark}
			title={dark ? "Tryb jasny" : "Tryb ciemny"}
			onClick={() => switchTheme(dark ? "light" : "dark")}
		>
			<Icon name={dark ? "sun" : "moon"} />
		</button>
	);
}
