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

/** The geometry of the palette, in CSS px: every centre and margin to the pixel. */
const paletteGeometry = (page: import("@playwright/test").Page) =>
	page.evaluate(() => {
		const R = (e: Element) => e.getBoundingClientRect();
		const slot = document.querySelector(
			"[aria-label='more colors']",
		) as HTMLElement;
		const pal = document.querySelector(".palette") as HTMLElement;
		const tile = pal.querySelector(".swatch.custom") as HTMLElement;
		const dots = [...pal.querySelectorAll(".swatch:not(.custom)")].map(R);
		const pr = R(pal);
		const rule = R(pal.querySelector(".palette-rule") as HTMLElement);
		const tr = R(tile);
		const svg = tile.querySelector("svg") as SVGElement;
		const sv = R(svg);
		const top = Math.min(...dots.map((d) => d.top));
		const bottom = Math.max(...dots.map((d) => d.bottom));
		const cols = [...new Set(dots.map((d) => d.left))].sort((a, b) => a - b);
		const lastRight = Math.max(...dots.map((d) => d.right));
		const sr = R(slot);
		return {
			tileSize: [tr.width, tr.height],
			dotSize: [dots[0].width, dots[0].height],
			plusCx: sv.left + sv.width / 2 - (tr.left + tr.width / 2),
			plusCy: sv.top + sv.height / 2 - (tr.top + tr.height / 2),
			gridCy: (top + bottom) / 2,
			tileCy: tr.top + tr.height / 2,
			ruleCy: rule.top + rule.height / 2,
			ruleGapLeft: rule.left - lastRight,
			ruleGapRight: tr.left - rule.right,
			padLeft: dots[0].left - pr.left,
			padRight: pr.right - tr.right,
			padTop: top - pr.top,
			padBottom: pr.bottom - bottom,
			colSteps: cols.slice(1).map((c, i) => c - cols[i]),
			cardCx: pr.left + pr.width / 2,
			slotCx: sr.left + sr.width / 2,
		};
	});

test("the palette is centred to the pixel: equal margins and columns, the dashed tile level with the grid", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1700, height: 900 });
	await page.locator("[aria-label='more colors']").click();
	await expect(page.locator(".palette")).toBeVisible();
	await page.waitForTimeout(250); // the card has come in
	const g = await paletteGeometry(page);
	const near = (a: number, b: number, what: string) =>
		expect(Math.abs(a - b), what).toBeLessThanOrEqual(0.5);
	expect(g.tileSize).toEqual(g.dotSize);
	near(g.plusCx, 0, "the plus is in the middle of the tile (x)");
	near(g.plusCy, 0, "the plus is in the middle of the tile (y)");
	near(g.tileCy, g.gridCy, "tile level with the grid");
	near(g.ruleCy, g.gridCy, "rule level with the grid");
	near(
		g.ruleGapLeft,
		g.ruleGapRight,
		"rule equally far from the grid and the tile",
	);
	near(g.padLeft, g.padRight, "left and right");
	near(g.padTop, g.padBottom, "top and bottom");
	near(g.padLeft, g.padTop, "sides and top");
	for (const step of g.colSteps) near(step, g.colSteps[0], "column step");
	near(g.cardCx, g.slotCx, "the card under the fourth place");
});

/**
 * The fourth place, as pixels: a screenshot of it with a pink colour in it, and the centre of mass of
 * the colour compared with that of the rainbow ring round it. They must agree to half a pixel of the
 * device, at every pixel ratio (the ring and the colour are one SVG, so a rounding cannot split them).
 */
const centres = (page: import("@playwright/test").Page, png: Buffer) =>
	page.evaluate(async (b64) => {
		const img = new Image();
		img.src = `data:image/png;base64,${b64}`;
		await img.decode();
		const cv = document.createElement("canvas");
		cv.width = img.width;
		cv.height = img.height;
		const ctx = cv.getContext("2d") as CanvasRenderingContext2D;
		ctx.drawImage(img, 0, 0);
		const { data, width, height } = ctx.getImageData(
			0,
			0,
			img.width,
			img.height,
		);
		const px = (x: number, y: number) => {
			const i = (y * width + x) * 4;
			return [data[i], data[i + 1], data[i + 2]];
		};
		const bg = px(0, 0);
		const dist = (a: number[], b: number[]) =>
			Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
		const pink = [233, 30, 99];
		const cx0 = width / 2;
		const cy0 = height / 2;
		const k = width / 40; // device px per CSS px
		// First the colour: pink pixels well inside the gap (the ring is 2px further out, and also red).
		let dot = { w: 0, x: 0, y: 0 };
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const r = Math.hypot(x + 0.5 - cx0, y + 0.5 - cy0) / k;
				if (r < 9.6 && dist(px(x, y), pink) < 90)
					dot = { w: dot.w + 1, x: dot.x + x + 0.5, y: dot.y + y + 0.5 };
			}
		}
		const dc = [dot.x / dot.w, dot.y / dot.w];
		// Then the ring: everything that is not the background and lies beyond the gap, measured from
		// the colour's own middle, so that a shifted picture cannot cut the ring on one side.
		let ring = { w: 0, x: 0, y: 0 };
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const r = Math.hypot(x + 0.5 - dc[0], y + 0.5 - dc[1]) / k;
				if (r > 10.4 && dist(px(x, y), bg) > 40)
					ring = { w: ring.w + 1, x: ring.x + x + 0.5, y: ring.y + y + 0.5 };
			}
		}
		return {
			size: width,
			dotCount: dot.w,
			ringCount: ring.w,
			dot: [dot.x / dot.w, dot.y / dot.w],
			ring: [ring.x / ring.w, ring.y / ring.w],
		};
	}, png.toString("base64"));

for (const dpr of [1, 1.25, 1.5, 2]) {
	test.describe(`the fourth place at a pixel ratio of ${dpr}`, () => {
		test.use({ deviceScaleFactor: dpr });
		test("the colour sits in the middle of the rainbow ring", async ({
			page,
		}) => {
			await page.addInitScript(() =>
				localStorage.setItem("inkroom.extraColor", "#e91e63"),
			);
			await page.setViewportSize({ width: 1700, height: 900 });
			await page.reload();
			const slot = page.locator("[aria-label='more colors']");
			await expect(slot).toBeVisible();
			await page.mouse.move(5, 500); // no hover: the ring stands still
			const png = await slot.screenshot();
			const c = await centres(page, png);
			expect(c.dotCount).toBeGreaterThan(20);
			expect(c.ringCount).toBeGreaterThan(40);
			// the colour and the ring have one centre, to half a device pixel
			expect(Math.abs(c.dot[0] - c.ring[0])).toBeLessThanOrEqual(0.5);
			expect(Math.abs(c.dot[1] - c.ring[1])).toBeLessThanOrEqual(0.5);
			// and it is the middle of the place
			expect(Math.abs(c.dot[0] - c.size / 2)).toBeLessThanOrEqual(1);
			expect(Math.abs(c.dot[1] - c.size / 2)).toBeLessThanOrEqual(1);
		});
	});
}
