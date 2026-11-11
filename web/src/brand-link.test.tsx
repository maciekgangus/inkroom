import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, test } from "vitest";
import { BrandLink } from "./brand-link";
import { setTheme } from "./theme";

describe("BrandLink: the logo in the corner of a board", () => {
	const root = document.createElement("div");
	afterEach(() => render(null, root));

	test("is a link home, to the boards, named for readers", async () => {
		setTheme("light");
		await act(async () => render(<BrandLink />, root));
		const a = root.querySelector("a") as HTMLAnchorElement;
		expect(a.getAttribute("href")).toBe("/");
		expect(a.getAttribute("aria-label")).toBe("Inkroom: wróć do tablic");
		expect(a.title).toBe("Wróć do tablic");
	});

	test("shows the mark of the light or the dark theme, and follows a switch", async () => {
		setTheme("light");
		await act(async () => render(<BrandLink />, root));
		expect(root.querySelector("img")?.getAttribute("src")).toBe(
			"/brand/icon-light-small.svg",
		);
		await act(async () => setTheme("dark"));
		expect(root.querySelector("img")?.getAttribute("src")).toBe(
			"/brand/icon-dark-small.svg",
		);
	});
});
