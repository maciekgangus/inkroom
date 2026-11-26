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
		const { columns, gridWidth, scrolls, sideways } = await page.evaluate(
			() => {
				const tiles = [
					...document.querySelectorAll<HTMLElement>(".boards.tiles .board"),
				];
				const grid = document.querySelector(".boards.tiles") as HTMLElement;
				const panel = document.querySelector(".panel") as HTMLElement;
				return {
					columns: tiles.filter((t) => t.offsetTop === tiles[0].offsetTop)
						.length,
					gridWidth: grid.clientWidth,
					scrolls: panel.scrollHeight > panel.clientHeight,
					sideways: panel.scrollWidth > panel.clientWidth + 1,
				};
			},
		);
		const expectedCols = Math.max(2, Math.floor((gridWidth + 16) / 276));
		expect(columns).toBeGreaterThanOrEqual(expectedCols);
		expect(scrolls).toBe(true);
		expect(sideways).toBe(false);
	});

	test("only what is on the screen (and a little more) gets a picture", async ({
		page,
	}) => {
		// A tile may ask for its picture, its data and store the picture again (R-088), so count boards.
		const boards = new Set<string>();
		page.on("request", (r) => {
			const id = r.url().match(/\/api\/boards\/([^/]+)\/preview/)?.[1];
			if (id) boards.add(id);
		});
		await page.goto("/");
		await page.waitForSelector(".boards.tiles .board");
		await page.waitForTimeout(1000);
		const first = boards.size;
		expect(first).toBeGreaterThan(0);
		expect(first).toBeLessThan(40); // a hundred boards do not mean a hundred requests

		// Scrolling to the end brings the last tiles into view, and their pictures.
		await page.evaluate(() => {
			const panel = document.querySelector(".panel") as HTMLElement;
			panel.scrollTop = panel.scrollHeight;
		});
		await expect.poll(() => boards.size).toBeGreaterThan(first);
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
		await page.waitForSelector(".boards.tiles .board .board-controls button");
		const buttons = page
			.locator(".boards.tiles .board")
			.first()
			.locator(".board-controls button");
		const count = await buttons.count();
		expect(count).toBeGreaterThanOrEqual(2);
		for (let i = 0; i < count; i++) {
			const box = await buttons.nth(i).boundingBox();
			expect(box?.width).toBeGreaterThanOrEqual(40);
			expect(box?.height).toBeGreaterThanOrEqual(40);
		}
	});
});
