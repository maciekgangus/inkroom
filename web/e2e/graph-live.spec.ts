import { expect, test } from "@playwright/test";
import { E2E_LOGIN } from "./helpers";

/** Pixels of the board layer in the red of the first function colour (#d32f2f). */
const redPixels = (page: import("@playwright/test").Page) =>
	page.evaluate(() => {
		const c = document.querySelector<HTMLCanvasElement>("#board");
		const ctx = c?.getContext("2d");
		if (!c || !ctx) return 0;
		const d = ctx.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		for (let i = 0; i < d.length; i += 4)
			if (d[i] > 180 && d[i + 1] < 90 && d[i + 2] < 90 && d[i + 3] > 200) n++;
		return n;
	});

test("a function graph is seen at once by the other person, without a reload (R-092)", async ({
	browser,
}) => {
	const ctx = await browser.newContext({
		viewport: { width: 1200, height: 800 },
		colorScheme: "light",
	});
	await ctx.request.post("/api/login", { data: E2E_LOGIN });
	const board = await (
		await ctx.request.post("/api/boards", { data: { name: "graph live" } })
	).json();
	const a = await ctx.newPage();
	const b = await ctx.newPage();
	for (const p of [a, b]) {
		await p.goto(`/b/${board.id}`);
		await p.waitForSelector(".participants");
	}
	// a plane is put on the board: the other person sees the sheet
	await a.locator("[aria-label='plane']").tap();
	await a.mouse.click(420, 420);
	await expect.poll(() => redPixels(a)).toBe(0);
	await a.locator(".panel-tile").tap();
	// a function added to it is drawn at the other person too (no red before)
	expect(await redPixels(b)).toBe(0);
	await a.locator("[aria-label='fn add']").tap();
	await a.locator("[aria-label='fn add linear']").tap();
	await expect.poll(() => redPixels(a)).toBeGreaterThan(100);
	await expect.poll(() => redPixels(b), { timeout: 5000 }).toBeGreaterThan(100);
	await ctx.close();
});

test("a changed coefficient and a changed colour reach the other person at once (R-092)", async ({
	browser,
}) => {
	const ctx = await browser.newContext({
		viewport: { width: 1200, height: 800 },
		colorScheme: "light",
	});
	await ctx.request.post("/api/login", { data: E2E_LOGIN });
	const board = await (
		await ctx.request.post("/api/boards", { data: { name: "graph live 2" } })
	).json();
	const a = await ctx.newPage();
	const b = await ctx.newPage();
	for (const p of [a, b]) {
		await p.goto(`/b/${board.id}`);
		await p.waitForSelector(".participants");
	}
	await a.locator("[aria-label='plane']").tap();
	await a.mouse.click(420, 420);
	await a.locator(".panel-tile").tap();
	await a.locator("[aria-label='fn add']").tap();
	await a.locator("[aria-label='fn add quad']").tap();
	await expect.poll(() => redPixels(b), { timeout: 5000 }).toBeGreaterThan(100);
	const id = await a.locator(".fn").first().getAttribute("data-fn");
	// the parabola is made wider: fewer red pixels inside the sheet, on both sides alike
	const before = await redPixels(b);
	const coef = a.locator(`[aria-label='fn ${id} coef 0']`);
	await coef.fill("0.2");
	await coef.blur();
	await expect.poll(() => redPixels(a)).not.toBe(before);
	const mine = await redPixels(a);
	await expect
		.poll(() => redPixels(b), { timeout: 5000 })
		.toBeGreaterThan(mine * 0.9);
	expect(await redPixels(b)).toBeLessThan(mine * 1.1);
	// the colour is changed: the red goes away at the other person too
	await a.locator(`[aria-label='fn ${id} colors']`).tap();
	await a.locator(`[aria-label^='fn ${id} color ']`).nth(1).tap();
	await expect.poll(() => redPixels(a)).toBe(0);
	await expect.poll(() => redPixels(b), { timeout: 5000 }).toBe(0);
	await ctx.close();
});

test("a connection that went silent is replaced when the page is looked at again, and the board is current (R-092)", async ({
	browser,
}) => {
	const ctx = await browser.newContext({
		viewport: { width: 1200, height: 800 },
		colorScheme: "light",
	});
	await ctx.request.post("/api/login", { data: E2E_LOGIN });
	const board = await (
		await ctx.request.post("/api/boards", { data: { name: "graph silent" } })
	).json();
	const a = await ctx.newPage();
	const b = await ctx.newPage();
	// The first connection of b goes silent when told to (it hears nothing more and its pings
	// are not answered); later ones are normal.
	let silent = false;
	let connections = 0;
	await b.routeWebSocket(/\/ws\//, (ws) => {
		const mine = ++connections;
		const server = ws.connectToServer();
		ws.onMessage((m) => server.send(m));
		server.onMessage((m) => {
			if (!(mine === 1 && silent)) ws.send(m);
		});
	});
	for (const p of [a, b]) {
		await p.goto(`/b/${board.id}`);
		await p.waitForSelector(".participants");
	}
	silent = true;
	await a.locator("[aria-label='plane']").tap();
	await a.mouse.click(420, 420);
	await a.locator(".panel-tile").tap();
	await a.locator("[aria-label='fn add']").tap();
	await a.locator("[aria-label='fn add linear']").tap();
	await expect.poll(() => redPixels(a)).toBeGreaterThan(100);
	// b is blind: it has seen nothing of it
	await b.waitForTimeout(500);
	expect(await redPixels(b)).toBe(0);
	// the page is looked at again: the silent connection is given up and the board comes back
	await b.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
	await expect
		.poll(() => redPixels(b), { timeout: 10_000 })
		.toBeGreaterThan(100);
	expect(connections).toBeGreaterThan(1);
	await ctx.close();
});
