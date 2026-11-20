import { beforeEach, describe, expect, test } from "vitest";
import type { Settings } from "./board/controller";
import {
	colorFor,
	lineStyleFor,
	opacityFor,
	rememberColor,
	rememberLineStyle,
	rememberOpacity,
	rememberSize,
	resetToolStyles,
	restoreStart,
	sizeFor,
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

describe("colour per tool (R-097)", () => {
	beforeEach(() => resetToolStyles());
	const RED = "#d32f2f";
	const BLUE = "#1976d2";
	const GREEN = "#388e3c";

	test("pen, line and shapes each get back their own colour", () => {
		const s = make();
		s.color = RED;
		rememberColor("pen", RED);
		switchTool(s, "line");
		s.color = BLUE;
		rememberColor("line", BLUE);
		switchTool(s, "shape");
		s.color = GREEN;
		rememberColor("shape", GREEN);
		switchTool(s, "pen");
		expect(s.color).toBe(RED);
		switchTool(s, "line");
		expect(s.color).toBe(BLUE);
		switchTool(s, "shape");
		expect(s.color).toBe(GREEN);
	});

	test("a tool never used inherits the colour in hand, then keeps it", () => {
		const s = make();
		s.color = RED;
		switchTool(s, "line"); // first use: red, as the pen had it
		expect(s.color).toBe(RED);
		switchTool(s, "pen");
		s.color = BLUE; // the pen changes later
		rememberColor("pen", BLUE);
		switchTool(s, "line");
		expect(s.color).toBe(RED); // the line kept the colour it started with
	});

	test("leaving a tool keeps the colour it had, even if nothing called remember", () => {
		const s = make();
		s.color = RED; // set without rememberColor
		switchTool(s, "line");
		s.color = BLUE;
		switchTool(s, "pen");
		expect(s.color).toBe(RED);
		switchTool(s, "line");
		expect(s.color).toBe(BLUE);
	});

	test("the eraser, the hand, the laser, text and the plane keep the colour in hand", () => {
		const s = make();
		s.color = RED;
		rememberColor("pen", RED);
		for (const tool of ["eraser", "pan", "laser", "text", "plane"] as const) {
			switchTool(s, tool);
			expect(s.color).toBe(RED);
		}
		expect(colorFor("pen")).toBe(RED);
	});

	test("is kept on the device next to the line styles", () => {
		rememberLineStyle("line", "dashed");
		rememberColor("line", BLUE);
		expect(
			JSON.parse(localStorage.getItem("inkroom.toolStyles") ?? "{}"),
		).toEqual({ line: "dashed", colors: { line: BLUE } });
		resetToolStyles(false);
		expect(colorFor("line")).toBe(BLUE);
		expect(lineStyleFor("line")).toBe("dashed");
	});

	test("data stored before colours existed still loads", () => {
		localStorage.setItem(
			"inkroom.toolStyles",
			JSON.stringify({ pen: "solid", line: "dashed" }),
		);
		resetToolStyles(false);
		expect(lineStyleFor("line")).toBe("dashed");
		expect(colorFor("line")).toBeUndefined();
	});

	test("ignores a stored colour that is not a colour", () => {
		localStorage.setItem(
			"inkroom.toolStyles",
			JSON.stringify({ colors: { pen: "red", line: 5, shape: BLUE } }),
		);
		resetToolStyles(false);
		expect(colorFor("pen")).toBeUndefined();
		expect(colorFor("line")).toBeUndefined();
		expect(colorFor("shape")).toBe(BLUE);
	});

	test("remembering a colour for a tool without one does nothing", () => {
		rememberColor("eraser", RED);
		expect(localStorage.getItem("inkroom.toolStyles")).toBeNull();
	});
});

describe("thickness, opacity and the last tool survive a reload (R-097)", () => {
	beforeEach(() => resetToolStyles());
	/** What a freshly opened page would read: the module forgets its copy, the storage stays. */
	const reload = () => resetToolStyles(false);

	test("thickness and opacity are kept per tool and come back on a switch", () => {
		const s = { ...make(), size: 4, opacity: 0.5 };
		switchTool(s, "line"); // the pen keeps 4 and 50 %, the line starts with them
		s.size = 1;
		s.opacity = 1;
		switchTool(s, "pen");
		expect(s.size).toBe(4);
		expect(s.opacity).toBe(0.5);
		switchTool(s, "line");
		expect(s.size).toBe(1);
		expect(s.opacity).toBe(1);
	});

	test("the thickness and opacity in hand go to the tool being left; a tool used first starts with them", () => {
		const s = { ...make(), size: 3, opacity: 0.4 };
		switchTool(s, "shape");
		expect(s.size).toBe(3);
		expect(s.opacity).toBe(0.4);
		expect(sizeFor("pen")).toBe(3);
		expect(opacityFor("pen")).toBe(0.4);
		expect(sizeFor("shape")).toBe(3);
	});

	test("everything stays after a reload, for each tool", () => {
		rememberColor("pen", "#ff0000");
		rememberSize("pen", 4);
		rememberOpacity("pen", 0.5);
		rememberLineStyle("line", "dashed");
		rememberColor("line", "#0000ff");
		rememberSize("line", 0.5);
		reload();
		expect(colorFor("pen")).toBe("#ff0000");
		expect(sizeFor("pen")).toBe(4);
		expect(opacityFor("pen")).toBe(0.5);
		expect(lineStyleFor("line")).toBe("dashed");
		expect(colorFor("line")).toBe("#0000ff");
		expect(sizeFor("line")).toBe(0.5);
		expect(sizeFor("shape")).toBeUndefined();
	});

	test("the page starts with the last drawing tool and its settings", () => {
		const s = make();
		switchTool(s, "line");
		rememberLineStyle("line", "dashed");
		rememberColor("line", "#0000ff");
		rememberSize("line", 4);
		reload();
		const fresh = make();
		restoreStart(fresh);
		expect(fresh.tool).toBe("line");
		expect(fresh.lineStyle).toBe("dashed");
		expect(fresh.color).toBe("#0000ff");
		expect(fresh.size).toBe(4);
	});

	test("with nothing stored the page starts with the pen and the defaults", () => {
		const fresh = { ...make(), color: "#111111", size: 2 };
		restoreStart(fresh);
		expect(fresh.tool).toBe("pen");
		expect(fresh.color).toBe("#111111");
		expect(fresh.size).toBe(2);
		expect(fresh.lineStyle).toBe("natural");
	});

	test("the eraser, the hand and the laser are not remembered as the last tool", () => {
		const s = make();
		switchTool(s, "shape");
		switchTool(s, "eraser");
		switchTool(s, "laser");
		reload();
		const fresh = make();
		restoreStart(fresh);
		expect(fresh.tool).toBe("shape");
	});

	test("what an earlier version stored is still read, and bad values are ignored", () => {
		localStorage.setItem(
			"inkroom.toolStyles",
			JSON.stringify({
				pen: "solid",
				colors: { pen: "#ff0000" },
				sizes: { pen: -3, line: "x", shape: 999 },
				opacities: { pen: 5, line: 0, shape: "half" },
				last: "eraser",
			}),
		);
		expect(lineStyleFor("pen")).toBe("solid");
		expect(colorFor("pen")).toBe("#ff0000");
		expect(sizeFor("pen")).toBeUndefined();
		expect(sizeFor("line")).toBeUndefined();
		expect(sizeFor("shape")).toBeUndefined();
		expect(opacityFor("pen")).toBeUndefined();
		expect(opacityFor("line")).toBeUndefined();
		const fresh = make();
		restoreStart(fresh);
		expect(fresh.tool).toBe("pen");
	});

	test("unreadable storage leaves the defaults", () => {
		localStorage.setItem("inkroom.toolStyles", "{not json");
		const fresh = make();
		restoreStart(fresh);
		expect(fresh.tool).toBe("pen");
		expect(sizeFor("pen")).toBeUndefined();
	});
});
