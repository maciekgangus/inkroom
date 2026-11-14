import { expect, test } from "@playwright/test";
import { E2E_LOGIN } from "./helpers";

/** Another person's cursor sits on the board, so it moves with the content while the view is panned. */
test("another person's cursor follows the board at every step of a pan", async ({
	browser,
}) => {
	const ctx = await browser.newContext({
		viewport: { width: 1200, height: 800 },
	});
	await ctx.request.post("/api/login", { data: E2E_LOGIN });
	const board = await (
		await ctx.request.post("/api/boards", { data: { name: "c" } })
	).json();
	const a = await ctx.newPage();
	const b = await ctx.newPage();
	for (const p of [a, b]) {
		await p.goto(`/b/${board.id}`);
		await p.waitForSelector(".participants");
	}
	await b.mouse.move(400, 400);
	await b.mouse.move(420, 410);
	const cursor = a.locator(".cursor").first();
	const at = () => cursor.evaluate((el) => (el as HTMLElement).style.transform);
	await expect.poll(at).toBe("translate(420px, 410px)");

	const pan = async (button: "left" | "middle", tool?: string) => {
		if (tool) await a.keyboard.press(tool);
		await a.mouse.move(600, 600);
		await a.mouse.down({ button });
		for (let i = 1; i <= 5; i++) {
			await a.mouse.move(600 + i * 20, 600 + i * 10);
			// Right after each move, long before the view settles: the cursor is already there.
			await expect
				.poll(at, { timeout: 100 })
				.toBe(
					`translate(${420 + i * 20 + panned[0]}px, ${410 + i * 10 + panned[1]}px)`,
				);
		}
		await a.mouse.up({ button });
		panned[0] += 100;
		panned[1] += 50;
	};
	const panned = [0, 0];
	await pan("left", "m"); // the hand tool
	await pan("middle"); // the middle button
	await ctx.close();
});

test("the tile of the selection steps aside while the view is panned and comes back after", async ({
	page,
}) => {
	const { openBoard, pen } = await import("./helpers");
	await openBoard(page);
	await pen(page, [200, 500], [500, 500]);
	await page.keyboard.press("Escape");
	await page.mouse.click(350, 500);
	await expect(page.locator(".panel-tile")).toBeVisible();
	await page.keyboard.press("m");
	await page.mouse.move(600, 600);
	await page.mouse.down();
	await page.mouse.move(650, 620, { steps: 4 });
	await expect(page.locator(".panel-tile")).toHaveCount(0, { timeout: 150 });
	await page.mouse.move(700, 640, { steps: 4 });
	await page.mouse.up();
	await expect(page.locator(".panel-tile")).toBeVisible();
});
