import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Settings } from "./board/controller";
import { StrokeControls } from "./stroke-controls";

describe("StrokeControls (R-038)", () => {
	let root: HTMLElement;
	let settings: Settings;
	let onChange: (patch: Partial<Settings>) => void;

	const mount = () =>
		act(() =>
			render(<StrokeControls settings={settings} onChange={onChange} />, root),
		);
	const el = (label: string) =>
		root.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;
	const press = (label: string) => act(() => el(label)?.click());
	const move = (label: string, value: number, event: "input" | "change") =>
		act(() => {
			const input = el(label) as HTMLInputElement;
			input.value = String(value);
			input.dispatchEvent(new Event(event, { bubbles: true }));
		});

	beforeEach(() => {
		root = document.createElement("div");
		document.body.replaceChildren(root);
		settings = { tool: "pen", color: "#111", size: 5 };
		onChange = vi.fn((patch) => {
			Object.assign(settings, patch);
			mount();
		});
		mount();
	});

	describe("quick settings: the three ready widths", () => {
		test("show the current width and set another with one click", () => {
			expect(el("size 5")?.classList.contains("active")).toBe(true);
			press("size 10");
			expect(onChange).toHaveBeenCalledWith({ size: 10 });
		});

		test("a width set with the sliders that is not a preset marks none", () => {
			settings.size = 17;
			mount();
			for (const s of [2, 5, 10])
				expect(el(`size ${s}`)?.classList.contains("active")).toBe(false);
		});
	});

	describe("detailed settings: the window with sliders", () => {
		test("is closed at first and opens from its button", () => {
			expect(root.querySelector(".stroke-popover")).toBeNull();
			press("stroke settings");
			expect(root.querySelector(".stroke-popover")).not.toBeNull();
		});

		test("has a width slider in pixels and an opacity slider in percent, with the current values", () => {
			settings.size = 17;
			settings.opacity = 0.6;
			mount();
			press("stroke settings");
			expect((el("stroke width") as HTMLInputElement).value).toBe("17");
			expect((el("stroke opacity") as HTMLInputElement).value).toBe("60");
			const values = [...root.querySelectorAll(".stroke-popover .value")].map(
				(v) => v.textContent,
			);
			expect(values).toEqual(["17 px", "60%"]);
		});

		test("opacity is 100% when none was set", () => {
			press("stroke settings");
			expect((el("stroke opacity") as HTMLInputElement).value).toBe("100");
		});

		test("moving a slider changes the setting at once", () => {
			press("stroke settings");
			move("stroke width", 23, "input");
			expect(onChange).toHaveBeenLastCalledWith({ size: 23 });
			move("stroke opacity", 35, "input");
			expect(onChange).toHaveBeenLastCalledWith({ opacity: 0.35 });
		});

		test("Escape and a press outside close it", () => {
			press("stroke settings");
			act(() => {
				dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
			});
			expect(root.querySelector(".stroke-popover")).toBeNull();
			press("stroke settings");
			act(() => {
				document.body.dispatchEvent(
					new Event("pointerdown", { bubbles: true }),
				);
			});
			expect(root.querySelector(".stroke-popover")).toBeNull();
		});

		test("a press inside it does not close it", () => {
			press("stroke settings");
			act(() => {
				el("stroke width")?.dispatchEvent(
					new Event("pointerdown", { bubbles: true }),
				);
			});
			expect(root.querySelector(".stroke-popover")).not.toBeNull();
		});
	});

	describe("the line style list", () => {
		const item = (style: string) => el(`line style ${style}`);

		test("the button shows an icon, and the list opens from it with the four styles", () => {
			expect(el("line style")?.querySelector("svg")).not.toBeNull();
			expect(root.querySelector(".style-list")).toBeNull();
			press("line style");
			for (const s of ["solid", "dashed", "dotted", "natural"])
				expect(item(s)).not.toBeNull();
		});

		test("names them in Polish", () => {
			press("line style");
			const labels = [...root.querySelectorAll(".style-list button")].map(
				(b) => b.textContent,
			);
			expect(labels).toEqual([
				"Ciągła",
				"Kreskowana",
				"Kropkowana",
				"Naturalne pióro",
			]);
		});

		test("choosing one sets it and closes the list; the current one is marked", () => {
			press("line style");
			expect(item("solid")?.classList.contains("active")).toBe(true);
			press("line style natural");
			expect(onChange).toHaveBeenCalledWith({ lineStyle: "natural" });
			expect(root.querySelector(".style-list")).toBeNull();
			press("line style");
			expect(item("natural")?.classList.contains("active")).toBe(true);
		});

		test("opening one list closes the other", () => {
			press("stroke settings");
			press("line style");
			expect(root.querySelector(".stroke-popover")).toBeNull();
			expect(root.querySelector(".style-list")).not.toBeNull();
		});
	});
});
