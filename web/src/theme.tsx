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

/** The theme in use: the user's choice on this device, otherwise the system setting (ADR 0007). */
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

/**
 * The colour to paint a stored ink colour with. In dark mode the default black is shown
 * as white and white as black, so one board reads well in both themes (R-022).
 */
export function displayColor(color: string, theme: Theme): string {
	if (theme !== "dark") return color;
	const c = color.toLowerCase();
	if (c === BLACK) return WHITE;
	if (c === WHITE) return BLACK;
	return color;
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
			onClick={() => setTheme(dark ? "light" : "dark")}
		>
			<Icon name={dark ? "sun" : "moon"} />
		</button>
	);
}
