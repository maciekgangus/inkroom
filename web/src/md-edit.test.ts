import { describe, expect, test } from "vitest";
import {
	activeFormats,
	continueList,
	type Edit,
	lineStyleOf,
	setLineStyle,
	toggleWrap,
} from "./md-edit";

/** The text after an edit, and the selection it leaves, written as `a[b]c`. */
function apply(value: string, e: Edit): string {
	const out = value.slice(0, e.from) + e.insert + value.slice(e.to);
	const sel = (n: number) => n;
	return `${out.slice(0, sel(e.selStart))}[${out.slice(sel(e.selStart), sel(e.selEnd))}]${out.slice(sel(e.selEnd))}`;
}
/** Starts from `a[b]c`: the value and where the selection is. */
function from(marked: string): [string, number, number] {
	const s = marked.indexOf("[");
	const e = marked.indexOf("]") - 1;
	return [marked.replace("[", "").replace("]", ""), s, e];
}
const wrap = (marked: string, marker: string) => {
	const [v, s, e] = from(marked);
	return apply(v, toggleWrap(v, s, e, marker));
};

describe("toggleWrap (R-101)", () => {
	test("wraps the selection and keeps it selected", () => {
		expect(wrap("a [b c] d", "**")).toBe("a **[b c]** d");
	});

	test("takes spaces at the ends of the selection out of the markers", () => {
		expect(wrap("a[ b ]c", "**")).toBe("a **[b]** c");
	});

	test("a second press takes the markers away again", () => {
		expect(wrap("a **[b]** c", "**")).toBe("a [b] c");
		expect(wrap("a [**b**] c", "**")).toBe("a [b] c");
	});

	test("without a selection it wraps the word under the cursor", () => {
		expect(wrap("ab c[]d ef", "*")).toBe("ab *[cd]* ef");
	});

	test("without a selection and no word it opens an empty pair with the cursor between", () => {
		expect(wrap("ab []", "`")).toBe("ab `[]`");
		expect(wrap("ab `[]`", "`")).toBe("ab []");
	});

	test("italic and bold do not take each other's stars", () => {
		expect(wrap("**[b]**", "*")).toBe("***[b]***");
		expect(wrap("***[b]***", "*")).toBe("**[b]**");
		expect(wrap("***[b]***", "**")).toBe("*[b]*");
		expect(wrap("*[b]*", "**")).toBe("***[b]***");
	});

	test("strike and code", () => {
		expect(wrap("[x]", "~~")).toBe("~~[x]~~");
		expect(wrap("[x]", "`")).toBe("`[x]`");
	});

	test("the edit replaces only what changes, so undo stays small", () => {
		const e = toggleWrap("a b c", 2, 3, "**");
		expect(e.from).toBeGreaterThanOrEqual(0);
		expect(e.to - e.from).toBeLessThanOrEqual(1);
	});
});

describe("activeFormats", () => {
	const at = (marked: string) => {
		const [v, s, e] = from(marked);
		return activeFormats(v, s, e);
	};
	test("tells which formats the selection or cursor is in", () => {
		expect(at("a **[b]** c")).toMatchObject({ bold: true, italic: false });
		expect(at("a *[b]* c")).toMatchObject({ bold: false, italic: true });
		expect(at("***[b]***")).toMatchObject({ bold: true, italic: true });
		expect(at("a ~~b[]c~~")).toMatchObject({ strike: true });
		expect(at("a `b[]c` d")).toMatchObject({ code: true });
		expect(at("a [b] c")).toMatchObject({
			bold: false,
			italic: false,
			strike: false,
			code: false,
		});
	});
});

describe("setLineStyle (R-101)", () => {
	const style = (marked: string, st: Parameters<typeof setLineStyle>[3]) => {
		const [v, s, e] = from(marked);
		return apply(v, setLineStyle(v, s, e, st));
	};
	test("makes the line of the cursor a heading and replaces another heading", () => {
		expect(style("a\nb[]c\nd", "h1")).toBe("a\n[# bc]\nd");
		expect(style("## b[]c", "h3")).toBe("[### bc]");
	});
	test("the same style again takes it away, and Tekst clears any", () => {
		expect(style("# b[]c", "h1")).toBe("[bc]");
		expect(style("- b[]c", "p")).toBe("[bc]");
	});
	test("works on every line of the selection, numbering a list", () => {
		expect(style("[a\nb\nc]", "ol")).toBe("[1. a\n2. b\n3. c]");
		expect(style("[a\nb]", "ul")).toBe("[- a\n- b]");
		expect(style("[a\nb]", "quote")).toBe("[> a\n> b]");
	});
	test("changes a list into another list", () => {
		expect(style("[- a\n- b]", "ol")).toBe("[1. a\n2. b]");
	});
	test("reports the style of the line", () => {
		expect(lineStyleOf("x\n## y", 4, 4)).toBe("h2");
		expect(lineStyleOf("1. y", 0, 0)).toBe("ol");
		expect(lineStyleOf("> y", 0, 0)).toBe("quote");
		expect(lineStyleOf("y", 0, 0)).toBe("p");
	});
});

describe("continueList: Enter in a list (R-101)", () => {
	const enter = (marked: string) => {
		const [v, s, e] = from(marked);
		const edit = continueList(v, s, e);
		return edit ? apply(v, edit) : null;
	};
	test("starts the next bullet, or the next number", () => {
		expect(enter("- a[]")).toBe("- a\n- []");
		expect(enter("1. a[]")).toBe("1. a\n2. []");
		expect(enter("  * a[]")).toBe("  * a\n  * []");
	});
	test("an empty item ends the list", () => {
		expect(enter("- a\n- []")).toBe("- a\n[]");
		expect(enter("1. []")).toBe("[]");
	});
	test("does nothing outside a list, with a selection, or in the middle of a line", () => {
		expect(enter("abc[]")).toBeNull();
		expect(enter("- [a]b")).toBeNull();
		expect(enter("- a[]b")).toBeNull();
	});
});
