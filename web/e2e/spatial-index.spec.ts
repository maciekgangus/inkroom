import { expect, test } from "@playwright/test";
import { E2E_LOGIN, inkIn, pen } from "./helpers";

/**
 * Verifies the spatial index path (> 200 elements) end-to-end on iPad viewports (R-118):
 * - tapping the rotated corner hit margin of a rotated filled rectangle selects it;
 * - tapping an indexed polygon shape selects it;
 * - erasing a stroke removes its ink and undo restores it.
 */
test("spatial index selects rotated corner hits, indexed polygons, and erases strokes on >200-element boards (R-118)", async ({
	page,
}) => {
	const req = page.context().request;
	await req.post("/api/login", { data: E2E_LOGIN });
	const board = await (
		await req.post("/api/boards", { data: { name: "Spatial index e2e" } })
	).json();

	// Seed 213 elements via WebSocket before opening the board page so the spatial index
	// (SMALL_BOARD = 200) is active on initial load.
	await page.goto("/healthz");
	await page.evaluate(async (boardId: string) => {
		const strokes = [];
		for (let i = 0; i < 210; i++) {
			const x = 2000 + (i % 15) * 150;
			const y = 2000 + Math.floor(i / 15) * 150;
			strokes.push({
				id: `filler-${i}`,
				authorId: "seed",
				color: "#111111",
				size: 2,
				z: i + 1,
				points: [
					[x, y, 0.5],
					[x + 12, y + 8, 0.5],
				],
			});
		}
		// Rotated filled rect centred at (250, 350): tapping (250, 268) hits the rotated corner
		// margin (~7.98 units outside local geomBox, within reach 8.5, yet > 8 px outside strokeBounds).
		strokes.push({
			id: "rot-rect",
			authorId: "seed",
			color: "#111111",
			fill: "#ffcccc",
			size: 1,
			z: 300,
			kind: "rect",
			rot: Math.PI / 4,
			points: [
				[200, 300, 0.5],
				[300, 400, 0.5],
			],
		});
		// Unfilled triangle in the grid cells: bottom edge spans (420, 400)..(520, 400).
		strokes.push({
			id: "tri",
			authorId: "seed",
			color: "#111111",
			size: 4,
			z: 301,
			kind: "triangle",
			points: [
				[420, 300, 0.5],
				[520, 400, 0.5],
			],
		});
		// Freehand stroke to erase and undo.
		strokes.push({
			id: "erase-me",
			authorId: "seed",
			color: "#111111",
			size: 6,
			z: 302,
			points: [
				[200, 520, 0.5],
				[260, 520, 0.5],
				[320, 520, 0.5],
			],
		});

		const proto = location.protocol === "https:" ? "wss:" : "ws:";
		await new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(`${proto}//${location.host}/ws/${boardId}`);
			ws.onerror = () => reject(new Error("seed websocket error"));
			ws.onmessage = (ev) => {
				const msg = JSON.parse(String(ev.data)) as {
					t: string;
					stroke?: { id: string };
				};
				if (msg.t === "snapshot") {
					for (const stroke of strokes) {
						ws.send(JSON.stringify({ t: "add", stroke }));
					}
				} else if (msg.t === "add" && msg.stroke?.id === "erase-me") {
					ws.close();
					resolve();
				}
			};
		});
	}, board.id);

	await page.goto(`/b/${board.id}`);
	await page.waitForSelector(".topbar");
	await page.waitForSelector(".participants");
	await expect.poll(() => inkIn(page, 180, 500, 160, 40)).toBeGreaterThan(0);

	// 1. Switch to select tool and tap the rotated corner margin of rot-rect.
	await page.locator("[aria-label='select']").tap();
	await expect(page.locator("[aria-label='select']")).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await pen(page, [250, 268], [250, 268]);
	await expect(page.locator(".panel-tile")).toBeVisible();

	// 2. Deselect on empty canvas, then tap the bottom edge of the indexed triangle.
	await pen(page, [150, 620], [150, 620]);
	await expect(page.locator(".panel-tile")).toHaveCount(0);
	await pen(page, [470, 400], [470, 400]);
	await expect(page.locator(".panel-tile")).toBeVisible();

	// 3. Erase the target stroke, verify ink drops to 0, then undo and verify ink returns.
	await page.locator("[aria-label='eraser']").tap();
	await expect(page.locator("[aria-label='eraser']")).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await pen(page, [260, 490], [260, 550]);
	await expect.poll(() => inkIn(page, 180, 500, 160, 40)).toBe(0);

	await page.locator("[aria-label='undo']").tap();
	await expect.poll(() => inkIn(page, 180, 500, 160, 40)).toBeGreaterThan(0);
});
