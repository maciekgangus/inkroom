import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, test, vi } from "vitest";
import { UpdateBanner } from "./update-banner";
import { VersionWatch } from "./version";

const setup = async (server = "v2") => {
	const watch = new VersionWatch(
		"v1",
		async () => server,
		() => 0,
		null,
	);
	const root = document.createElement("div");
	document.body.append(root);
	const reload = vi.fn();
	await act(() => {
		render(<UpdateBanner watch={watch} reload={reload} />, root);
	});
	return { watch, root, reload };
};
const button = (root: HTMLElement, label: string) =>
	[...root.querySelectorAll("button")].find(
		(b) =>
			b.textContent?.includes(label) || b.getAttribute("aria-label") === label,
	) as HTMLButtonElement;

describe("UpdateBanner (R-099)", () => {
	test("is not there while the versions match", async () => {
		const { watch, root } = await setup("v1");
		await act(() => watch.check());
		expect(root.querySelector(".update-banner")).toBeNull();
	});

	test("offers a reload when a newer version is out", async () => {
		const { watch, root, reload } = await setup();
		await act(() => watch.check());
		expect(root.textContent).toContain("Dostępna nowa wersja Inkroom");
		button(root, "Odśwież").click();
		expect(reload).toHaveBeenCalledOnce();
	});

	test("goes away with the cross and does not come back for the same version", async () => {
		const { watch, root } = await setup();
		await act(() => watch.check());
		await act(() => button(root, "Zamknij").click());
		expect(root.querySelector(".update-banner")).toBeNull();
		await act(() => watch.check({ force: true }));
		expect(root.querySelector(".update-banner")).toBeNull();
	});

	test("waits for the pen to go up before it appears", async () => {
		const { watch, root } = await setup();
		await act(() => {
			window.dispatchEvent(new Event("pointerdown"));
		});
		await act(() => watch.check());
		expect(root.querySelector(".update-banner")).toBeNull();
		await act(() => {
			window.dispatchEvent(new Event("pointerup"));
		});
		expect(root.querySelector(".update-banner")).not.toBeNull();
	});

	test("a press on the banner itself does not hide it (that would eat the click)", async () => {
		const { watch, root } = await setup();
		await act(() => watch.check());
		const reload = button(root, "Odśwież");
		await act(() => {
			reload.dispatchEvent(new Event("pointerdown", { bubbles: true }));
		});
		expect(root.querySelector(".update-banner")).not.toBeNull();
	});
});
