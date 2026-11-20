import { expect, test } from "@playwright/test";
import { openBoard } from "./helpers";

// The e2e build is stamped "e2e-1" and so is its server (see playwright.config.ts). WebKit's run
// uses a server and a build the script started, which are not.
test.skip(
	process.env.E2E_ENGINE === "webkit",
	"needs the e2e build stamped with a release",
);

const serverSays = (page: import("@playwright/test").Page, version: string) =>
	page.route("**/api/config", (route) =>
		route.fulfill({
			json: { turnstileSiteKey: "", google: false, version },
		}),
	);

test("no banner while the server runs the release the page was loaded with (R-099)", async ({
	page,
}) => {
	await openBoard(page);
	await page.waitForTimeout(500);
	await expect(page.locator(".update-banner")).toHaveCount(0);
});

test("a newer release shows a banner that can be dismissed, and it stays away for that release (R-099)", async ({
	page,
}) => {
	await serverSays(page, "e2e-2");
	await openBoard(page);
	const banner = page.locator(".update-banner");
	await expect(banner).toBeVisible();
	await expect(banner).toContainText("Dostępna nowa wersja Inkroom");
	// calm: a card at the bottom that fits the screen and does not cover the top bar
	const box = (await banner.boundingBox()) as NonNullable<
		Awaited<ReturnType<typeof banner.boundingBox>>
	>;
	const vp = page.viewportSize() as { width: number; height: number };
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
	expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
	expect(box.height).toBeGreaterThanOrEqual(44);

	await banner.getByRole("button", { name: "Zamknij" }).click();
	await expect(banner).toHaveCount(0);
	await page.reload();
	await page.waitForSelector(".participants");
	await page.waitForTimeout(500);
	await expect(banner).toHaveCount(0); // the same release is not announced again
});

test("Odśwież reloads the page (R-099)", async ({ page }) => {
	await serverSays(page, "e2e-3");
	await openBoard(page);
	await expect(page.locator(".update-banner")).toBeVisible();
	await page.evaluate(() => {
		(window as unknown as { marker: string }).marker = "old page";
	});
	await Promise.all([
		page.waitForEvent("load"),
		page.getByRole("button", { name: "Odśwież" }).click(),
	]);
	await page.waitForSelector(".topbar");
	expect(
		await page.evaluate(
			() => (window as unknown as { marker?: string }).marker,
		),
	).toBeUndefined();
});

test("the banner waits for the pen to go up before it appears (R-099)", async ({
	page,
}) => {
	// the answer about the release is held back until a stroke is going on
	let release: () => void = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/api/config", async (route) => {
		await held;
		await route.fulfill({
			json: { turnstileSiteKey: "", google: false, version: "e2e-4" },
		});
	});
	await openBoard(page);
	const canvas = page.locator("canvas#board");
	const b = (await canvas.boundingBox()) as NonNullable<
		Awaited<ReturnType<typeof canvas.boundingBox>>
	>;
	await page.mouse.move(b.x + 300, b.y + 300);
	await page.mouse.down();
	await page.mouse.move(b.x + 340, b.y + 320, { steps: 3 });
	release();
	await page.waitForTimeout(600);
	await expect(page.locator(".update-banner")).toHaveCount(0);
	await page.mouse.up();
	await expect(page.locator(".update-banner")).toBeVisible();
});
