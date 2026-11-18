import { expect, test } from "@playwright/test";
import { E2E_LOGIN } from "./helpers";

test("the board panel keeps its width and place when switching tiles and list (R-087)", async ({
	page,
}) => {
	const req = page.context().request;
	await req.post("/api/login", { data: E2E_LOGIN });
	await req.post("/api/boards", { data: { name: "Matematyka klasa 3" } });
	await page.goto("/");
	await page.waitForSelector(".boards.tiles .board");
	const measure = async () => {
		const list = await page.locator(".panel .boards").first().boundingBox();
		const form = await page.locator(".panel > form").first().boundingBox();
		return { listX: list?.x, listW: list?.width, formX: form?.x };
	};
	const tiles = await measure();
	await page.getByRole("button", { name: /lista/i }).first().click();
	await page.waitForSelector(".boards:not(.tiles) .board");
	const list = await measure();
	expect(list).toEqual(tiles);
});
