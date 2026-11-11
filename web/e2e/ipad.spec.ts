import { expect, test } from "@playwright/test";
import { fingers, ink, openBoard, pen } from "./helpers";

test.beforeEach(async ({ page }) => {
	await openBoard(page);
});

test.describe("layout on an iPad screen", () => {
	test("the tool bar is one row (two on the smallest iPad), not a tower", async ({
		page,
	}, info) => {
		const box = await page.locator(".topbar .toolbar").boundingBox();
		const oneRow = info.project.name !== "ipad-mini";
		expect(box?.height).toBeLessThan(oneRow ? 64 : 110);
	});

	test("the top bar fits the screen, in at most two rows", async ({ page }) => {
		const vw = page.viewportSize()?.width ?? 0;
		const box = await page.locator(".topbar").boundingBox();
		expect(box?.x).toBeGreaterThanOrEqual(0);
		expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(vw);
		expect(box?.height).toBeLessThan(160);
	});

	test("nothing sticks out of the screen", async ({ page }) => {
		const { width: vw, height: vh } = page.viewportSize() ?? {
			width: 0,
			height: 0,
		};
		for (const sel of [
			".toolbar",
			".board-title",
			".participants",
			".zoom",
			".backgrounds",
			".minimap",
		]) {
			const box = await page.locator(sel).first().boundingBox();
			expect(box, sel).not.toBeNull();
			expect(box?.x, sel).toBeGreaterThanOrEqual(0);
			expect(box?.y, sel).toBeGreaterThanOrEqual(0);
			expect((box?.x ?? 0) + (box?.width ?? 0), sel).toBeLessThanOrEqual(vw);
			expect((box?.y ?? 0) + (box?.height ?? 0), sel).toBeLessThanOrEqual(vh);
		}
	});
});

test.describe("pen and finger", () => {
	test("the pen draws", async ({ page }) => {
		expect(await ink(page)).toBe(0);
		await pen(page, [200, 500], [500, 650]);
		await expect.poll(() => ink(page)).toBeGreaterThan(0);
	});

	test("one finger moves the board and leaves no ink", async ({ page }) => {
		await fingers(page, [[300, 600]], [[200, 650]]);
		await page.waitForTimeout(200);
		expect(await ink(page)).toBe(0);
	});

	test("two fingers pinching zoom the board", async ({ page }) => {
		const label = () => page.locator("[aria-label='zoom reset']").textContent();
		expect(await label()).toBe("100%");
		await fingers(
			page,
			[
				[300, 600],
				[400, 600],
			],
			[
				[200, 600],
				[500, 600],
			],
		);
		await expect.poll(label).not.toBe("100%");
	});

	test("a tap on a tool button chooses the tool", async ({ page }) => {
		await page.locator("[aria-label='eraser']").tap();
		await expect(page.locator("[aria-label='eraser']")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await page.locator("[aria-label='pen']").tap();
		await expect(page.locator("[aria-label='pen']")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});

	test("a tap on the board menu opens it", async ({ page }) => {
		await page.locator("[aria-label='board menu']").tap();
		await expect(page.locator(".context-menu")).toBeVisible();
	});
});
