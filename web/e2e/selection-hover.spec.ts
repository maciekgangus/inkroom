import { expect, type Page, test } from "@playwright/test";
import { fingers, openBoard } from "./helpers";

/** Painted pixels of the live layer (hover outline, glow, handles) inside a screen rect, CSS px. */
const liveIn = (page: Page, x: number, y: number, w: number, h: number) =>
	page.evaluate(
		([x, y, w, h]) => {
			const c = document.querySelector<HTMLCanvasElement>("canvas#live");
			const ctx = c?.getContext("2d");
			if (!c || !ctx) return 0;
			const r = c.getBoundingClientRect();
			const k = c.width / r.width;
			const d = ctx.getImageData(
				(x - r.left) * k,
				(y - r.top) * k,
				w * k,
				h * k,
			).data;
			let n = 0;
			for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++;
			return n;
		},
		[x, y, w, h],
	);

/** Every painted pixel of the live layer. */
const livePainted = (page: Page) =>
	page.evaluate(() => {
		const c = document.querySelector<HTMLCanvasElement>("canvas#live");
		const ctx = c?.getContext("2d");
		if (!c || !ctx) return 0;
		const d = ctx.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++;
		return n;
	});

/** A pen hovering without touching the screen: a pointermove of type pen with no buttons (R-112). */
const penHover = (page: Page, x: number, y: number) =>
	page.evaluate(
		([x, y]) => {
			const live = document.querySelector("canvas#live") as HTMLCanvasElement;
			live.dispatchEvent(
				new PointerEvent("pointermove", {
					bubbles: true,
					cancelable: true,
					pointerId: 7,
					pointerType: "pen",
					isPrimary: true,
					clientX: x,
					clientY: y,
					pressure: 0,
					button: 0,
					buttons: 0,
				}),
			);
		},
		[x, y],
	);

/** Draws a horizontal stroke with the mouse and switches to the select tool. */
const drawLine = async (page: Page) => {
	await page.keyboard.press("KeyF"); // pen
	await page.mouse.move(300, 400);
	await page.mouse.down();
	await page.mouse.move(600, 400, { steps: 10 });
	await page.mouse.up();
	await page.keyboard.press("KeyQ"); // Zaznacz
};

// The hover region around the stroke, and a window of time past the 50 ms throttle.
const OVER = [380, 370, 140, 60] as const;
const AWAY = 600;

test("hover in the select tool outlines the object under the cursor, and clears on empty space (R-112)", async ({
	page,
}) => {
	await openBoard(page);
	await drawLine(page);
	await page.mouse.move(450, AWAY);
	await page.waitForTimeout(80);
	await page.mouse.move(450, 400); // over the stroke
	await expect.poll(() => liveIn(page, ...OVER)).toBeGreaterThan(20);
	await page.waitForTimeout(80);
	await page.mouse.move(450, AWAY); // empty space
	await expect.poll(() => liveIn(page, ...OVER)).toBe(0);
});

test("what hovers is what a click grabs", async ({ page }) => {
	await openBoard(page);
	await drawLine(page);
	await page.mouse.move(450, 400);
	await expect.poll(() => liveIn(page, ...OVER)).toBeGreaterThan(20);
	await page.mouse.click(450, 400);
	await expect(page.locator(".panel-tile")).toBeVisible();
});

test("a hovering pen highlights too, a finger never does", async ({ page }) => {
	await openBoard(page);
	await drawLine(page);
	await penHover(page, 450, 400);
	await expect.poll(() => liveIn(page, ...OVER)).toBeGreaterThan(20);
	await page.waitForTimeout(80);
	await penHover(page, 450, AWAY);
	await expect.poll(() => liveIn(page, ...OVER)).toBe(0);
	// A finger pans the view (R-070): no hover outline is ever drawn for it.
	await fingers(page, [[450, 400]], [[520, 400]]);
	await expect.poll(() => livePainted(page)).toBe(0);
});

test("changing the tool clears the hover at once", async ({ page }) => {
	await openBoard(page);
	await drawLine(page);
	await page.mouse.move(450, 400);
	await expect.poll(() => liveIn(page, ...OVER)).toBeGreaterThan(20);
	await page.keyboard.press("KeyF"); // pen: the hover belongs to select only
	await page.mouse.move(451, 401); // any move with another tool keeps the hover off
	await expect.poll(() => liveIn(page, ...OVER)).toBe(0);
});
