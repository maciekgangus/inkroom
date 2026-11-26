import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PersonPopover } from "./person-popover";

let root: HTMLDivElement;

afterEach(() => {
	if (root) {
		render(null, root);
		root.remove();
	}
});

describe("PersonPopover (R-123)", () => {
	test("renders identity, friend badge, subtitle, actions, and note", () => {
		root = document.createElement("div");
		document.body.append(root);
		const onFollow = vi.fn();
		const onAdd = vi.fn();
		const onClose = vi.fn();
		render(
			<PersonPopover
				x={120}
				y={80}
				username="ania.k"
				subtitle="Konto Inkroom"
				isFriend
				note="Testowa uwaga"
				actions={[
					{ label: "Śledź widok", icon: "eye", onSelect: onFollow },
					{
						label: "Dodaj do znajomych",
						icon: "user-plus",
						tone: "accent",
						sepBefore: true,
						onSelect: onAdd,
					},
				]}
				onClose={onClose}
			/>,
			root,
		);

		expect(root.querySelector(".person-popover-name")?.textContent).toBe(
			"ania.k",
		);
		expect(root.querySelector(".person-friend-badge")?.textContent).toContain(
			"Znajomy",
		);
		expect(root.querySelector(".person-popover-sub")?.textContent).toBe(
			"Konto Inkroom",
		);
		expect(root.querySelector(".person-popover-note")?.textContent).toBe(
			"Testowa uwaga",
		);
		expect(root.querySelector(".popover-sep")).not.toBeNull();

		const addBtn = [...root.querySelectorAll('button[role="menuitem"]')].find(
			(b) => b.textContent?.includes("Dodaj do znajomych"),
		) as HTMLButtonElement;
		act(() => addBtn.click());
		expect(onAdd).toHaveBeenCalledOnce();
		expect(onClose).toHaveBeenCalledOnce();
	});

	test("closes on Escape key", () => {
		root = document.createElement("div");
		document.body.append(root);
		const onClose = vi.fn();
		act(() => {
			render(
				<PersonPopover
					x={50}
					y={50}
					username="tomek"
					actions={[]}
					onClose={onClose}
				/>,
				root,
			);
		});
		act(() => {
			dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		});
		expect(onClose).toHaveBeenCalledOnce();
	});
});
