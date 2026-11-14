import { expect, test } from "@playwright/test";
import { E2E_LOGIN } from "./helpers";

test("renaming from a tile keeps the field and the button inside the tile", async ({
	page,
}) => {
	const req = page.context().request;
	await req.post("/api/login", { data: E2E_LOGIN });
	await req.post("/api/boards", { data: { name: "Matematyka klasa 3" } });
	await page.goto("/");
	await page.waitForSelector(".boards.tiles .board");
	const tile = page.locator(".boards.tiles .board").first();
	const before = await tile.boundingBox();
	await tile.getByRole("button", { name: "Zmień nazwę" }).click();
	const field = tile.locator("input[name=rename]");
	await expect(field).toBeVisible();
	const after = await tile.boundingBox();
	const box = await field.boundingBox();
	const save = await tile.getByRole("button", { name: "Zapisz" }).boundingBox();
	expect(after?.width).toBeCloseTo(before?.width ?? 0, 0); // the tile does not grow
	for (const b of [box, save]) {
		expect(b?.x).toBeGreaterThanOrEqual((after?.x ?? 0) - 0.5);
		expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(
			(after?.x ?? 0) + (after?.width ?? 0) + 0.5,
		);
	}
	// Typing and saving renames it right there.
	await field.fill("Fizyka");
	await tile.getByRole("button", { name: "Zapisz" }).click();
	await expect(tile.locator(".name")).toHaveText("Fizyka");
});
