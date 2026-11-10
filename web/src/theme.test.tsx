import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	currentTheme,
	displayColor,
	initTheme,
	setTheme,
	ThemeToggle,
} from "./theme";

const systemDark = (dark: boolean) =>
	vi.stubGlobal("matchMedia", () => ({
		matches: dark,
		addEventListener: () => {},
	}));

describe("theme", () => {
	beforeEach(() => {
		localStorage.clear();
		delete document.documentElement.dataset.theme;
	});
	afterEach(() => vi.unstubAllGlobals());

	test("follows the system setting until the user chooses", () => {
		expect(currentTheme()).toBe("light");
		systemDark(true);
		expect(currentTheme()).toBe("dark");
		setTheme("light");
		expect(currentTheme()).toBe("light");
		expect(localStorage.getItem("inkroom.theme")).toBe("light");
	});

	test("initTheme and setTheme mark the document", () => {
		systemDark(true);
		initTheme();
		expect(document.documentElement.dataset.theme).toBe("dark");
		setTheme("light");
		expect(document.documentElement.dataset.theme).toBe("light");
	});

	test("in dark mode default black ink shows as white and white as black", () => {
		expect(displayColor("#111111", "dark")).toBe("#ffffff");
		expect(displayColor("#FFFFFF", "dark")).toBe("#111111");
		expect(displayColor("#d32f2f", "dark")).toBe("#d32f2f");
		expect(displayColor("#111111", "light")).toBe("#111111");
		expect(displayColor("#ffffff", "light")).toBe("#ffffff");
	});

	test("the toggle button switches the theme and remembers it", () => {
		const root = document.createElement("div");
		act(() => render(<ThemeToggle />, root));
		const button = () =>
			root.querySelector('[aria-label="toggle theme"]') as HTMLButtonElement;
		expect(button().getAttribute("aria-pressed")).toBe("false");
		act(() => button().click());
		expect(document.documentElement.dataset.theme).toBe("dark");
		expect(button().getAttribute("aria-pressed")).toBe("true");
		expect(localStorage.getItem("inkroom.theme")).toBe("dark");
		act(() => button().click());
		expect(currentTheme()).toBe("light");
	});
});
