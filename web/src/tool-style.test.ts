import { beforeEach, describe, expect, test } from "vitest";
import type { Settings } from "./board/controller";
import {
	lineStyleFor,
	rememberLineStyle,
	resetToolStyles,
	switchTool,
} from "./tool-style";

const make = (): Settings => ({
	tool: "pen",
	color: "#000",
	size: 2,
	lineStyle: "natural",
});

describe("line style per tool (R-097)", () => {
	beforeEach(() => resetToolStyles());

	test("starts with the natural pen for the pen and solid for line and shapes", () => {
		expect(lineStyleFor("pen")).toBe("natural");
		expect(lineStyleFor("line")).toBe("solid");
		expect(lineStyleFor("shape")).toBe("solid");
	});

	test("each tool gets back its own style when it is chosen again", () => {
		const s = make();
		rememberLineStyle("pen", "solid");
		switchTool(s, "line");
		expect(s.tool).toBe("line");
		expect(s.lineStyle).toBe("solid");
		rememberLineStyle("line", "dashed");
		switchTool(s, "shape");
		expect(s.lineStyle).toBe("solid");
		rememberLineStyle("shape", "dotted");
		switchTool(s, "pen");
		expect(s.lineStyle).toBe("solid");
		switchTool(s, "line");
		expect(s.lineStyle).toBe("dashed");
		switchTool(s, "shape");
		expect(s.lineStyle).toBe("dotted");
	});

	test("tools without a line style keep the current one", () => {
		const s = make();
		rememberLineStyle("pen", "dashed");
		switchTool(s, "pen");
		switchTool(s, "eraser");
		expect(s.lineStyle).toBe("dashed");
		switchTool(s, "pen");
		expect(s.lineStyle).toBe("dashed");
	});

	test("is remembered on the device", () => {
		rememberLineStyle("line", "dotted");
		expect(
			JSON.parse(localStorage.getItem("inkroom.toolStyles") ?? "{}"),
		).toEqual({
			line: "dotted",
		});
	});

	test("ignores a stored style the tool cannot draw", () => {
		localStorage.setItem(
			"inkroom.toolStyles",
			JSON.stringify({ line: "natural", pen: "bogus" }),
		);
		resetToolStyles(false);
		expect(lineStyleFor("line")).toBe("solid");
		expect(lineStyleFor("pen")).toBe("natural");
	});
});
