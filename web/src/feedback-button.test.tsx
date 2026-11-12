import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FeedbackButton } from "./feedback-button";

describe("FeedbackButton (R-062)", () => {
	const root = document.createElement("div");
	let fetchMock: ReturnType<typeof vi.fn>;
	const q = <T extends Element>(s: string) => root.querySelector(s) as T | null;

	beforeEach(() => {
		fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 201 }));
		vi.stubGlobal("fetch", fetchMock);
	});
	afterEach(() => {
		render(null, root);
		vi.unstubAllGlobals();
	});
	const open = async () => {
		await act(async () => render(<FeedbackButton />, root));
		await act(async () => q<HTMLButtonElement>("button")?.click());
	};
	const submit = async () => {
		await act(async () => {
			q<HTMLFormElement>("form")?.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
			// the request and its answer
			await new Promise((r) => setTimeout(r, 10));
		});
	};
	const type = async (text: string) => {
		const area = q<HTMLTextAreaElement>("textarea") as HTMLTextAreaElement;
		area.value = text;
		await act(async () => {
			area.dispatchEvent(new Event("input", { bubbles: true }));
		});
	};

	test("is a button with an exclamation mark that opens a small form", async () => {
		await act(async () => render(<FeedbackButton />, root));
		const b = q<HTMLButtonElement>("button") as HTMLButtonElement;
		expect(b.getAttribute("aria-label")).toBe("Wyślij uwagę");
		expect(q("textarea")).toBeNull();
		await act(async () => b.click());
		expect(q("textarea")).not.toBeNull();
	});

	test("cannot send an empty note", async () => {
		await open();
		const send = q<HTMLButtonElement>('button[type="submit"]');
		expect(send?.disabled).toBe(true);
		await type("   ");
		expect(send?.disabled).toBe(true);
		await type("hi");
		expect(send?.disabled).toBe(false);
	});

	test("sends the text with the page and the screen size, then thanks the person and closes", async () => {
		await open();
		await type("the eraser is too big");
		await submit();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("/api/feedback");
		expect(init.method).toBe("POST");
		const body = JSON.parse(init.body);
		expect(body.message).toBe("the eraser is too big");
		expect(body.page).toBe(location.pathname);
		expect(body.screen).toMatch(/^\d+x\d+$/);
		expect(q('[role="status"]')?.textContent).toContain("Dziękujemy za uwagę");
		expect(q('[role="status"]')?.textContent).toContain("Zajmiemy się tym");
		expect(q("textarea")).toBeNull();
	});

	test("the thanks can be closed", async () => {
		await open();
		await type("hello");
		await submit();
		expect(q('[role="status"]')).not.toBeNull();
		await act(async () =>
			q<HTMLButtonElement>('[role="status"] button')?.click(),
		);
		expect(q('[role="status"]')).toBeNull();
	});

	test("the thanks goes away by itself", async () => {
		await act(async () => render(<FeedbackButton thanksMs={30} />, root));
		await act(async () => q<HTMLButtonElement>("button")?.click());
		await type("hello");
		await submit();
		expect(q('[role="status"]')).not.toBeNull();
		await act(async () => {
			await new Promise((r) => setTimeout(r, 80));
		});
		expect(q('[role="status"]')).toBeNull();
	});

	test("keeps the text and says so when sending fails", async () => {
		fetchMock.mockResolvedValue(
			new Response('{"error":"Za dużo uwag naraz"}', { status: 429 }),
		);
		await open();
		await type("hello");
		await submit();
		expect(q('[role="alert"]')?.textContent).toContain("Za dużo uwag naraz");
		expect(q<HTMLTextAreaElement>("textarea")?.value).toBe("hello");
	});

	test("Escape closes the form", async () => {
		await open();
		await act(async () => {
			q("textarea")?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});
		expect(q("textarea")).toBeNull();
	});
});
