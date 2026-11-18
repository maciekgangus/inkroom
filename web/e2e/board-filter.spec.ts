import { expect, test } from "@playwright/test";
import { E2E_LOGIN } from "./helpers";

test("the folded filter finds a board by name and brings the rest back when cleared (R-091)", async ({
	page,
}) => {
	const req = page.context().request;
	await req.post("/api/login", { data: E2E_LOGIN });
	await req.post("/api/boards", { data: { name: "Filtr Matematyka" } });
	await req.post("/api/boards", { data: { name: "Filtr Fizyka" } });
	await page.goto("/");
	await page.waitForSelector(".boards .board");
	await expect(page.locator('input[name="search"]')).toHaveCount(0);
	await page.getByRole("button", { name: "Filtr", exact: true }).click();
	await page.locator('input[name="search"]').fill("filtr fiz");
	await expect(
		page.locator(".boards .board", { hasText: "Fizyka" }),
	).toHaveCount(1);
	await expect(
		page.locator(".boards .board", { hasText: "Matematyka" }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Wyczyść" }).click();
	await expect(
		page.locator(".boards .board", { hasText: "Matematyka" }),
	).toHaveCount(1);
});
