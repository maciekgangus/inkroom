import { expect, test } from "@playwright/test";
import { openBoard } from "./helpers";

test.beforeEach(async ({ page }) => {
	await openBoard(page);
});

const box = async (page: import("@playwright/test").Page, sel: string) => {
	const b = await page.locator(sel).first().boundingBox();
	if (!b) throw new Error(`${sel} is not on the page`);
	return b;
};

test("upright, the tools stand in a column down the left edge (R-082)", async ({
	page,
}) => {
	const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
	test.skip(width > height, "a landscape project");
	const rail = await box(page, ".toolbar.rail");
	expect(rail.x).toBeLessThanOrEqual(16);
	expect(rail.y).toBeGreaterThan(40);
	expect(rail.y + rail.height).toBeLessThanOrEqual(height);
	expect(rail.width).toBeLessThan(90);
	// stacked: each tool under the one before it
	const pen = await box(page, ".toolbar [aria-label='pen']");
	const eraser = await box(page, ".toolbar [aria-label='eraser']");
	expect(eraser.y).toBeGreaterThan(pen.y + pen.height - 1);
	expect(Math.abs(eraser.x - pen.x)).toBeLessThan(2);
	// the name stays in the top bar, clear of the rail
	const title = await box(page, ".topbar .board-title");
	expect(title.x).toBeGreaterThan(rail.x + rail.width);
});

test("upright, the list of settings opens beside the rail and fits the screen", async ({
	page,
}) => {
	const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
	test.skip(width > height, "a landscape project");
	await page.locator("[aria-label='pen settings']").tap();
	const list = await box(page, ".settings-list");
	const rail = await box(page, ".toolbar.rail");
	expect(list.x).toBeGreaterThanOrEqual(rail.x + rail.width);
	expect(list.x + list.width).toBeLessThanOrEqual(width);
	expect(list.y).toBeGreaterThanOrEqual(0);
	expect(list.y + list.height).toBeLessThanOrEqual(height);
	// the three sections are there and a colour can be picked
	await expect(page.locator(".settings-title")).toHaveCount(3);
	await page.locator("[aria-label='color #d32f2f']").tap();
	// picking a colour shuts the list; opened again, it shows the colour as chosen
	await expect(page.locator(".settings-list")).toHaveCount(0);
	await page.locator("[aria-label='pen settings']").tap();
	await expect(page.locator("[aria-label='color #d32f2f']")).toHaveAttribute(
		"aria-pressed",
		"true",
	);
});

test("across, the narrow bar is one row with one settings button (R-082)", async ({
	page,
}) => {
	const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
	test.skip(width < height, "a portrait project");
	await expect(page.locator(".toolbar.rail")).toHaveCount(0);
	await expect(page.locator("[aria-label='pen settings']")).toBeVisible();
	await expect(page.locator("[aria-label='size 1']")).toHaveCount(0);
	const tb = await box(page, ".toolbar");
	const title = await box(page, ".topbar .board-title");
	expect(Math.abs(tb.y - title.y)).toBeLessThan(20); // the same row
	await page.locator("[aria-label='pen settings']").tap();
	const list = await box(page, ".settings-list");
	expect(list.x + list.width).toBeLessThanOrEqual(width);
	expect(list.y + list.height).toBeLessThanOrEqual(height);
});

test("a wide window keeps the full bar as it is (R-082)", async ({ page }) => {
	await page.setViewportSize({ width: 1700, height: 900 });
	// a PC: not an upright tablet, wide enough for everything in one row
	await expect(page.locator("[aria-label='pen settings']")).toHaveCount(0);
	await expect(page.locator("[aria-label='size 1']")).toBeVisible();
	await expect(page.locator(".toolbar.rail")).toHaveCount(0);
	const tb = await box(page, ".toolbar");
	const title = await box(page, ".topbar .board-title");
	expect(Math.abs(tb.y - title.y)).toBeLessThan(20);
});

test("on a wide window the palette shuts after a colour from the bar, from the fourth place and from itself", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1700, height: 900 });
	const palette = page.locator(".palette");
	await page.locator("[aria-label='more colors']").click();
	await expect(palette).toBeVisible();
	// The palette hangs from the fourth place: its middle is level with the middle of that place.
	const slot = await box(page, "[aria-label='more colors']");
	const card = await box(page, ".palette");
	expect(
		Math.abs(card.x + card.width / 2 - (slot.x + slot.width / 2)),
	).toBeLessThanOrEqual(2);
	expect(card.y).toBeGreaterThan(slot.y + slot.height);
	await page.locator("[aria-label='color #1976d2']").first().click(); // a quick colour of the bar
	await expect(palette).toHaveCount(0);
	await page.locator("[aria-label='more colors']").click();
	await palette.locator("[aria-label^='color #e91e63']").click(); // the grid
	await expect(palette).toHaveCount(0);
	await page.locator("[aria-label='color #d32f2f']").first().click();
	await page.locator("[aria-label='more colors']").click(); // the kept colour is picked
	await expect(palette).toHaveCount(0);
	await page.locator("[aria-label='more colors']").click(); // again: the palette opens
	await expect(palette).toBeVisible();
	await page
		.locator("[aria-label='color #d32f2f']")
		.first()
		.click({ force: true });
	await expect(palette).toHaveCount(0);
	await page.locator("[aria-label='more colors']").click();
	await page.keyboard.press("Escape");
	await expect(palette).toHaveCount(0);
});

