import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ShareButton } from "./share-button";

describe("ShareButton (R-083)", () => {
	let root: HTMLElement;
	const button = () =>
		root.querySelector("button[aria-label='share']") as HTMLElement;
	const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

	beforeEach(() => {
		root = document.createElement("div");
		vi.stubGlobal("matchMedia", (q: string) => ({
			matches: q.includes("hover: hover") && fine,
			addEventListener: () => {},
			removeEventListener: () => {},
		}));
	});
	let fine = true;
	afterEach(() => {
		act(() => render(null, root));
		vi.unstubAllGlobals();
		fine = true;
	});

	test("is an icon button with a Polish name, the standard share icon", () => {
		act(() => render(<ShareButton boardId="abc" />, root));
		expect(button().querySelector("svg")).not.toBeNull();
		expect(button().title).toBe("Udostępnij");
		expect(button().textContent).toBe("");
	});

	test("copies the link of the board and says so for a moment", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		act(() => render(<ShareButton boardId="abc" />, root));
		act(() => button().click());
		await flush();
		expect(writeText).toHaveBeenCalledWith(`${location.origin}/b/abc`);
		expect(root.querySelector("[role='status']")?.textContent).toBe(
			"Skopiowano link",
		);
	});

	test("on a touch device with the system share sheet, opens it instead of copying", async () => {
		fine = false;
		const share = vi.fn().mockResolvedValue(undefined);
		const writeText = vi.fn();
		vi.stubGlobal("navigator", { share, clipboard: { writeText } });
		act(() => render(<ShareButton boardId="abc" title="Matma" />, root));
		act(() => button().click());
		await flush();
		expect(share).toHaveBeenCalledWith({
			title: "Matma",
			url: `${location.origin}/b/abc`,
		});
		expect(writeText).not.toHaveBeenCalled();
	});

	test("with a mouse the share sheet is not used even where it exists", async () => {
		const share = vi.fn();
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", { share, clipboard: { writeText } });
		act(() => render(<ShareButton boardId="abc" />, root));
		act(() => button().click());
		await flush();
		expect(share).not.toHaveBeenCalled();
		expect(writeText).toHaveBeenCalled();
	});

	test("a cancelled share sheet is not an error and shows no message", async () => {
		fine = false;
		const share = vi
			.fn()
			.mockRejectedValue(new DOMException("x", "AbortError"));
		vi.stubGlobal("navigator", { share });
		act(() => render(<ShareButton boardId="abc" />, root));
		act(() => button().click());
		await flush();
		expect(root.querySelector("[role='status']")).toBeNull();
	});
});
