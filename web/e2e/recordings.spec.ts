import { expect, type Page, test } from "@playwright/test";
import { E2E_LOGIN } from "./helpers";

async function seedBoardWithRecording(page: Page) {
	const req = page.context().request;
	const login = await req.post("/api/login", { data: E2E_LOGIN });
	expect(login.ok()).toBe(true);

	const boardRes = await req.post("/api/boards", {
		data: { name: "Nagrania iPad" },
	});
	expect(boardRes.ok()).toBe(true);
	const board = (await boardRes.json()) as { id: string };

	const startRes = await req.post(`/api/boards/${board.id}/recordings`, {
		data: { name: "Lekcja testowa", mime: "audio/webm" },
	});
	expect(startRes.ok()).toBe(true);
	const rec = (await startRes.json()) as { id: string };

	const partAddr = (await (
		await req.post(`/api/boards/${board.id}/recordings/${rec.id}/parts/1`)
	).json()) as { url: string };
	expect(
		(
			await req.put(partAddr.url, { data: Buffer.from("webm-audio-data") })
		).ok(),
	).toBe(true);

	const snapAddr = (await (
		await req.post(`/api/boards/${board.id}/recordings/${rec.id}/events/0`)
	).json()) as { url: string };
	expect(
		(
			await req.put(snapAddr.url, {
				data: JSON.stringify({
					v: 1,
					background: "grid",
					view: { minX: 0, minY: 0, maxX: 800, maxY: 600 },
					win: { w: 800, h: 600 },
					strokes: [
						{
							id: "s1",
							authorId: "a",
							color: "#111111",
							size: 4,
							z: 1,
							kind: "line",
							points: [
								[100, 100, 0.5],
								[260, 180, 0.5],
							],
						},
					],
				}),
			})
		).ok(),
	).toBe(true);

	const finishRes = await req.post(
		`/api/boards/${board.id}/recordings/${rec.id}/finish`,
		{ data: { durationMs: 65_000 } },
	);
	expect(finishRes.ok()).toBe(true);

	return { boardId: board.id, recId: rec.id };
}

function assertInViewport(
	box: { x: number; y: number; width: number; height: number } | null,
	vp: { width: number; height: number } | null,
	label: string,
) {
	if (!box || !vp) throw new Error(`missing box/viewport for ${label}`);
	expect(box.x, `${label} left`).toBeGreaterThanOrEqual(0);
	expect(box.y, `${label} top`).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width, `${label} right`).toBeLessThanOrEqual(vp.width + 1);
	expect(box.y + box.height, `${label} bottom`).toBeLessThanOrEqual(
		vp.height + 1,
	);
}

test("owner opens recordings menu without overlapping logo and sees controls and list", async ({
	page,
}) => {
	const { boardId, recId } = await seedBoardWithRecording(page);
	await page.goto(`/b/${boardId}`);
	await page.waitForSelector(".topbar");
	await page.waitForSelector(".participants");

	const logo = await page.locator("a.brand-corner").boundingBox();
	const btn = page.locator(".topbar [aria-label='Nagrania']");
	await expect(btn).toBeVisible();
	const btnBox = await btn.boundingBox();
	if (!logo || !btnBox) throw new Error("missing logo or recordings button");
	const apart =
		btnBox.x >= logo.x + logo.width + 4 ||
		btnBox.y >= logo.y + logo.height + 4 ||
		btnBox.x + btnBox.width <= logo.x ||
		btnBox.y + btnBox.height <= logo.y;
	expect(apart, "Nagrania button overlaps logo").toBe(true);

	await btn.tap();
	const dialog = page.locator(".recordings-pop");
	await expect(dialog).toBeVisible();
	assertInViewport(
		await dialog.boundingBox(),
		page.viewportSize(),
		".recordings-pop",
	);
	await expect(dialog.getByRole("button", { name: "Nagrywaj" })).toBeVisible();
	await expect(dialog.getByText("Lekcja testowa")).toBeVisible();
	await expect(
		dialog.locator(`a[href='/b/${boardId}/r/${recId}']`),
	).toBeVisible();
	await expect(
		dialog.locator("[aria-label='Zmień nazwę nagrania']"),
	).toBeVisible();
	await expect(dialog.locator("[aria-label='Usuń nagranie']")).toBeVisible();
});

