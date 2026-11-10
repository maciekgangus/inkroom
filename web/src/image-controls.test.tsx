import { render } from "preact";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Settings } from "./board/controller";
import { ImageControls } from "./image-controls";

describe("ImageControls", () => {
	let root: HTMLElement;
	let settings: Settings;
	let onFile: (file: File) => void;
	let onPaste: () => void;
	let onDelete: () => void;

	const mount = (
		props: { hasSelection?: boolean; canPaste?: boolean; error?: string } = {},
	) => {
		render(
			<ImageControls
				settings={settings}
				hasSelection={props.hasSelection ?? false}
				canPaste={props.canPaste ?? false}
				error={props.error ?? ""}
				onFile={onFile}
				onPaste={onPaste}
				onDelete={onDelete}
			/>,
			root,
		);
	};
	const btn = (label: string) =>
		root.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement | null;

	beforeEach(() => {
		root = document.createElement("div");
		settings = { tool: "pen", color: "#111", size: 4 };
		onFile = vi.fn();
		onPaste = vi.fn();
		onDelete = vi.fn();
	});

	test("choosing a file hands it over and clears the input so the same file can be chosen again", () => {
		mount();
		const input = root.querySelector('input[type="file"]') as HTMLInputElement;
		expect(input.accept).toBe("image/*");
		const file = new File([new Uint8Array([1])], "a.png", {
			type: "image/png",
		});
		Object.defineProperty(input, "files", {
			value: [file],
			configurable: true,
		});
		input.dispatchEvent(new Event("change", { bubbles: true }));
		expect(onFile).toHaveBeenCalledWith(file);
	});

	test("the Obraz button opens the file picker", () => {
		mount();
		const input = root.querySelector('input[type="file"]') as HTMLInputElement;
		const click = vi.spyOn(input, "click");
		btn("add image")?.click();
		expect(click).toHaveBeenCalled();
	});

	test("the select button switches to the select tool", () => {
		mount();
		btn("select")?.click();
		expect(settings.tool).toBe("select");
	});

	test("the delete button is there only while an image is selected", () => {
		mount();
		expect(btn("delete image")).toBeNull();
		mount({ hasSelection: true });
		btn("delete image")?.click();
		expect(onDelete).toHaveBeenCalledOnce();
	});

	test("the paste button is there only where the browser allows reading the clipboard", () => {
		mount();
		expect(btn("paste image")).toBeNull();
		mount({ canPaste: true });
		btn("paste image")?.click();
		expect(onPaste).toHaveBeenCalledOnce();
	});

	test("shows an error message", () => {
		mount({ error: "Obraz jest za duży" });
		expect(root.querySelector('[role="alert"]')?.textContent).toBe(
			"Obraz jest za duży",
		);
	});
});
