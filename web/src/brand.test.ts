import { describe, expect, test } from "vitest";
import html from "../index.html?raw";
import manifestText from "../public/site.webmanifest?raw";

// The files of public/ (served from the site's root), found without touching the disk by hand.
const served = new Set(
	Object.keys(import.meta.glob("../public/**/*", { query: "?url" })).map((p) =>
		p.replace("../public/", ""),
	),
);
const existsSync = (file: string) => served.has(file);
const pub = (file: string) => file;

describe("the brand in the page head (the Inkroom nib)", () => {
	test("has the favicons, the touch icon and the manifest", () => {
		expect(html).toContain(
			'rel="icon" href="/favicon.svg" type="image/svg+xml"',
		);
		expect(html).toContain('rel="icon" href="/favicon.ico"');
		expect(html).toContain(
			'rel="apple-touch-icon" href="/apple-touch-icon.png"',
		);
		expect(html).toContain('rel="manifest" href="/site.webmanifest"');
	});

	test("tints the browser bar in the colours of both themes", () => {
		expect(html).toMatch(
			/theme-color" content="#F4F4F7" media="\(prefers-color-scheme: light\)"/,
		);
		expect(html).toMatch(
			/theme-color" content="#1C1D27" media="\(prefers-color-scheme: dark\)"/,
		);
	});

	test("every file the head names is served from public/", () => {
		for (const file of [
			"favicon.svg",
			"favicon.ico",
			"apple-touch-icon.png",
			"site.webmanifest",
		]) {
			expect(existsSync(pub(file)), file).toBe(true);
		}
	});
});

describe("the web app manifest", () => {
	const manifest = JSON.parse(manifestText);

	test("names the app and opens at the start page", () => {
		expect(manifest.name).toBe("Inkroom");
		expect(manifest.start_url).toBe("/");
		expect(manifest.display).toBe("standalone");
	});

	test("lists icons that exist, with the sizes and the purposes an installed app needs", () => {
		const sizes = new Set<string>();
		for (const icon of manifest.icons) {
			expect(existsSync(pub(icon.src.slice(1))), icon.src).toBe(true);
			sizes.add(`${icon.sizes} ${icon.purpose}`);
		}
		for (const want of [
			"192x192 any",
			"512x512 any",
			"192x192 maskable",
			"512x512 maskable",
		]) {
			expect(sizes.has(want), want).toBe(true);
		}
	});
});

describe("the logo shown in the app", () => {
	test("exists in a version for each theme", () => {
		expect(existsSync(pub("brand/logo-light.svg"))).toBe(true);
		expect(existsSync(pub("brand/logo-dark.svg"))).toBe(true);
	});
});
