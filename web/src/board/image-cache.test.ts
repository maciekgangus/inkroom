import { describe, expect, test, vi } from "vitest";
import { ImageCache, type ImageLike } from "./image-cache";

class FakeImage implements ImageLike {
	src = "";
	complete = false;
	naturalWidth = 0;
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	finish() {
		this.complete = true;
		this.naturalWidth = 100;
		this.onload?.();
	}
}

describe("ImageCache", () => {
	const make = () => {
		const created: FakeImage[] = [];
		const onLoad = vi.fn();
		const cache = new ImageCache("b1", onLoad, () => {
			const img = new FakeImage();
			created.push(img);
			return img;
		});
		return { cache, created, onLoad };
	};

	test("requests the image from the board's image endpoint", () => {
		const { cache, created } = make();
		cache.get("abc");
		expect(created[0].src).toBe("/api/boards/b1/images/abc");
	});

	test("returns nothing until the image has loaded, then the image", () => {
		const { cache, created } = make();
		expect(cache.get("abc")).toBeNull();
		created[0].finish();
		expect(cache.get("abc")).toBe(created[0]);
	});

	test("asks for a repaint when an image finishes loading", () => {
		const { cache, created, onLoad } = make();
		cache.get("abc");
		expect(onLoad).not.toHaveBeenCalled();
		created[0].finish();
		expect(onLoad).toHaveBeenCalledOnce();
	});

	test("loads each image once however often it is asked for", () => {
		const { cache, created } = make();
		cache.get("abc");
		cache.get("abc");
		cache.get("abc");
		expect(created).toHaveLength(1);
	});

	test("a failed image stays a placeholder and is not retried on every repaint", () => {
		const { cache, created } = make();
		cache.get("abc");
		created[0].onerror?.();
		expect(cache.get("abc")).toBeNull();
		expect(created).toHaveLength(1);
		expect(cache.failed("abc")).toBe(true);
	});
});
