import { render } from "preact";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ZoomControls } from "./zoom-controls";

describe("ZoomControls", () => {
	let root: HTMLElement;
	let onZoomIn: () => void;
	let onZoomOut: () => void;
	let onReset: () => void;

	const mount = (scale: number) => {
		render(<ZoomControls scale={scale} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onReset={onReset} />, root);
	};
	const click = (label: string) => (root.querySelector(`[aria-label="${label}"]`) as HTMLElement).click();

	beforeEach(() => {
		root = document.createElement("div");
		onZoomIn = vi.fn();
		onZoomOut = vi.fn();
		onReset = vi.fn();
	});

	test("shows the current zoom as a rounded percentage", () => {
		mount(1.2549);
		expect(root.querySelector('[aria-label="zoom reset"]')?.textContent).toBe("125%");
	});

	test("plus and minus buttons call their handlers", () => {
		mount(1);
		click("zoom in");
		click("zoom out");
		expect(onZoomIn).toHaveBeenCalledOnce();
		expect(onZoomOut).toHaveBeenCalledOnce();
	});

	test("the percentage button resets the zoom", () => {
		mount(2);
		click("zoom reset");
		expect(onReset).toHaveBeenCalledOnce();
	});

	test("minus and plus are disabled at the limits", () => {
		mount(0.1);
		expect((root.querySelector('[aria-label="zoom out"]') as HTMLButtonElement).disabled).toBe(true);
		mount(5);
		expect((root.querySelector('[aria-label="zoom in"]') as HTMLButtonElement).disabled).toBe(true);
	});
});
