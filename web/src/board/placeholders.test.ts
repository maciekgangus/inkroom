import { describe, expect, test, vi } from "vitest";
import type { Stroke } from "./board";
import { paintElements } from "./canvas-renderer";

const image = (src: string): Stroke =>
	({
		id: "i1",
		kind: "image",
		src,
		points: [
			[10, 20, 0.5],
			[110, 70, 0.5],
		],
		color: "#000",
		size: 1,
		authorId: "t",
		z: 0,
	}) as Stroke;

const fakeContext = () =>
	({
		save: vi.fn(),
		restore: vi.fn(),
		translate: vi.fn(),
		rotate: vi.fn(),
		fillRect: vi.fn(),
		strokeRect: vi.fn(),
		drawImage: vi.fn(),
		fillStyle: "",
		strokeStyle: "",
		lineWidth: 1,
		globalAlpha: 1,
	}) as unknown as CanvasRenderingContext2D;

const view = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };

describe("pictures in a preview (R-052)", () => {
	test("are a light placeholder, so no photo has to be fetched", () => {
		const ctx = fakeContext();
		paintElements(ctx, [image("photo")], view, null, true);
		expect(ctx.fillRect).toHaveBeenCalledWith(10, 20, 100, 50);
		expect(ctx.drawImage).not.toHaveBeenCalled();
	});

	test("are left out of an export when they did not load", () => {
		const ctx = fakeContext();
		paintElements(ctx, [image("photo")], view, null);
		expect(ctx.fillRect).not.toHaveBeenCalled();
	});
});

describe("elements on the board map (R-061)", () => {
	const thin = (): Stroke =>
		({
			id: "p1",
			kind: "line",
			points: [
				[0, 0, 0.5],
				[90, 10, 0.5],
			],
			color: "#000000",
			size: 0.5,
			authorId: "t",
			z: 0,
		}) as Stroke;

	test("are drawn with the map's colours and never thinner than the minimum width", () => {
		// jsdom has no Path2D: any path method is accepted and ignored.
		vi.stubGlobal("Path2D", function Path2D() {
			return new Proxy({}, { get: () => () => {} });
		});
		const ctx = Object.assign(fakeContext(), {
			stroke: vi.fn(),
			fill: vi.fn(),
			setLineDash: vi.fn(),
		});
		const widths: number[] = [];
		const colors: string[] = [];
		(ctx.stroke as ReturnType<typeof vi.fn>).mockImplementation(() => {
			widths.push(ctx.lineWidth);
			colors.push(ctx.strokeStyle as string);
		});
		paintElements(ctx, [thin()], view, null, true, {
			ink: () => "#abcdef",
			minWidth: 6,
		});
		expect(widths).toEqual([6]);
		expect(colors).toEqual(["#abcdef"]);
	});
});
