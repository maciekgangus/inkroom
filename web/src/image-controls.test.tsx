import { render } from "preact";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ImageControls } from "./image-controls";

describe("ImageControls", () => {
	let root: HTMLElement;
	let onFile: (file: File) => void;
	let onPaste: () => void;
	let onDelete: () => void;

	const mount = (
		props: { hasSelection?: boolean; canPaste?: boolean; fine?: boolean } = {},
	) => {
		render(
			<ImageControls
				hasSelection={props.hasSelection ?? false}
				canPaste={props.canPaste ?? false}
				fine={props.fine ?? false}
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

	test("the add button is an icon, not a text label, with a Polish tooltip", () => {
		mount();
		expect(btn("add image")?.querySelector("svg")).not.toBeNull();
		expect(btn("add image")?.textContent).toBe("");
		expect(btn("add image")?.title).toBe("Obraz z pliku");
	});

	test("the add button opens the file picker", () => {
		mount();
		const input = root.querySelector('input[type="file"]') as HTMLInputElement;
		const click = vi.spyOn(input, "click");
		btn("add image")?.click();
		expect(click).toHaveBeenCalled();
	});

	test("on a PC (fine pointer) only adding from a file is there, the context menu does the rest", () => {
		mount({ fine: true, canPaste: true, hasSelection: true });
		expect(btn("add image")).not.toBeNull();
		expect(btn("paste image")).toBeNull();
		expect(btn("delete selection")).toBeNull();
	});

	test("on a tablet the delete button is there only while something is selected", () => {
		mount();
		expect(btn("delete selection")).toBeNull();
		mount({ hasSelection: true });
		btn("delete selection")?.click();
		expect(onDelete).toHaveBeenCalledOnce();
	});

	test("on a tablet the paste button is there only where the browser allows reading the clipboard", () => {
		mount();
		expect(btn("paste image")).toBeNull();
		mount({ canPaste: true });
		btn("paste image")?.click();
		expect(onPaste).toHaveBeenCalledOnce();
	});
});
