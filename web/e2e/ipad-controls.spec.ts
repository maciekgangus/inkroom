import { expect, test } from "@playwright/test";
import { fingers, ink, inkIn, openBoard, pen } from "./helpers";

test.beforeEach(async ({ page }) => {
	await openBoard(page);
});

/** Taps a tool and waits until it is the chosen one, so what follows does not outrun the app. */
async function chooseTool(page: import("@playwright/test").Page, tool: string) {
	await page.locator(`[aria-label='${tool}']`).tap();
	await expect(page.locator(`[aria-label='${tool}']`)).toHaveAttribute(
		"aria-pressed",
		"true",
	);
}

/** Asserts that an element is fully on the screen. */
async function onScreen(page: import("@playwright/test").Page, sel: string) {
	const { width: vw, height: vh } = page.viewportSize() ?? {
		width: 0,
		height: 0,
	};
	const box = await page.locator(sel).first().boundingBox();
	expect(box, sel).not.toBeNull();
	expect(box?.x, sel).toBeGreaterThanOrEqual(0);
	expect(box?.y, sel).toBeGreaterThanOrEqual(0);
	expect((box?.x ?? 0) + (box?.width ?? 0), sel).toBeLessThanOrEqual(vw);
	expect((box?.y ?? 0) + (box?.height ?? 0), sel).toBeLessThanOrEqual(vh);
}

test.describe("lists and panels stay on the screen", () => {
	test("the shape list opens whole", async ({ page }) => {
		await page.locator("[aria-label='shape']").tap(); // chooses the tool
		await page.locator("[aria-label='shape']").tap(); // opens its list
		await expect(page.locator(".shape-list")).toBeVisible();
		await onScreen(page, ".shape-list");
	});

	test("the colour palette opens whole", async ({ page }) => {
		await page.locator("[aria-label='more colors']").tap();
		await expect(page.locator(".palette")).toBeVisible();
		await onScreen(page, ".palette");
	});

	test("the board menu opens whole", async ({ page }) => {
		await page.locator("[aria-label='board menu']").tap();
		await onScreen(page, ".context-menu");
	});
});

test.describe("everyday drawing", () => {
	test("undo takes a stroke back and redo brings it again", async ({
		page,
	}) => {
		await pen(page, [200, 500], [500, 650]);
		await expect.poll(() => ink(page)).toBeGreaterThan(0);
		await page.locator("[aria-label='undo']").tap();
		await expect.poll(() => ink(page)).toBe(0);
		await page.locator("[aria-label='redo']").tap();
		await expect.poll(() => ink(page)).toBeGreaterThan(0);
	});

	test("the eraser removes a stroke the pen drew", async ({ page }) => {
		await pen(page, [200, 500], [500, 500]);
		await expect.poll(() => ink(page)).toBeGreaterThan(0);
		await page.locator("[aria-label='eraser']").tap();
		await pen(page, [350, 450], [350, 550]);
		await expect.poll(() => ink(page)).toBe(0);
	});

	test("a shape is drawn with the pen", async ({ page }) => {
		await page.locator("[aria-label='shape']").tap();
		await pen(page, [200, 500], [450, 700]);
		await expect.poll(() => ink(page)).toBeGreaterThan(0);
	});

	test("a selected stroke gets a panel that stays on the screen", async ({
		page,
	}) => {
		await pen(page, [200, 500], [500, 500]);
		await chooseTool(page, "select");
		await pen(page, [350, 500], [350, 500]); // a tap of the pencil
		await expect(page.locator(".properties")).toBeVisible();
		await onScreen(page, ".properties");
	});

	test("a stroke can be moved with the pen once selected", async ({ page }) => {
		const vh = page.viewportSize()?.height ?? 0;
		const [from, to] = [Math.round(vh * 0.4), Math.round(vh * 0.7)];
		await pen(page, [200, from], [500, from]);
		await chooseTool(page, "select");
		await pen(page, [350, from], [350, from]);
		await expect(page.locator(".properties")).toBeVisible();
		await expect
			.poll(() => inkIn(page, 150, from - 30, 400, 60))
			.toBeGreaterThan(0);
		await pen(page, [350, from], [350, to]);
		// Gone from where it was, there at its new place.
		await expect.poll(() => inkIn(page, 150, from - 30, 400, 60)).toBe(0);
		await expect
			.poll(() => inkIn(page, 150, to - 30, 400, 60))
			.toBeGreaterThan(0);
	});

	test("a tap on an empty place lets go of the selection", async ({ page }) => {
		const vh = page.viewportSize()?.height ?? 0;
		const y = Math.round(vh * 0.4);
		await pen(page, [200, y], [500, y]);
		await chooseTool(page, "select");
		await pen(page, [350, y], [350, y]);
		await expect(page.locator(".properties")).toBeVisible();
		await pen(page, [100, Math.round(vh * 0.8)], [100, Math.round(vh * 0.8)]);
		await expect(page.locator(".properties")).toHaveCount(0);
	});
});

test.describe("palm and fingers", () => {
	test("a finger resting while the pen draws does not add ink of its own", async ({
		page,
	}) => {
		await fingers(page, [[700, 900]], [[700, 950]]);
		await page.waitForTimeout(100);
		expect(await ink(page)).toBe(0);
	});
});
