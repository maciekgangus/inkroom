import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";

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

const isChromium = (page: Page) =>
	page.context().browser()?.browserType().name() === "chromium";

/**
 * Chromium takes real input events through the DevTools protocol; WebKit has no such thing for
 * pens and several fingers, so there the same pointer events are dispatched on the board itself
 * (with pointer capture, which only a real pointer can take, switched off).
 */
async function pointers(
	page: Page,
	pointerType: "pen" | "touch",
	from: Pt[],
	to: Pt[],
): Promise<void> {
	if (isChromium(page)) {
		const cdp = await page.context().newCDPSession(page);
		const at = (t: number) =>
			from.map((f, id) => {
				const [x, y] = lerp(f, to[id], t);
				return { x, y, id };
			});
		if (pointerType === "touch") {
			await cdp.send("Input.dispatchTouchEvent", {
				type: "touchStart",
				touchPoints: at(0),
			});
			for (let i = 1; i <= STEPS; i++)
				await cdp.send("Input.dispatchTouchEvent", {
					type: "touchMove",
					touchPoints: at(i / STEPS),
				});
			await cdp.send("Input.dispatchTouchEvent", {
				type: "touchEnd",
				touchPoints: [],
			});
		} else {
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
			await send("mousePressed", from[0]);
			for (let i = 1; i <= STEPS; i++)
				await send("mouseMoved", lerp(from[0], to[0], i / STEPS));
			await send("mouseReleased", to[0]);
		}
		await cdp.detach();
		return;
	}
	await page.evaluate(
		({ pointerType, from, to, steps }) => {
			const live = document.querySelector("canvas#live") as HTMLCanvasElement;
			live.setPointerCapture = () => {};
			const fire = (
				type: string,
				id: number,
				x: number,
				y: number,
				down: boolean,
			) =>
				live.dispatchEvent(
					new PointerEvent(type, {
						bubbles: true,
						cancelable: true,
						pointerId: id + 1,
						pointerType,
						isPrimary: id === 0,
						clientX: x,
						clientY: y,
						pressure: down ? 0.5 : 0,
						button: 0,
						buttons: down ? 1 : 0,
					}),
				);
			const at = (id: number, t: number): [number, number] => [
				from[id][0] + (to[id][0] - from[id][0]) * t,
				from[id][1] + (to[id][1] - from[id][1]) * t,
			];
			from.forEach((_, id) => fire("pointerdown", id, ...at(id, 0), true));
			for (let i = 1; i <= steps; i++)
				from.forEach((_, id) =>
					fire("pointermove", id, ...at(id, i / steps), true),
				);
			from.forEach((_, id) => fire("pointerup", id, ...at(id, 1), false));
		},
		{ pointerType, from, to, steps: STEPS },
	);
}

/** An Apple Pencil stroke: pointer events of type pen, with pressure. */
export const pen = (page: Page, from: Pt, to: Pt) =>
	pointers(page, "pen", [from], [to]);

/** One or more fingers moving together from `from` to `to` (one point per finger). */
export const fingers = (page: Page, from: Pt[], to: Pt[]) =>
	pointers(page, "touch", from, to);
