import { expect, type Page, test } from "@playwright/test";
import { E2E_LOGIN } from "./helpers";

/** How far the name's text sits above (negative) or below the middle of its pill, in pixels. */
const offset = (page: Page, selector: string) =>
	page.evaluate((sel) => {
		const name = document.querySelector(sel) as HTMLElement;
		const box = name.closest(".board-title") as HTMLElement;
		const range = document.createRange();
		range.selectNodeContents(name);
		const t = range.getBoundingClientRect();
		const b = box.getBoundingClientRect();
		return t.top + t.height / 2 - (b.top + b.height / 2);
	}, selector);

test("somebody else's board has its name where the owner's has it", async ({
	page,
	browser,
	baseURL,
}) => {
	const req = page.context().request;
	await req.post("/api/login", { data: E2E_LOGIN });
	const board = await (
		await req.post("/api/boards", { data: { name: "tablica_hwdp" } })
	).json();

	// The owner's name is a button (it can be renamed): the reference for how it should sit.
	await page.goto(`/b/${board.id}`);
	await page.waitForSelector(".board-title button.name");
	const owners = await offset(page, ".board-title button.name");

	// A guest is not the owner, so the name is plain text.
	const guest = await browser.newContext({ baseURL });
	const gp = await guest.newPage();
	await gp.goto(`/b/${board.id}`);
	await gp.fill('input[name="name"]', "Gosc");
	await gp.press('input[name="name"]', "Enter");
	await gp.waitForSelector(".board-title span.name");
	const guests = await offset(gp, ".board-title span.name");

	expect(Math.abs(guests - owners)).toBeLessThan(1);
	await guest.close();
});
