import { describe, expect, test } from "vitest";
import { pickEncoding } from "./encode";

describe("pickEncoding: how a rendered page is stored (ADR 0015)", () => {
	test("a page that is small as a PNG stays a PNG (sharp text)", () => {
		expect(pickEncoding(200 * 1024)).toBe("png");
		expect(pickEncoding(1.5 * 1024 * 1024)).toBe("png");
	});

	test("a page that is big as a PNG (a scan, a photo) becomes a JPEG", () => {
		expect(pickEncoding(1.5 * 1024 * 1024 + 1)).toBe("jpeg");
		expect(pickEncoding(9 * 1024 * 1024)).toBe("jpeg");
	});
});
