import { render } from "preact";
import { beforeEach, describe, expect, test } from "vitest";
import { Viewport } from "./board/viewport";
import { cursorColor } from "./cursor-colors";
import { Cursors } from "./cursors";

describe("Cursors", () => {
	let root: HTMLElement;
	let viewport: Viewport;

	beforeEach(() => {
		root = document.createElement("div");
		viewport = new Viewport();
	});

	const items = () => [...root.querySelectorAll<HTMLElement>(".cursor")];

	test("shows each person's name", () => {
		render(
			<Cursors
				viewport={viewport}
				cursors={[
					{ id: "a", name: "Ola", x: 10, y: 20 },
					{ id: "b", name: "Kuba", x: 30, y: 40 },
				]}
			/>,
			root,
		);
		expect(items().map((e) => e.textContent)).toEqual(["Ola", "Kuba"]);
	});

	test("places a cursor at its board position as seen through the view", () => {
		viewport.x = 100;
		viewport.y = 50;
		viewport.scale = 2;
		render(
			<Cursors
				viewport={viewport}
				cursors={[{ id: "a", name: "Ola", x: 150, y: 80 }]}
			/>,
			root,
		);
		expect(items()[0].style.transform).toBe("translate(100px, 60px)");
	});

	test("colours a cursor by its owner", () => {
		render(
			<Cursors
				viewport={viewport}
				cursors={[{ id: "a", name: "Ola", x: 0, y: 0 }]}
			/>,
			root,
		);
		const probe = document.createElement("span");
		probe.style.color = cursorColor("a");
		expect(items()[0].style.color).toBe(probe.style.color);
	});

	test("never intercepts the pointer, so drawing under it still works", () => {
		render(<Cursors viewport={viewport} cursors={[]} />, root);
		expect(root.querySelector(".cursors")?.getAttribute("aria-hidden")).toBe(
			"true",
		);
	});
});
