import { expect, test } from "@playwright/test";
import { E2E_LOGIN } from "./helpers";

const BOARDS = 120;

test.describe("a panel with a great many boards", () => {
	test.beforeEach(async ({ page }) => {
		const req = page.context().request;
		await req.post("/api/login", { data: E2E_LOGIN });
		for (let i = 0; i < BOARDS; i += 20) {
			await Promise.all(
				Array.from({ length: 20 }, (_, j) =>
					req.post("/api/boards", { data: { name: `Tablica ${i + j}` } }),
				),
			);
		}
		await page.addInitScript(() =>
			localStorage.setItem("inkroom.boardView", "tiles"),
		);
	});

	test("tiles fill the width the screen offers, and the page scrolls down (no slider)", async ({
		page,
	}) => {
		await page.goto("/");
		await page.waitForSelector(".boards.tiles .board");
		const { columns, scrolls, sideways } = await page.evaluate(() => {
			const tiles = [
				...document.querySelectorAll<HTMLElement>(".boards.tiles .board"),
			];
			const panel = document.querySelector(".panel") as HTMLElement;
			return {
				columns: tiles.filter((t) => t.offsetTop === tiles[0].offsetTop).length,
				scrolls: panel.scrollHeight > panel.clientHeight,
				sideways: panel.scrollWidth > panel.clientWidth + 1,
			};
		});
		const vw = page.viewportSize()?.width ?? 0;
		expect(columns).toBeGreaterThanOrEqual(
			Math.floor((Math.min(vw, 1300) - 64) / 250),
		);
		expect(scrolls).toBe(true);
		expect(sideways).toBe(false);
	});

	test("only what is on the screen (and a little more) gets a picture", async ({
		page,
	}) => {
		let previews = 0;
		page.on("request", (r) => {
			if (r.url().includes("/preview")) previews++;
		});
		await page.goto("/");
		await page.waitForSelector(".boards.tiles .board");
		await page.waitForTimeout(1000);
		const first = previews;
		expect(first).toBeGreaterThan(0);
		expect(first).toBeLessThan(40); // a hundred boards do not mean a hundred requests

		// Scrolling to the end brings the last tiles into view, and their pictures.
		await page.evaluate(() => {
			const panel = document.querySelector(".panel") as HTMLElement;
			panel.scrollTop = panel.scrollHeight;
		});
		await expect.poll(() => previews).toBeGreaterThan(first);
		await expect
			.poll(() =>
				page.evaluate(() => {
					const tiles = [...document.querySelectorAll(".boards.tiles .board")];
					return !!tiles[tiles.length - 1].querySelector("img.preview");
				}),
			)
			.toBe(true);
	});

	test("the icons of a tile are big enough to hit", async ({ page }) => {
		await page.goto("/");
		await page.waitForSelector(".boards.tiles .board .actions button");
		const box = await page
			.locator(".boards.tiles .board .actions button")
			.first()
			.boundingBox();
		expect(box?.width).toBeGreaterThanOrEqual(40);
		expect(box?.height).toBeGreaterThanOrEqual(40);
	});
});
