import { randomUUID } from "node:crypto";
import type { CDPSession, Page } from "@playwright/test";

/** Registers a fresh account, makes a board and opens it; the page is then ready to draw on. */
export async function openBoard(page: Page): Promise<void> {
	const email = `ipad-${randomUUID()}@example.test`;
	const req = page.context().request;
	await req.post("/api/register", {
		data: { email, password: "test-pass-12345" },
	});
	const board = await (
		await req.post("/api/boards", { data: { name: "iPad" } })
	).json();
	await page.goto(`/b/${board.id}`);
	await page.waitForSelector(".topbar");
}

/** How many pixels of the board canvas (the committed layer) are painted. */
export const ink = (page: Page) =>
	page.evaluate(() => {
		const c = document.querySelector<HTMLCanvasElement>("canvas#board");
		const ctx = c?.getContext("2d");
		if (!c || !ctx) return 0;
		const d = ctx.getImageData(0, 0, c.width, c.height).data;
		let painted = 0;
		for (let i = 3; i < d.length; i += 4) if (d[i]) painted++;
		return painted;
	});

/** The painted pixels of the board canvas inside a rectangle given in screen (CSS) pixels. */
export const inkIn = (page: Page, x: number, y: number, w: number, h: number) =>
	page.evaluate(
		([x, y, w, h]) => {
			const c = document.querySelector<HTMLCanvasElement>("canvas#board");
			const ctx = c?.getContext("2d");
			if (!c || !ctx) return 0;
			const k = c.width / innerWidth;
			const d = ctx.getImageData(x * k, y * k, w * k, h * k).data;
			let painted = 0;
			for (let i = 3; i < d.length; i += 4) if (d[i]) painted++;
			return painted;
		},
		[x, y, w, h],
	);

type Pt = [number, number];
const STEPS = 10;
const lerp = (a: Pt, b: Pt, t: number): Pt => [
	a[0] + (b[0] - a[0]) * t,
	a[1] + (b[1] - a[1]) * t,
];

/** An Apple Pencil stroke: pointer events of type pen, with pressure. */
export async function pen(cdp: CDPSession, from: Pt, to: Pt): Promise<void> {
	const send = (type: string, [x, y]: Pt) =>
		cdp.send("Input.dispatchMouseEvent", {
			type,
			x,
			y,
			button: "left",
			buttons: type === "mouseReleased" ? 0 : 1,
			clickCount: 1,
			pointerType: "pen",
			force: 0.5,
		});
	await send("mousePressed", from);
	for (let i = 1; i <= STEPS; i++)
		await send("mouseMoved", lerp(from, to, i / STEPS));
	await send("mouseReleased", to);
}

/** One or more fingers moving together from `from` to `to` (one point per finger). */
export async function fingers(
	cdp: CDPSession,
	from: Pt[],
	to: Pt[],
): Promise<void> {
	const points = (t: number) =>
		from.map((f, id) => {
			const [x, y] = lerp(f, to[id], t);
			return { x, y, id };
		});
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchStart",
		touchPoints: points(0),
	});
	for (let i = 1; i <= STEPS; i++)
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchMove",
			touchPoints: points(i / STEPS),
		});
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchEnd",
		touchPoints: [],
	});
}
