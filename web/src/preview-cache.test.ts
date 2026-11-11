import { beforeEach, describe, expect, test, vi } from "vitest";
import { getPreview, setPreview } from "./preview-cache";

describe("the preview cache (R-052)", () => {
	beforeEach(() => localStorage.clear());

	test("gives back a picture of the same version of a board", () => {
		setPreview("b1", '"7-plain"', "data:image/png;base64,AAA");
		expect(getPreview("b1", '"7-plain"')).toBe("data:image/png;base64,AAA");
	});

	test("knows nothing of another version or another board", () => {
		setPreview("b1", '"7-plain"', "data:x");
		expect(getPreview("b1", '"8-plain"')).toBeNull();
		expect(getPreview("b2", '"7-plain"')).toBeNull();
	});

	test("a new version replaces the old picture of the same board", () => {
		setPreview("b1", '"7-plain"', "data:old");
		setPreview("b1", '"8-plain"', "data:new");
		expect(getPreview("b1", '"7-plain"')).toBeNull();
		expect(getPreview("b1", '"8-plain"')).toBe("data:new");
	});

	test("keeps only the most recent boards", () => {
		for (let i = 0; i < 80; i++) setPreview(`b${i}`, "v", `data:${i}`);
		expect(getPreview("b79", "v")).toBe("data:79");
		expect(getPreview("b0", "v")).toBeNull();
		const kept = Object.keys(localStorage).filter((k) =>
			k.startsWith("inkroom.preview."),
		);
		expect(kept.length).toBeLessThanOrEqual(60);
	});

	test("works without storage (private mode, full disk)", () => {
		const broken = vi
			.spyOn(Storage.prototype, "setItem")
			.mockImplementation(() => {
				throw new Error("full");
			});
		expect(() => setPreview("b1", "v", "data:x")).not.toThrow();
		broken.mockRestore();
		const noRead = vi
			.spyOn(Storage.prototype, "getItem")
			.mockImplementation(() => {
				throw new Error("denied");
			});
		expect(getPreview("b1", "v")).toBeNull();
		noRead.mockRestore();
	});
});
