import { describe, expect, it } from "vitest";
import { isPlain, type MdBlock, parseMarkdown, plainText } from "./markdown";

const runs = (b: MdBlock) =>
	b.runs.map((r) => [
		r.text,
		[r.bold && "b", r.italic && "i", r.strike && "s", r.code && "c"]
			.filter(Boolean)
			.join(""),
	]);

describe("parseMarkdown inline (R-102)", () => {
	it("keeps text without markers as one plain run", () => {
		const [b] = parseMarkdown("Ala ma kota");
		expect(b.kind).toBe("p");
		expect(runs(b)).toEqual([["Ala ma kota", ""]]);
	});

	it("reads bold, italic, strike and code", () => {
		const [b] = parseMarkdown("a **b** *i* ~~s~~ `c` z");
		expect(runs(b)).toEqual([
			["a ", ""],
			["b", "b"],
			[" ", ""],
			["i", "i"],
			[" ", ""],
			["s", "s"],
			[" ", ""],
			["c", "c"],
			[" z", ""],
		]);
	});

	it("reads bold italic and nested styles", () => {
		expect(runs(parseMarkdown("***x***")[0])).toEqual([["x", "bi"]]);
		expect(runs(parseMarkdown("**a *b* c**")[0])).toEqual([
			["a ", "b"],
			["b", "bi"],
			[" c", "b"],
		]);
	});

	it("does not look inside code", () => {
		expect(runs(parseMarkdown("`a **b** c`")[0])).toEqual([["a **b** c", "c"]]);
	});

	it("leaves unmatched markers and spaced asterisks as text", () => {
		expect(runs(parseMarkdown("2 * 3 * 4")[0])).toEqual([["2 * 3 * 4", ""]]);
		expect(runs(parseMarkdown("**open")[0])).toEqual([["**open", ""]]);
		expect(runs(parseMarkdown("a ** b")[0])).toEqual([["a ** b", ""]]);
		expect(runs(parseMarkdown("`open")[0])).toEqual([["`open", ""]]);
	});

	it("lets a backslash switch a marker off", () => {
		expect(runs(parseMarkdown("\\*a\\* \\*\\*b\\*\\*")[0])).toEqual([
			["*a* **b**", ""],
		]);
	});

	it("is not fooled by an underscore or by maths", () => {
		expect(runs(parseMarkdown("x_1 + y_2 = a*b")[0])).toEqual([
			["x_1 + y_2 = a*b", ""],
		]);
	});
});

describe("parseMarkdown blocks (R-102)", () => {
	it("keeps blank lines and line breaks", () => {
		const blocks = parseMarkdown("a\n\nb");
		expect(blocks.map((b) => b.kind)).toEqual(["p", "p", "p"]);
		expect(blocks[1].runs).toEqual([]);
	});

	it("reads headings of three levels, not more", () => {
		const blocks = parseMarkdown("# a\n## b\n### c\n#### d\n#e");
		expect(blocks.map((b) => b.kind)).toEqual(["h1", "h2", "h3", "p", "p"]);
		expect(runs(blocks[0])).toEqual([["a", ""]]);
		expect(runs(blocks[3])).toEqual([["#### d", ""]]);
	});

	it("reads bullet and numbered lists with their markers", () => {
		const blocks = parseMarkdown("- a\n* b\n1. c\n2) d");
		expect(blocks.map((b) => b.kind)).toEqual(["ul", "ul", "ol", "ol"]);
		expect(blocks.map((b) => b.marker)).toEqual(["•", "•", "1.", "2."]);
		expect(runs(blocks[1])).toEqual([["b", ""]]);
	});

	it("nests a list by indentation, two spaces a level", () => {
		const blocks = parseMarkdown("- a\n  - b\n    - c\n          - d");
		expect(blocks.map((b) => b.depth)).toEqual([0, 1, 2, 3]);
		expect(blocks[1].marker).toBe("◦");
	});

	it("reads a quote", () => {
		const [b] = parseMarkdown("> cytat **ważny**");
		expect(b.kind).toBe("quote");
		expect(runs(b)).toEqual([
			["cytat ", ""],
			["ważny", "b"],
		]);
	});

	it("takes a star followed by text for emphasis, not for a list", () => {
		const [b] = parseMarkdown("*kursywa* tu");
		expect(b.kind).toBe("p");
		expect(runs(b)[0]).toEqual(["kursywa", "i"]);
	});

	it("never produces anything but text", () => {
		const [b] = parseMarkdown("<img src=x onerror=alert(1)> **<b>x</b>**");
		expect(b.runs.map((r) => r.text).join("")).toBe(
			"<img src=x onerror=alert(1)> <b>x</b>",
		);
	});

	it("survives any input", () => {
		const alphabet = ["*", "`", "~", "\\", "#", "-", ">", " ", "\n", "a", "1."];
		let seed = 7;
		const next = () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed;
		};
		for (let i = 0; i < 400; i++) {
			let text = "";
			for (let j = next() % 40; j >= 0; j--)
				text += alphabet[next() % alphabet.length];
			expect(() => parseMarkdown(text)).not.toThrow();
		}
	});
});

describe("isPlain", () => {
	it("is true for text with no markdown, even with line breaks", () => {
		expect(isPlain(parseMarkdown("Ala\nma kota\n\n2 * 3"))).toBe(true);
		expect(isPlain(parseMarkdown(""))).toBe(true);
	});

	it("is false when anything is styled", () => {
		expect(isPlain(parseMarkdown("a **b**"))).toBe(false);
		expect(isPlain(parseMarkdown("# a"))).toBe(false);
		expect(isPlain(parseMarkdown("- a"))).toBe(false);
		expect(isPlain(parseMarkdown("> a"))).toBe(false);
	});
});

describe("stars inside words (old math texts)", () => {
	it("keeps a star between two letters or digits literal", () => {
		for (const src of ["2*3*4=24", "a*b*c", "x*y"]) {
			const blocks = parseMarkdown(src);
			expect(isPlain(blocks)).toBe(true);
			expect(plainText(blocks)).toBe(src);
		}
	});

	it("still styles markers at word boundaries", () => {
		const it = parseMarkdown("to jest *ważne*")[0].runs;
		expect(it.find((r) => r.text === "ważne")?.italic).toBe(true);
		const b = parseMarkdown("**bold**")[0].runs;
		expect(b[0]).toMatchObject({ text: "bold", bold: true });
		expect(parseMarkdown("*ważne*")[0].runs[0].italic).toBe(true);
	});

	it("leaves underscores alone", () => {
		expect(isPlain(parseMarkdown("x_1_2"))).toBe(true);
	});
});
