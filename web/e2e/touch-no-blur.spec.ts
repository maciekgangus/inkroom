import { expect, test } from "@playwright/test";
import { openBoard } from "./helpers";

// A blurred backdrop over a full-screen canvas is redrawn by the GPU on every frame the canvas
// moves; on a phone that is what makes it warm. Touch screens get solid cards (R-100 follow-up).

const GLASS = [
	".toolbar",
	".zoom",
	".backgrounds",
	".corner",
	".board-title",
	".participants",
	".board-menu",
	".minimap",
];

test("on a touch screen no card blurs what is behind it and each one is opaque", async ({
	page,
}) => {
	await openBoard(page);
	const found = await page.evaluate((sels) => {
		return sels.map((sel) => {
			const el = document.querySelector(sel);
			if (!el) return { sel, missing: true };
			const s = getComputedStyle(el);
			const bg = s.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
			return {
				sel,
				blur: s.backdropFilter,
				alpha: bg.length > 3 ? bg[3] : 1,
			};
		});
	}, GLASS);
	const present = found.filter((f) => !("missing" in f));
	expect(present.length).toBeGreaterThan(4);
	for (const f of present) {
		expect(f, f.sel).toMatchObject({ blur: "none", alpha: 1 });
	}
});

test("on a desktop the cards keep their glass", async ({
	browser,
	baseURL,
}) => {
	const ctx = await browser.newContext({
		baseURL,
		viewport: { width: 1440, height: 900 },
		hasTouch: false,
		isMobile: false,
	});
	const page = await ctx.newPage();
	await openBoard(page);
	const blur = await page.evaluate(
		() =>
			getComputedStyle(document.querySelector(".toolbar") as Element)
				.backdropFilter,
	);
	expect(blur).toContain("blur");
	await ctx.close();
});