test("guest lists and can open replay, without record, rename or delete controls", async ({
	page,
	browser,
	baseURL,
}) => {
	const { boardId, recId } = await seedBoardWithRecording(page);
	const guest = await browser.newContext({
		baseURL,
		viewport: page.viewportSize() ?? undefined,
		hasTouch: true,
	});
	const gp = await guest.newPage();
	await gp.goto(`/b/${boardId}`);
	await gp.fill('input[name="name"]', "Uczeń");
	await gp.press('input[name="name"]', "Enter");
	await gp.waitForSelector(".participants");

	await gp.locator(".topbar [aria-label='Nagrania']").tap();
	const dialog = gp.locator(".recordings-pop");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText("Lekcja testowa")).toBeVisible();
	await expect(
		dialog.locator(`a[href='/b/${boardId}/r/${recId}']`),
	).toBeVisible();
	await expect(dialog.getByRole("button", { name: "Nagrywaj" })).toHaveCount(0);
	await expect(
		dialog.locator("[aria-label='Zmień nazwę nagrania']"),
	).toHaveCount(0);
	await expect(dialog.locator("[aria-label='Usuń nagranie']")).toHaveCount(0);
	await guest.close();
});

test("replay view fits viewport, has no errors, and keeps solid cards without blur on touch screens", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	page.on("console", (m) => {
		if (m.type() === "error") errors.push(m.text());
	});

	const { boardId, recId } = await seedBoardWithRecording(page);
	await page.goto(`/b/${boardId}/r/${recId}`);
	await page.waitForSelector(".replay-top");
	await page.waitForSelector(".replay-bar");

	const vp = page.viewportSize();
	assertInViewport(
		await page.locator(".replay-top").boundingBox(),
		vp,
		".replay-top",
	);
	const barBox = await page.locator(".replay-bar").boundingBox();
	assertInViewport(barBox, vp, ".replay-bar");
	const cornerBox = await page.locator(".corner").boundingBox();
	expect(barBox).not.toBeNull();
	expect(cornerBox).not.toBeNull();
	if (barBox && cornerBox) {
		const overlaps =
			barBox.x < cornerBox.x + cornerBox.width + 4 &&
			barBox.x + barBox.width > cornerBox.x - 4 &&
			barBox.y < cornerBox.y + cornerBox.height + 4 &&
			barBox.y + barBox.height > cornerBox.y - 4;
		expect(
			overlaps,
			`.replay-bar (${JSON.stringify(barBox)}) overlaps .corner (${JSON.stringify(cornerBox)})`,
		).toBe(false);
	}

	const cards = await page.evaluate(() =>
		[".replay-back", ".replay-name", ".replay-bar"].map((sel) => {
			const el = document.querySelector(sel);
			if (!el) return { sel, missing: true };
			const s = getComputedStyle(el);
			const bg = s.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
			return {
				sel,
				blur: s.backdropFilter,
				alpha: bg.length > 3 ? bg[3] : 1,
			};
		}),
	);
	for (const c of cards) {
		expect(c, c.sel).toMatchObject({ blur: "none", alpha: 1 });
	}
	expect(errors).toEqual([]);
});

test("video view renders controls and status cleanly within the viewport", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	page.on("console", (m) => {
		if (m.type() === "error") errors.push(m.text());
	});

	const { boardId, recId } = await seedBoardWithRecording(page);
	await page.goto(`/b/${boardId}/v/${recId}`);
	await page.waitForSelector(".video-page");
	await page.waitForSelector(".video-note");

	const vp = page.viewportSize();
	assertInViewport(
		await page.locator(".replay-top").boundingBox(),
		vp,
		".video-page .replay-top",
	);
	assertInViewport(
		await page.locator(".video-note").boundingBox(),
		vp,
		".video-note",
	);
	await expect(
		page.locator("a.replay-back", { hasText: "Tablica" }),
	).toBeVisible();
	await expect(
		page.locator("a.replay-back", { hasText: "Odtwórz na tablicy" }),
	).toBeVisible();
	await expect(page.getByText("Ta lekcja nie ma wideo")).toBeVisible();
	expect(errors).toEqual([]);
});
