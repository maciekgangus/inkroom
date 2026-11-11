import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, test } from "vitest";
import { Logo } from "./logo";
import { setTheme } from "./theme";

describe("Logo", () => {
	const root = document.createElement("div");
	afterEach(() => render(null, root));

	test("is the light logo on the light theme, with the name for readers", async () => {
		setTheme("light");
		await act(async () => render(<Logo />, root));
		const img = root.querySelector("img") as HTMLImageElement;
		expect(img.getAttribute("src")).toBe("/brand/logo-light.svg");
		expect(img.getAttribute("alt")).toBe("Inkroom");
	});

	test("is the dark logo on the dark theme, and follows a switch", async () => {
		setTheme("dark");
		await act(async () => render(<Logo />, root));
		expect(root.querySelector("img")?.getAttribute("src")).toBe(
			"/brand/logo-dark.svg",
		);
		await act(async () => setTheme("light"));
		expect(root.querySelector("img")?.getAttribute("src")).toBe(
			"/brand/logo-light.svg",
		);
	});
});
