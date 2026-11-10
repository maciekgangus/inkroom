import { describe, expect, test, vi } from "vitest";
import {
	KEEP_BYTES,
	MAX_SIDE,
	needsReencode,
	uploadImage,
} from "./image-upload";

describe("needsReencode", () => {
	test("keeps a small supported image as it is", () => {
		expect(needsReencode("image/png", 200_000, 800, 600)).toBe(false);
		expect(needsReencode("image/jpeg", KEEP_BYTES, MAX_SIDE, 1000)).toBe(false);
	});

	test("shrinks a big file", () => {
		expect(needsReencode("image/jpeg", KEEP_BYTES + 1, 1000, 800)).toBe(true);
	});

	test("shrinks a big picture even when the file is small", () => {
		expect(needsReencode("image/png", 100_000, MAX_SIDE + 1, 100)).toBe(true);
	});

	test("converts formats the server does not accept (HEIC, BMP, ...)", () => {
		expect(needsReencode("image/heic", 100_000, 800, 600)).toBe(true);
		expect(needsReencode("", 100_000, 800, 600)).toBe(true);
	});
});

describe("uploadImage", () => {
	const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

	test("posts the raw bytes to the board and returns the new id", async () => {
		const fetchFn = vi.fn().mockResolvedValue({
			ok: true,
			status: 201,
			json: async () => ({ id: "abc" }),
		});
		const id = await uploadImage("b1", blob, fetchFn);
		expect(id).toBe("abc");
		expect(fetchFn).toHaveBeenCalledWith("/api/boards/b1/images", {
			method: "POST",
			body: blob,
		});
	});

	test("reports the server's message when it refuses", async () => {
		const fetchFn = vi.fn().mockResolvedValue({
			ok: false,
			status: 413,
			json: async () => ({ error: "Obraz jest za duży (maks. 5 MB)" }),
		});
		await expect(uploadImage("b1", blob, fetchFn)).rejects.toThrow(
			"Obraz jest za duży (maks. 5 MB)",
		);
	});

	test("falls back to a generic message when the error is not JSON", async () => {
		const fetchFn = vi.fn().mockResolvedValue({
			ok: false,
			status: 502,
			json: async () => {
				throw new Error("no json");
			},
		});
		await expect(uploadImage("b1", blob, fetchFn)).rejects.toThrow(/502/);
	});

	test("a network failure becomes a readable error", async () => {
		const fetchFn = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
		await expect(uploadImage("b1", blob, fetchFn)).rejects.toThrow(
			/połączenia/i,
		);
	});
});
