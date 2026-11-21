import { expect, test } from "@playwright/test";
import { E2E_LOGIN } from "./helpers";

// Following someone (R-093) must cost nothing once the view has arrived: the easing loop stops
// when the view is where it should be and starts again when the other person moves (R-100
// follow-up: the loop ran at 60 frames a second for as long as anyone was followed).

test("a follower at rest asks for no animation frames, and still follows a new move", async ({
	page,
	browser,
	baseURL,
}) => {
	const req = page.context().request;
	await req.post("/api/login", { data: E2E_LOGIN });
	const board = await (
		await req.post("/api/boards", { data: { name: "follow idle" } })
	).json();
	await page.goto(`/b/${board.id}`);
	await page.waitForSelector(".participants");

	const guest = await browser.newContext({ baseURL });
	await guest.addInitScript(() => {
		const w = window as unknown as { __raf: number };
		w.__raf = 0;
		const raf = window.requestAnimationFrame.bind(window);
		window.requestAnimationFrame = (fn) => {
			w.__raf++;
			return raf(fn);
		};
	});
	const gp = await guest.newPage();
	await gp.goto(`/b/${board.id}`);
	await gp.fill('input[name="name"]', "Gosc");
	await gp.press('input[name="name"]', "Enter");
	await gp.waitForSelector(".participants");
	await gp.locator(".participants button.participant").first().click();
	await expect(gp.locator(".follow-chip")).toBeVisible();

	// the view has arrived: from now on nothing may ask for frames
	await gp.waitForTimeout(1500);
	await gp.evaluate(() => {
		(window as unknown as { __raf: number }).__raf = 0;
	});
	await gp.waitForTimeout(3000);
	const frames = await gp.evaluate(
		() => (window as unknown as { __raf: number }).__raf,
	);
	expect(frames).toBeLessThan(10); // it was about 180 in 3 s

	// and the follower still goes where the other person goes
	await page.locator("[aria-label='zoom in']").click();
	await expect(gp.locator("[aria-label='zoom reset']")).not.toHaveText(
		/^100%$/,
	);
	await guest.close();
});
