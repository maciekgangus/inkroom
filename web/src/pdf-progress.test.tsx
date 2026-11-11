import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, test, vi } from "vitest";
import { PdfProgress } from "./pdf-progress";

const mount = (props: { done: number; total: number }, onCancel = vi.fn()) => {
	const root = document.createElement("div");
	render(<PdfProgress {...props} onCancel={onCancel} />, root);
	return { root, onCancel };
};

describe("PdfProgress (R-056)", () => {
	test("says which page is being loaded, of how many (12 are done, the 13th is on its way)", () => {
		const { root } = mount({ done: 12, total: 40 });
		expect(root.textContent).toContain("strona 13 z 40");
		const bar = root.querySelector("progress") as HTMLProgressElement;
		expect(bar.value).toBe(12);
		expect(bar.max).toBe(40);
	});

	test("says it is opening the file before the page count is known", () => {
		const { root } = mount({ done: 0, total: 0 });
		expect(root.textContent).toContain("Otwieranie");
	});

	test("has a Cancel button", async () => {
		const { root, onCancel } = mount({ done: 1, total: 5 });
		await act(async () =>
			(root.querySelector("button") as HTMLButtonElement).click(),
		);
		expect(onCancel).toHaveBeenCalledOnce();
		expect(root.querySelector("button")?.textContent).toContain("Anuluj");
	});
});
