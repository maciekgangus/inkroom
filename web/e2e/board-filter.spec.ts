import { expect, test } from "@playwright/test";
import { E2E_LOGIN } from "./helpers";

test("the folded filter finds a board by name and brings the rest back when cleared (R-091)", async ({
	page,
}, testInfo) => {
	// Every device project and every run shares one database: the names carry a tag of their own.
	const tag = `${testInfo.project.name}-${Date.now()}`;
	const req = page.context().request;
	await req.post("/api/login", { data: E2E_LOGIN });
	await req.post("/api/boards", { data: { name: `Filtr Matematyka ${tag}` } });
	await req.post("/api/boards", { data: { name: `Filtr Fizyka ${tag}` } });
	await page.goto("/");
	await page.waitForSelector(".boards .board");
	await expect(page.locator('input[name="search"]')).toHaveCount(0);
	await page.getByRole("button", { name: "Filtr", exact: true }).click();
	await page
		.locator('input[name="search"]')
		.fill(`filtr fiz ${tag}`.toLowerCase());
	await expect(
		page.locator(".boards .board", { hasText: `Fizyka ${tag}` }),
	).toHaveCount(1);
	await expect(
		page.locator(".boards .board", { hasText: `Matematyka ${tag}` }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Wyczyść" }).click();
	await expect(
		page.locator(".boards .board", { hasText: `Matematyka ${tag}` }),
	).toHaveCount(1);
});
