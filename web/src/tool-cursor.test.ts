import { describe, expect, test } from "vitest";
import { toolCursor } from "./tool-cursor";

describe("toolCursor", () => {
	test("tells the tools apart at a glance", () => {
		expect(toolCursor("select")).toBe("default");
		expect(toolCursor("text")).toBe("text");
		expect(toolCursor("line")).toBe("crosshair");
		expect(toolCursor("rect")).toBe("crosshair");
		expect(toolCursor("circle")).toBe("crosshair");
		expect(toolCursor("pan")).toBe("grab");
	});

	test("the hand closes while the board is being dragged", () => {
		expect(toolCursor("pan", true)).toBe("grabbing");
		expect(toolCursor("pen", true)).toBe("grabbing"); // a right-button pan with any tool
	});

	test("the pen and the eraser get their own icon with a hotspot and a fallback", () => {
		const pen = toolCursor("pen");
		const eraser = toolCursor("eraser");
		expect(pen).toMatch(
			/^url\("data:image\/svg\+xml[^"]+"\) \d+ \d+, crosshair$/,
		);
		expect(eraser).toMatch(
			/^url\("data:image\/svg\+xml[^"]+"\) \d+ \d+, cell$/,
		);
		expect(pen).not.toBe(eraser);
	});

	test("the eraser cursor is as big as the eraser, 20 px", () => {
		const svg = decodeURIComponent(toolCursor("eraser"));
		expect(svg).toContain('width="22"'); // 20 px circle plus an outline on each side
		expect(svg).toContain('r="10"');
	});
});
