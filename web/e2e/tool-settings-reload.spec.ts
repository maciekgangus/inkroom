import { expect, test } from "@playwright/test";
import { openBoard, pen } from "./helpers";

test.beforeEach(async ({ page }) => {
	await openBoard(page);
});

type Page = import("@playwright/test").Page;

/** The average colour of the painted pixels of the board inside a rectangle (screen CSS px). */
const meanColor = (page: Page, x: number, y: number, w: number, h: number) =>
	page.evaluate(
		([x, y, w, h]) => {
			const c = document.querySelector<HTMLCanvasElement>("canvas#board");
			const ctx = c?.getContext("2d");
			if (!c || !ctx) return null;
			const r = c.getBoundingClientRect();
			const k = c.width / r.width;
			const d = ctx.getImageData(
				(x - r.left) * k,
				(y - r.top) * k,
				w * k,
				h * k,
			).data;
			let n = 0;
			let red = 0;
			let blue = 0;
			for (let i = 0; i < d.length; i += 4) {
				if (d[i + 3] < 200) continue;
				n++;
				red += d[i];
				blue += d[i + 2];
			}
			return n ? { red: red / n, blue: blue / n } : null;
		},
		[x, y, w, h],
	);

const pressed = (page: Page, tool: string) =>
	page.locator(`[aria-label='${tool}']`).getAttribute("aria-pressed");

// The tools are picked with the toolbar buttons and the settings are seeded in the storage, not
// typed with keyboard shortcuts: the e2e account keeps its own shortcuts on the server (R-086),
// and shortcuts.spec.ts rebinds the pen on it, so the keys are not the same in every run.
const KEY = "inkroom.toolStyles";

test("the page opens with the last tool and each of pen and line draws with its own colour (R-097)", async ({
	page,
}) => {
	await page.evaluate(
		([key]) =>
			localStorage.setItem(
				key,
				JSON.stringify({
					colors: { pen: "#d32f2f", line: "#1976d2" },
					last: "line",
				}),
			),
		[KEY],
	);
	await page.reload();
	await page.waitForSelector(".participants");

	// the page opens with the line, not with the pen
	expect(await pressed(page, "line")).toBe("true");
	expect(await pressed(page, "pen")).not.toBe("true");
	await pen(page, [300, 300], [500, 300]);
	await expect
		.poll(async () => (await meanColor(page, 290, 290, 220, 20)) !== null)
		.toBe(true);
	const line = await meanColor(page, 290, 290, 220, 20);
	expect(line?.blue).toBeGreaterThan((line?.red ?? 0) + 50);

	// and the pen has its own colour
	await page.locator("[aria-label='pen']").tap();
	await pen(page, [300, 500], [500, 500]);
	await expect
		.poll(async () => (await meanColor(page, 290, 490, 220, 20)) !== null)
		.toBe(true);
	const stroke = await meanColor(page, 290, 490, 220, 20);
	expect(stroke?.red).toBeGreaterThan((stroke?.blue ?? 0) + 50);
});

test("the tool left in a page is kept for the next one, but never the eraser (R-097)", async ({
	page,
}) => {
	await page.locator("[aria-label='line']").tap();
	await page.locator("[aria-label='eraser']").tap();
	await page.reload();
	await page.waitForSelector(".participants");
	expect(await pressed(page, "line")).toBe("true");
	expect(await pressed(page, "eraser")).not.toBe("true");
	expect(
		await page.evaluate(
			([key]) => JSON.parse(localStorage.getItem(key) ?? "{}").last,
			[KEY],
		),
	).toBe("line");
});
