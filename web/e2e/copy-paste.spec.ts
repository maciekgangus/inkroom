import { expect, test } from "@playwright/test";
import { inkIn, openBoard, pen } from "./helpers";

test.beforeEach(async ({ context, page }) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await openBoard(page);
});

test.describe("Ctrl+C and Ctrl+V on the board (R-030, R-035)", () => {
	test("copies the selected stroke and pastes it where the pointer is", async ({
		page,
	}) => {
		await pen(page, [200, 500], [500, 500]);
		await page.keyboard.press("Escape"); // the select tool
		await page.mouse.click(350, 500); // selects the stroke
		await page.keyboard.press("Control+c");
		await page.mouse.move(350, 250);
		await page.keyboard.press("Control+v");
		await expect.poll(() => inkIn(page, 150, 200, 400, 100)).toBeGreaterThan(0);
	});

	test("puts the board JSON on the system clipboard", async ({ page }) => {
		await pen(page, [200, 500], [500, 500]);
		await page.keyboard.press("Escape");
		await page.mouse.click(350, 500);
		await page.keyboard.press("Control+c");
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toContain('"inkroom"');
	});

	test("pasting what was just copied here does not read it again from the text", async ({
		page,
	}) => {
		await pen(page, [200, 500], [500, 500]);
		await page.keyboard.press("Escape");
		await page.mouse.click(350, 500);
		await page.keyboard.press("Control+c");
		// A paste of a big selection spent its time checking every point of its own clipboard text.
		await page.evaluate(() => {
			const w = window as never as { reparsed: number };
			w.reparsed = 0;
			const parse = JSON.parse;
			JSON.parse = (text: string, ...rest: []) => {
				if (typeof text === "string" && text.startsWith('{"inkroom"'))
					w.reparsed++;
				return parse(text, ...rest);
			};
		});
		await page.mouse.move(350, 250);
		await page.keyboard.press("Control+v");
		await expect.poll(() => inkIn(page, 150, 200, 400, 100)).toBeGreaterThan(0);
		expect(
			await page.evaluate(
				() => (window as never as { reparsed: number }).reparsed,
			),
		).toBe(0);
	});

	test("holding Ctrl+V pastes once, not again and again", async ({ page }) => {
		await pen(page, [200, 500], [500, 500]);
		await page.keyboard.press("Escape");
		await page.mouse.click(350, 500);
		await page.keyboard.press("Control+c");
		await page.mouse.move(350, 250);
		await page.keyboard.down("Control");
		for (let i = 0; i < 8; i++) await page.keyboard.down("v"); // the key repeats while held
		await page.keyboard.up("v");
		await page.keyboard.up("Control");
		await page.waitForTimeout(700);
		const count = await page.evaluate(async () => {
			const id = location.pathname.split("/").pop();
			const r = await fetch(`/api/boards/${id}/preview`);
			return (await r.json()).strokes.length;
		});
		expect(count).toBe(2); // the one drawn and one copy
	});

	test("a second paste right after the first waits for it to finish", async ({
		page,
	}) => {
		await pen(page, [200, 500], [500, 500]);
		await page.keyboard.press("Escape");
		await page.mouse.click(350, 500);
		await page.keyboard.press("Control+c");
		await page.mouse.move(350, 250);
		await page.keyboard.press("Control+v");
		await page.keyboard.press("Control+v"); // at once, not a separate wish
		await page.waitForTimeout(700);
		await page.keyboard.press("Control+v"); // a later one is a new paste
		await page.waitForTimeout(500);
		const count = await page.evaluate(async () => {
			const id = location.pathname.split("/").pop();
			return (await (await fetch(`/api/boards/${id}/preview`)).json()).strokes
				.length;
		});
		expect(count).toBe(3);
	});
});
