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
