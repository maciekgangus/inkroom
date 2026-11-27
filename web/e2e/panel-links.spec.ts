import { expect, test } from "@playwright/test";
import { E2E_LOGIN } from "./helpers";

// A board opens by a click on its name or its picture, but it must not look like a link: no
// underline and the colour of the text round it, in a list and in tiles.
for (const view of ["list", "tiles"]) {
	test(`in the ${view} the name of a board does not look like a link`, async ({
		page,
	}) => {
		const req = page.context().request;
		await req.post("/api/login", { data: E2E_LOGIN });
		await req.post("/api/boards", { data: { name: "Wyglad linku" } });
		await page.addInitScript(
			(v) => localStorage.setItem("inkroom.boardView", v),
			view,
		);
		await page.goto("/");
		await page.waitForSelector(".boards .board a.open-link");

		const look = await page.evaluate(() => {
			const a = document.querySelector(
				".boards .board a.open-link",
			) as HTMLElement;
			const name = a.querySelector(".name") ?? a;
			const s = getComputedStyle(name);
			return {
				underline: s.textDecorationLine,
				color: s.color,
				body: getComputedStyle(document.body).color,
				linkUnderline: getComputedStyle(a).textDecorationLine,
				linkColor: getComputedStyle(a).color,
			};
		});
		expect(look.underline).toBe("none");
		expect(look.linkUnderline).toBe("none");
		expect(look.color).toBe(look.body);
		expect(look.linkColor).toBe(look.body);
	});
}

test("clicking anywhere on a list row opens the board, while row controls stay interactive", async ({
	page,
}, testInfo) => {
	const name = `Klik wiersza ${testInfo.parallelIndex}-${Date.now().toString(36)}`;
	const req = page.context().request;
	await req.post("/api/login", { data: E2E_LOGIN });
	const res = await req.post("/api/boards", { data: { name } });
	const created = (await res.json()) as { id: string };
	await page.addInitScript(() =>
		localStorage.setItem("inkroom.boardView", "list"),
	);
	await page.goto("/");
	const row = page
		.locator(`.boards:not(.tiles) .board:has(a[href="/b/${created.id}"])`)
		.first();
	await expect(row).toBeVisible();

	// Clicking an action control on the row must not navigate away.
	await row.getByRole("button", { name: "Więcej akcji" }).click();
	await expect(row.locator(".action-popover")).toBeVisible();
	expect(page.url()).not.toContain(`/b/${created.id}`);
	await page.keyboard.press("Escape");

	// Clicking the empty area to the right of the board title opens the board.
	const mainBox = await row.locator(".board-list-main").boundingBox();
	const linkBox = await row.locator("a.open-link").boundingBox();
	const hitX = (mainBox?.x ?? 0) + (mainBox?.width ?? 0) - 16;
	const hitY = (mainBox?.y ?? 0) + (mainBox?.height ?? 0) / 2;
	expect(hitX).toBeGreaterThan((linkBox?.x ?? 0) + (linkBox?.width ?? 0) + 12);
	await page.mouse.click(hitX, hitY);
	await expect(page).toHaveURL(new RegExp(`/b/${created.id}$`));
});
