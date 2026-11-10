import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ContextMenu, type MenuItem } from "./context-menu";

describe("ContextMenu", () => {
	let root: HTMLElement;
	let onClose: () => void;
	let copy: () => void;
	let remove: () => void;

	beforeEach(() => {
		document.body.replaceChildren();
		root = document.createElement("div");
		document.body.append(root);
		onClose = vi.fn();
		copy = vi.fn();
		remove = vi.fn();
	});

	const mount = (extra: Partial<MenuItem> = {}) => {
		const items: MenuItem[] = [
			{ label: "Kopiuj", icon: "copy", onSelect: copy },
			{ label: "Usuń", icon: "trash", onSelect: remove, ...extra },
		];
		act(() =>
			render(
				<ContextMenu x={50} y={60} items={items} onClose={onClose} />,
				root,
			),
		);
	};
	const item = (label: string) =>
		Array.from(
			root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
		).find((b) => b.textContent === label) as HTMLButtonElement;

	test("lists the items with an icon and a label, at the click position", () => {
		mount();
		const menu = root.querySelector('[role="menu"]') as HTMLElement;
		expect(menu.style.left).toBe("50px");
		expect(menu.style.top).toBe("60px");
		expect(item("Kopiuj").querySelector("svg")).not.toBeNull();
		expect(root.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
	});

	test("choosing an item runs it and closes the menu", () => {
		mount();
		item("Kopiuj").click();
		expect(copy).toHaveBeenCalledOnce();
		expect(onClose).toHaveBeenCalledOnce();
	});

	test("a disabled item does nothing", () => {
		mount({ disabled: true });
		item("Usuń").click();
		expect(remove).not.toHaveBeenCalled();
		expect(onClose).not.toHaveBeenCalled();
	});

	test("Escape and a press outside close it, a press inside does not", () => {
		mount();
		item("Kopiuj").dispatchEvent(new Event("pointerdown", { bubbles: true }));
		expect(onClose).not.toHaveBeenCalled();
		document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
		expect(onClose).toHaveBeenCalledTimes(1);
		dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		expect(onClose).toHaveBeenCalledTimes(2);
	});
});
