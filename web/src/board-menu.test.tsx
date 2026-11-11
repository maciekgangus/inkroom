import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, test, vi } from "vitest";
import { BoardMenuButton, boardMenuItems } from "./board-menu";

describe("board menu (R-014)", () => {
	test("the button reports where it is, so the menu opens under it", () => {
		const root = document.createElement("div");
		const onOpen = vi.fn();
		render(<BoardMenuButton onOpen={onOpen} />, root);
		act(() =>
			(
				root.querySelector("button[aria-label='board menu']") as HTMLElement
			).click(),
		);
		expect(onOpen).toHaveBeenCalledOnce();
		expect(onOpen.mock.calls[0][0]).toEqual({
			x: expect.any(Number),
			y: expect.any(Number),
		});
	});

	test("offers the three exports and reports the chosen one", () => {
		const onPick = vi.fn();
		const items = boardMenuItems(onPick);
		expect(items.map((i) => i.label)).toEqual([
			"PNG: widok",
			"PNG: cała tablica",
			"PDF: cała tablica",
		]);
		items[1].onSelect();
		expect(onPick).toHaveBeenCalledWith("png-board");
	});
});
