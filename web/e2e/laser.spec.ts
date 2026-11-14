import { expect, test } from "@playwright/test";
import { E2E_LOGIN } from "./helpers";

/** How many pixels of the live layer are red (the laser is #ff1744). */
const red = (page: import("@playwright/test").Page) =>
	page.evaluate(() => {
		const c = document.querySelector<HTMLCanvasElement>("canvas#live");
		const ctx = c?.getContext("2d");
		if (!c || !ctx) return 0;
		const d = ctx.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		for (let i = 0; i < d.length; i += 4)
			if (d[i + 3] > 20 && d[i] > 200 && d[i + 1] < 90) n++;
		return n;
	});

test("the laser pointer is seen by the other person, fades away and leaves nothing", async ({
	browser,
}) => {
	const ctx = await browser.newContext({
		viewport: { width: 1200, height: 800 },
	});
	await ctx.request.post("/api/login", { data: E2E_LOGIN });
	const board = await (
		await ctx.request.post("/api/boards", { data: { name: "laser" } })
	).json();
	const a = await ctx.newPage();
	const b = await ctx.newPage();
	for (const p of [a, b]) {
		await p.goto(`/b/${board.id}`);
		await p.waitForSelector(".participants");
	}
	await a.keyboard.press("KeyP");
	await expect(a.locator("[aria-label='laser']")).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await a.mouse.move(300, 400);
	await a.mouse.down();
	await a.mouse.move(700, 450, { steps: 12 });
	// Seen at once by the one who points, and by the other person
	await expect.poll(() => red(a)).toBeGreaterThan(50);
	await expect.poll(() => red(b)).toBeGreaterThan(50);
	await a.mouse.up();
	// ... and gone after a moment
	await expect.poll(() => red(a), { timeout: 5000 }).toBe(0);
	await expect.poll(() => red(b), { timeout: 5000 }).toBe(0);
	// It was never a drawing: nothing on the board, not even after a reload
	await b.reload();
	await b.waitForSelector(".participants");
	const count = await b.evaluate(async (id) => {
		return (await (await fetch(`/api/boards/${id}/preview`)).json()).strokes
			.length;
	}, board.id);
	expect(count).toBe(0);
	await ctx.close();
});
