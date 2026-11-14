import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resetShortcuts, toolKey } from "./shortcuts";
import { ShortcutsDialog } from "./shortcuts-dialog";

describe("ShortcutsDialog (own shortcuts)", () => {
	const root = document.createElement("div");
	let onClose: ReturnType<typeof vi.fn<() => void>>;
	let onChange: ReturnType<typeof vi.fn<() => void>>;
	const q = (s: string) => root.querySelector(s) as HTMLElement | null;
	const row = (name: string) =>
		[...root.querySelectorAll(".shortcut-row")].find((r) =>
			r.textContent?.includes(name),
		) as HTMLElement;
	const press = async (code: string) =>
		act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true }),
			);
		});

	beforeEach(async () => {
		localStorage.clear();
		resetShortcuts();
		onClose = vi.fn<() => void>();
		onChange = vi.fn<() => void>();
		await act(async () =>
			render(<ShortcutsDialog onClose={onClose} onChange={onChange} />, root),
		);
	});
	afterEach(() => render(null, root));

	test("lists every tool with its key, Select first with Q", () => {
		const names = [...root.querySelectorAll(".shortcut-row .name")].map(
			(n) => n.textContent,
		);
		expect(names).toEqual([
			"Zaznacz",
			"Pióro",
			"Tekst",
			"Łapka",
			"Gumka",
			"Linia",
			"Kształty",
			"Wskaźnik",
		]);
		expect(row("Zaznacz").querySelector("button")?.textContent).toBe("Q");
		expect(row("Pióro").querySelector("button")?.textContent).toBe("F");
	});

	test("click a key, press another: the tool has it, and the page is told", async () => {
		await act(async () => row("Pióro").querySelector("button")?.click());
		expect(row("Pióro").textContent).toContain("Naciśnij klawisz");
		await press("KeyG");
		expect(row("Pióro").querySelector("button")?.textContent).toBe("G");
		expect(toolKey("pen")?.code).toBe("KeyG");
		expect(onChange).toHaveBeenCalled();
	});

	test("a key of another tool is refused with its name, the old key stays", async () => {
		await act(async () => row("Pióro").querySelector("button")?.click());
		await press("KeyE");
		expect(q(".shortcut-error")?.textContent).toContain("Gumka");
		expect(toolKey("pen")?.code).toBe("KeyF");
	});

	test("Escape while waiting for a key cancels the wait, it does not close the window", async () => {
		await act(async () => row("Pióro").querySelector("button")?.click());
		await press("Escape");
		expect(row("Pióro").textContent).not.toContain("Naciśnij klawisz");
		expect(onClose).not.toHaveBeenCalled();
	});

	test("reset brings the defaults back", async () => {
		await act(async () => row("Pióro").querySelector("button")?.click());
		await press("KeyG");
		await act(async () => q(".shortcut-reset")?.click());
		expect(row("Pióro").querySelector("button")?.textContent).toBe("F");
		expect(toolKey("pen")?.code).toBe("KeyF");
	});

	test("the close button closes it", async () => {
		await act(async () => q(".shortcut-close")?.click());
		expect(onClose).toHaveBeenCalledOnce();
	});
});
