import { render } from "preact";
import { describe, expect, test, vi } from "vitest";
import { FollowBar, watchersLabel } from "./follow-bar";

const mount = (props: Partial<Parameters<typeof FollowBar>[0]> = {}) => {
	const root = document.createElement("div");
	const fns = {
		onStop: vi.fn(),
		onJoin: vi.fn(),
		onDismiss: vi.fn(),
		onBack: vi.fn(),
	};
	render(<FollowBar watchers={0} {...fns} {...props} />, root);
	return { root, ...fns };
};
const button = (root: HTMLElement, label: string) =>
	[...root.querySelectorAll("button")].find(
		(b) =>
			b.textContent?.includes(label) || b.getAttribute("aria-label") === label,
	) as HTMLButtonElement;

describe("FollowBar (R-093)", () => {
	test("shows nothing when there is nothing to say", () => {
		expect(mount().root.querySelector(".follow-chip")).toBeNull();
	});

	test("says whom we follow and stops on the cross", () => {
		const m = mount({ following: "Anna" });
		expect(m.root.textContent).toContain("Śledzisz: Anna");
		button(m.root, "Przestań śledzić").click();
		expect(m.onStop).toHaveBeenCalledOnce();
	});

	test("the invitation can be joined or dismissed", () => {
		const m = mount({ invite: "Anna" });
		expect(m.root.textContent).toContain(
			"Prowadzący zaprasza do wspólnego widoku",
		);
		button(m.root, "Dołącz").click();
		expect(m.onJoin).toHaveBeenCalledOnce();
		button(m.root, "Odrzuć").click();
		expect(m.onDismiss).toHaveBeenCalledOnce();
	});

	test("after moving the view ourselves the way back is offered", () => {
		const m = mount({ lost: "Anna" });
		button(m.root, "Wróć do widoku: Anna").click();
		expect(m.onBack).toHaveBeenCalledOnce();
	});

	test("the owner can invite everybody to look where they look", () => {
		const onShowMyView = vi.fn();
		const m = mount({ onShowMyView });
		button(m.root, "Pokaż mój widok").click();
		expect(onShowMyView).toHaveBeenCalledOnce();
	});

	test("without the handler there is no such button", () => {
		expect(mount().root.textContent).not.toContain("Pokaż mój widok");
	});

	test("it does not offer the way back while following", () => {
		const m = mount({ following: "Anna", lost: "Anna" });
		expect(m.root.textContent).not.toContain("Wróć");
	});

	test("a notice is shown", () => {
		const m = mount({ notice: "Ta osoba właśnie śledzi Ciebie" });
		expect(m.root.textContent).toContain("Ta osoba właśnie śledzi Ciebie");
	});

	test("the followed person is told how many watch, quietly", () => {
		const m = mount({ watchers: 2 });
		expect(m.root.textContent).toContain("2 osoby Cię śledzą");
	});
});

describe("watchersLabel", () => {
	test("Polish plural forms", () => {
		expect(watchersLabel(1)).toBe("1 osoba Cię śledzi");
		expect(watchersLabel(2)).toBe("2 osoby Cię śledzą");
		expect(watchersLabel(4)).toBe("4 osoby Cię śledzą");
		expect(watchersLabel(5)).toBe("5 osób Cię śledzi");
		expect(watchersLabel(12)).toBe("12 osób Cię śledzi");
		expect(watchersLabel(22)).toBe("22 osoby Cię śledzą");
	});
});
