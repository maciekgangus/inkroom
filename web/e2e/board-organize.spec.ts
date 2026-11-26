import { expect, type Page, test } from "@playwright/test";
import { E2E_LOGIN } from "./helpers";

/** Picks a folder or view in the left sidebar (desktop/landscape) or mobile drawer (portrait). */
async function pickNav(page: Page, label: string) {
	const sidebar = page.locator(".panel-sidebar");
	if (await sidebar.isVisible()) {
		const btn = sidebar
			.locator("button.sidebar-item", { hasText: label })
			.first();
		await expect(btn).toBeVisible();
		await btn.click();
		return;
	}
	await page.locator(".mobile-folder-trigger").click();
	const drawer = page.locator(".sidebar-drawer");
	await expect(drawer).toBeVisible();
	const btn = drawer.locator("button.sidebar-item", { hasText: label }).first();
	await expect(btn).toBeVisible();
	await btn.click();
}

test("folders, labels, pinning, grouping and smart suggestions work end-to-end (R-121)", async ({
	page,
}, testInfo) => {
	// Short unique prefix with 5 boards so it always ranks at the top of suggestions even in a shared E2E DB.
	const tag = `Kurs${testInfo.parallelIndex}${Date.now().toString(36).slice(-4)}`;
	const req = page.context().request;
	await req.post("/api/login", { data: E2E_LOGIN });
	for (const topic of [
		"Algebra",
		"Geometria",
		"Funkcje",
		"Optyka",
		"Kinematyka",
	]) {
		await req.post("/api/boards", {
			data: { name: `${tag} - ${topic}` },
		});
	}

	await page.goto("/");
	await page.waitForSelector(".boards .board");

	// Smart suggestions start collapsed; expanding lets us apply in 1 click.
	const suggestionsToggle = page.locator(".org-suggestions-head");
	await expect(suggestionsToggle).toBeVisible();
	await suggestionsToggle.click();
	await expect(page.locator(".org-suggestion-item").first()).toBeVisible();
	const suggestion = page.locator(".org-suggestion-item", {
		hasText: tag,
	});
	// Other specs share this E2E account and can fill the top-4 suggestion slots (e.g. "iPad", "Nagrania").
	// Dismiss unrelated suggestions in this page's local state until our unique tag surfaces.
	for (let i = 0; i < 12 && (await suggestion.count()) === 0; i++) {
		const other = page
			.locator(".org-suggestion-item")
			.filter({ hasNotText: tag })
			.first();
		if ((await other.count()) === 0) break;
		await other.getByRole("button", { name: /^Odrzuć sugestię/ }).click();
	}
	await expect(suggestion).toBeVisible();
	await suggestion.getByRole("button", { name: "Zastosuj" }).click();
	await expect(page.locator(".panel-toast")).toContainText(tag);

	// The new folder appears in the sidebar / drawer and filters down to the 5 boards.
	await pickNav(page, tag);
	await expect(page.locator(".boards .board")).toHaveCount(5);

	// Pin the first board and verify its aria-pressed state persists after reload.
	const firstBoard = page.locator(".boards .board").first();
	await firstBoard.getByRole("button", { name: "Przypnij" }).click();
	await expect(
		firstBoard.getByRole("button", { name: "Odepnij" }),
	).toBeVisible();

	// Open Organize dialog from card overflow menu and create + attach a label via progressive disclosure.
	await firstBoard.getByRole("button", { name: "Więcej akcji" }).click();
	await firstBoard
		.locator(".action-popover")
		.getByRole("menuitem", { name: "Organizuj…" })
		.click();
	const dialog = page.locator(".org-dialog");
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Nowa etykieta" }).click();
	await dialog.locator('input[name="quickMarker"]').fill(`Pilne-${tag}`);
	await dialog
		.locator(".org-section")
		.filter({ hasText: "Etykiety" })
		.getByRole("button", { name: "Dodaj" })
		.click();
	await dialog.getByRole("button", { name: "Zapisz" }).click();
	await expect(
		firstBoard.locator(".board-tag", { hasText: `Pilne-${tag}` }),
	).toBeVisible();

	// Reload and confirm folder, pin, and label persisted in SQLite (sessionStorage also preserves folder).
	await page.reload();
	await page.waitForSelector(".boards .board");
	await expect(page.locator(".boards .board")).toHaveCount(5);
	await expect(
		page.locator(".boards .board .board-tag", { hasText: `Pilne-${tag}` }),
	).toHaveCount(1);

	// Switch back to all boards and group by folder.
	await pickNav(page, "Wszystko");
	await page.getByRole("button", { name: "Filtr", exact: true }).click();
	await page
		.locator(".filter-menu")
		.getByRole("button", { name: "Foldery", exact: true })
		.click();
	await expect(page.locator(".org-group-head", { hasText: tag })).toBeVisible();
});