test("the share button is on the top bar, an icon only (R-083)", async ({
	page,
}) => {
	const share = page.locator(".topbar [aria-label='share']");
	await expect(share).toBeVisible();
	expect(await share.textContent()).toBe("");
	await expect(share.locator("svg")).toHaveCount(1);
});

/** The geometry of a colour well and its palette, in CSS px: every centre and margin to the pixel. */
const wellGeometry = (page: import("@playwright/test").Page) =>
	page.evaluate(() => {
		const R = (e: Element) => e.getBoundingClientRect();
		const slot = document.querySelector(
			"[aria-label='more colors']",
		) as HTMLElement;
		const pal = document.querySelector(".palette") as HTMLElement;
		const pseudo = (el: HTMLElement, which: "::before" | "::after") => {
			const r = R(el);
			const cs = getComputedStyle(el, which);
			const left = r.left + Number.parseFloat(cs.left);
			const top = r.top + Number.parseFloat(cs.top);
			const w = Number.parseFloat(cs.width);
			const h = Number.parseFloat(cs.height);
			return { cx: left + w / 2, cy: top + h / 2, w, h };
		};
		const centre = (r: DOMRect) => ({
			cx: r.left + r.width / 2,
			cy: r.top + r.height / 2,
		});
		const well = pal.querySelector(".swatch.custom") as HTMLElement;
		const dots = [...pal.querySelectorAll(".swatch:not(.custom)")].map(R);
		const pr = R(pal);
		const rule = R(pal.querySelector(".palette-rule") as HTMLElement);
		const wr = R(well);
		const top = Math.min(...dots.map((d) => d.top));
		const bottom = Math.max(...dots.map((d) => d.bottom));
		const cols = [...new Set(dots.map((d) => d.left))].sort((a, b) => a - b);
		const lastRight = Math.max(...dots.map((d) => d.right));
		const sr = R(slot);
		return {
			slot: {
				...centre(sr),
				ring: pseudo(slot, "::before"),
				dot: pseudo(slot, "::after"),
			},
			wellRing: {
				...centre(wr),
				ring: pseudo(well, "::before"),
				dot: pseudo(well, "::after"),
			},
			wellSize: [wr.width, wr.height],
			dotSize: [dots[0].width, dots[0].height],
			gridCy: (top + bottom) / 2,
			wellCy: wr.top + wr.height / 2,
			ruleCy: rule.top + rule.height / 2,
			ruleGapLeft: rule.left - lastRight,
			ruleGapRight: wr.left - rule.right,
			padLeft: dots[0].left - pr.left,
			padRight: pr.right - wr.right,
			padTop: top - pr.top,
			padBottom: pr.bottom - bottom,
			colSteps: cols.slice(1).map((c, i) => c - cols[i]),
			cardCx: pr.left + pr.width / 2,
			slotCx: sr.left + sr.width / 2,
		};
	});

test("the colour well of the fourth place and the palette are centred to the pixel", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1700, height: 900 });
	await page.locator("[aria-label='more colors']").click();
	await expect(page.locator(".palette")).toBeVisible();
	await page.waitForTimeout(250); // the card has come in
	const g = await wellGeometry(page);
	const near = (a: number, b: number, what: string) =>
		expect(Math.abs(a - b), what).toBeLessThanOrEqual(0.5);
	// the fourth place: the ring, the colour and the button are one centre
	near(g.slot.ring.cx, g.slot.cx, "ring x");
	near(g.slot.ring.cy, g.slot.cy, "ring y");
	near(g.slot.dot.cx, g.slot.cx, "dot x");
	near(g.slot.dot.cy, g.slot.cy, "dot y");
	// the well of one's own colour: the same, as big as a colour of the grid, level with both rows
	near(g.wellRing.ring.cx, g.wellRing.cx, "well ring x");
	near(g.wellRing.dot.cy, g.wellRing.cy, "well dot y");
	expect(g.wellSize).toEqual(g.dotSize);
	near(g.wellCy, g.gridCy, "well level with the grid");
	near(g.ruleCy, g.gridCy, "rule level with the grid");
	near(
		g.ruleGapLeft,
		g.ruleGapRight,
		"rule equally far from the grid and the well",
	);
	// the card: equal margins on all four sides, equal columns, centred under the fourth place
	near(g.padLeft, g.padRight, "left and right");
	near(g.padTop, g.padBottom, "top and bottom");
	near(g.padLeft, g.padTop, "sides and top");
	for (const step of g.colSteps) near(step, g.colSteps[0], "column step");
	near(g.cardCx, g.slotCx, "the card under the fourth place");
	// whole pixels, so that the edges are sharp
	expect(g.slot.dot.w % 2).toBe(0);
	expect(g.wellRing.dot.w % 2).toBe(0);
});
