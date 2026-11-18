import { describe, expect, test, vi } from "vitest";
import { ImageCache, type ImageLike } from "./image-cache";

class FakeImage implements ImageLike {
	src = "";
	complete = false;
	naturalWidth = 0;
	naturalHeight = 0;
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	finish() {
		this.complete = true;
		this.naturalWidth = 100;
		this.naturalHeight = 100;
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

	describe("memory budget (R-090)", () => {
		const makeBudget = (budget: number) => {
			let now = 0;
			const created: FakeImage[] = [];
			const cache = new ImageCache(
				"b1",
				() => {},
				() => {
					const img = new FakeImage();
					created.push(img);
					return img;
				},
				{ maxPixels: budget, idleMs: 1000, now: () => now },
			);
			const load = (src: string) => {
				cache.get(src);
				created[created.length - 1].finish();
			};
			return { cache, created, load, advance: (ms: number) => (now += ms) };
		};

		test("drops the longest unused image once the decoded pixels exceed the budget", () => {
			const { cache, created, load, advance } = makeBudget(25_000); // 2.5 images of 10k px
			load("a");
			advance(2000);
			load("b");
			advance(2000);
			load("c");
			cache.get("c"); // keeps asking: the budget is checked at the next request
			expect(cache.get("b")).toBe(created[1]);
			expect(cache.get("a")).toBeNull(); // evicted, loads again on demand
			expect(created.length).toBe(4);
		});

		test("never drops an image drawn within the last moment, even over budget", () => {
			const { cache, load, advance } = makeBudget(15_000);
			load("a");
			advance(100);
			load("b");
			advance(100);
			expect(cache.get("a")).not.toBeNull();
			expect(cache.get("b")).not.toBeNull();
		});
	});
});
