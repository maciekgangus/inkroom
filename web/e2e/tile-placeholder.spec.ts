import { expect, test } from "@playwright/test";
import { E2E_LOGIN } from "./helpers";

/** What a tile looks like for layout: its size and where its name stands. */
async function measure(page: import("@playwright/test").Page, tag: string) {
	return page.evaluate(
		(tag) =>
			[...document.querySelectorAll<HTMLElement>(".boards.tiles .board")]
				.filter((tile) =>
					tile.querySelector(".name")?.textContent?.endsWith(tag),
				)
				.map((tile) => {
					const t = tile.getBoundingClientRect();
					const n = tile.querySelector(".name")?.getBoundingClientRect();
					const p = tile.querySelector(".preview-box")?.getBoundingClientRect();
					const act = tile.querySelector(".actions")?.getBoundingClientRect();
					return {
						// Nothing on the tile may sit on top of the picture or of the name.
						overlap: Boolean(
							(p && n && n.top < p.bottom - 0.5) ||
								(n && act && act.top < n.bottom - 0.5),
						),
						w: Math.round(t.width * 10) / 10,
						h: Math.round(t.height * 10) / 10,
						nameY: n ? Math.round((n.y - t.y) * 10) / 10 : -1,
						boxH: p ? Math.round(p.height * 10) / 10 : -1,
					};
				}),
		tag,
	);
}

for (const mode of [
	"slow picture",
	"no stored picture (404), then drawn",
] as const) {
	test(`a tile keeps its size and its text in place while the picture loads: ${mode} (R-052, R-088)`, async ({
		page,
	}) => {
		const req = page.context().request;
		await req.post("/api/login", { data: E2E_LOGIN });
		// The e2e database is shared: tell this test's boards by a tag in the name.
		const tag = ` ${mode.slice(0, 4)}${Date.now() % 100000}`;
		for (const name of ["Fizyka", "Matematyka klasa 3", "Chemia"]) {
			const board = await (
				await req.post("/api/boards", { data: { name: name + tag } })
			).json();
			expect(board.id).toBeTruthy();
		}
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		await page.route("**/api/boards/*/preview*", async (route) => {
			await gate;
			if (mode === "slow picture") await route.continue();
			else if (route.request().url().includes("preview.png"))
				await route.fulfill({ status: 404, body: "" });
			else await route.continue();
		});
		await page.goto("/");
		await page.waitForSelector(".boards.tiles .board");
		// Loading: the pictures are held back, so every tile shows its placeholder.
		await page.waitForSelector(".preview-box.loading");
		// Other tests' boards share the page: bring each of ours into view so it starts loading.
		for (const name of ["Fizyka", "Matematyka klasa 3", "Chemia"])
			await page
				.locator(".boards.tiles .board", { hasText: name + tag })
				.scrollIntoViewIfNeeded();
		await page.waitForTimeout(300);
		const during = await measure(page, tag);
		expect(during.length).toBeGreaterThan(2);
		release();
		await page.waitForFunction(
			(tag) =>
				[...document.querySelectorAll(".boards.tiles .board")]
					.filter((t) => t.querySelector(".name")?.textContent?.endsWith(tag))
					.every((t) => !t.querySelector(".preview-box.loading")),
			tag,
		);
		await page.waitForTimeout(300);
		const after = await measure(page, tag);
		for (const [i, d] of during.entries()) {
			expect(after[i].h, `tile ${i} height`).toBeCloseTo(d.h, 0);
			expect(after[i].w, `tile ${i} width`).toBeCloseTo(d.w, 0);
			expect(after[i].nameY, `tile ${i} name y`).toBeCloseTo(d.nameY, 0);
			expect(after[i].boxH, `tile ${i} picture box`).toBeCloseTo(d.boxH, 0);
		}
		// The picture box is a real 4:3 frame the whole time, never a collapsed strip.
		for (const d of [...during, ...after]) {
			expect(d.overlap, "something sits on the picture or the name").toBe(
				false,
			);
			expect(d.boxH).toBeGreaterThan(80);
			expect(d.nameY).toBeGreaterThan(d.boxH);
		}
	});
}
