import { expect, test } from "@playwright/test";
import { E2E_LOGIN } from "./helpers";

test("always-visible search finds a board by name and brings the rest back when cleared (R-091)", async ({
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
	// Search is always ready while the filter/sort/group card stays folded.
	await expect(page.locator('input[name="search"]')).toBeVisible();
	await expect(page.locator(".filter-menu")).toHaveCount(0);
	await page
		.locator('input[name="search"]')
		.fill(`filtr fiz ${tag}`.toLowerCase());
	await expect(
		page.locator(".boards .board", { hasText: `Fizyka ${tag}` }),
	).toHaveCount(1);
	await expect(
		page.locator(".boards .board", { hasText: `Matematyka ${tag}` }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Skasuj tekst" }).click();
	await expect(
		page.locator(".boards .board", { hasText: `Matematyka ${tag}` }),
	).toHaveCount(1);
});

test("the filter card fits the screen and its pills are easy to hit (R-091)", async ({
	page,
}) => {
	await page.context().request.post("/api/login", { data: E2E_LOGIN });
	await page.goto("/");
	await page.waitForSelector(".boards .board");
	await page.getByRole("button", { name: "Filtr", exact: true }).click();
	const card = page.locator(".filter-menu");
	await expect(card).toBeVisible();
	const view = page.viewportSize();
	const box = await card.boundingBox();
	expect(box).not.toBeNull();
	expect((box?.x ?? -1) >= 0).toBe(true);
	expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
		view?.width ?? 0,
	);
	// no pill is cut off on the right, and a finger can hit each one
	const pills = await page.locator(".segmented button").all();
	expect(pills).toHaveLength(16);
	for (const p of pills) {
		const b = await p.boundingBox();
		expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(
			(box?.x ?? 0) + (box?.width ?? 0) + 1,
		);
		expect(b?.height ?? 0).toBeGreaterThanOrEqual(36);
	}
});
