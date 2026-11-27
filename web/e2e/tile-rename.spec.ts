import { expect, test } from "@playwright/test";
import { E2E_LOGIN } from "./helpers";

test("renaming from a tile or list row uses inline icon buttons without resizing and supports double-click", async ({
	page,
}, testInfo) => {
	const tag = `Rename-${testInfo.parallelIndex}-${Date.now().toString(36)}`;
	const req = page.context().request;
	await req.post("/api/login", { data: E2E_LOGIN });
	const res = await req.post("/api/boards", {
		data: { name: `Matematyka ${tag}` },
	});
	const created = (await res.json()) as { id: string };
	await page.goto("/");
	await page.waitForSelector(".boards.tiles .board");
	const tile = page
		.locator(`.boards.tiles .board:has(a[href="/b/${created.id}"])`)
		.first();
	const before = await tile.boundingBox();
	await tile.getByRole("button", { name: "Więcej akcji" }).click();
	await tile
		.locator(".action-popover")
		.getByRole("menuitem", { name: "Zmień nazwę" })
		.click();
	const field = tile.locator("input[name=rename]");
	await expect(field).toBeVisible();
	const after = await tile.boundingBox();
	const box = await field.boundingBox();
	const saveBtn = tile.getByRole("button", { name: "Zapisz" });
	const cancelBtn = tile.getByRole("button", { name: "Anuluj" });
	const save = await saveBtn.boundingBox();
	const cancel = await cancelBtn.boundingBox();
	expect(after?.width).toBeCloseTo(before?.width ?? 0, 0); // the tile does not grow
	expect((await saveBtn.textContent())?.trim()).toBe("");
	expect((await cancelBtn.textContent())?.trim()).toBe("");
	expect(await saveBtn.locator("svg").count()).toBe(1);
	expect(await cancelBtn.locator("svg").count()).toBe(1);
	const fieldMidY = (box?.y ?? 0) + (box?.height ?? 0) / 2;
	for (const b of [box, save, cancel]) {
		expect(b?.x).toBeGreaterThanOrEqual((after?.x ?? 0) - 0.5);
		expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(
			(after?.x ?? 0) + (after?.width ?? 0) + 0.5,
		);
		const btnMidY = (b?.y ?? 0) + (b?.height ?? 0) / 2;
		expect(Math.abs(btnMidY - fieldMidY)).toBeLessThanOrEqual(4);
	}
	// Typing and saving renames it right there.
	await field.fill(`Fizyka ${tag}`);
	await saveBtn.click();
	await expect(tile.locator(".name")).toContainText(`Fizyka ${tag}`);

	// Double-clicking the title enters inline rename without navigating away.
	await tile.locator(".name-editable").dblclick();
	await expect(tile.locator("input[name=rename]")).toBeVisible();
	await tile.getByRole("button", { name: "Anuluj" }).click();
	await expect(tile.locator("input[name=rename]")).toHaveCount(0);

	// List view also uses inline icon buttons aligned on a single row.
	await page.getByRole("button", { name: /lista/i }).first().click();
	const row = page
		.locator(`.boards:not(.tiles) .board:has(a[href="/b/${created.id}"])`)
		.first();
	await expect(row).toBeVisible();
	await row.getByRole("button", { name: "Więcej akcji" }).click();
	await row
		.locator(".action-popover")
		.getByRole("menuitem", { name: "Zmień nazwę" })
		.click();
	const renamingRow = page
		.locator(".boards:not(.tiles) .board.board-renaming")
		.first();
	const listField = renamingRow.locator("input[name=rename]");
	const listSave = renamingRow.getByRole("button", { name: "Zapisz" });
	const listCancel = renamingRow.getByRole("button", { name: "Anuluj" });
	await expect(listField).toBeVisible();
	expect((await listSave.textContent())?.trim()).toBe("");
	expect((await listCancel.textContent())?.trim()).toBe("");
	expect(await listSave.locator("svg").count()).toBe(1);
	expect(await listCancel.locator("svg").count()).toBe(1);
	const listBox = await listField.boundingBox();
	const listSaveBox = await listSave.boundingBox();
	expect(
		Math.abs(
			(listBox?.y ?? 0) +
				(listBox?.height ?? 0) / 2 -
				((listSaveBox?.y ?? 0) + (listSaveBox?.height ?? 0) / 2),
		),
	).toBeLessThanOrEqual(4);
	await listField.fill(`Chemia ${tag}`);
	await listSave.click();
	await expect(row.locator(".name")).toContainText(`Chemia ${tag}`);
});
