import { afterEach, describe, expect, test, vi } from "vitest";
import { type ErrorReport, installErrorReporting } from "./error-report";

function fire(message: string, extra: Partial<ErrorEventInit> = {}) {
	window.dispatchEvent(
		new ErrorEvent("error", {
			message,
			filename: "https://inkroom.example/assets/index-abc.js",
			lineno: 10,
			colno: 5,
			error: new Error(message),
			...extra,
		}),
	);
}

function reject(reason: unknown) {
	const e = new Event("unhandledrejection") as Event & { reason: unknown };
	e.reason = reason;
	window.dispatchEvent(e);
}

describe("error reporting (R-098)", () => {
	let stop: (() => void) | null = null;
	afterEach(() => {
		stop?.();
		stop = null;
		vi.restoreAllMocks();
	});
	const install = (max?: number) => {
		const sent: ErrorReport[] = [];
		stop = installErrorReporting({ send: (r) => sent.push(r), max });
		return sent;
	};

	test("reports an uncaught error with where it happened", () => {
		const sent = install();
		fire("x is not a function");
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			message: "x is not a function",
			source: "https://inkroom.example/assets/index-abc.js",
			line: 10,
			col: 5,
		});
		expect(sent[0].stack).toContain("x is not a function");
		expect(sent[0].page).toBe(location.pathname);
		expect(sent[0].screen).toMatch(/^\d+x\d+$/);
	});

	test("reports an unhandled promise rejection", () => {
		const sent = install();
		reject(new Error("fetch failed"));
		reject("plain text reason");
		expect(sent.map((r) => r.message)).toEqual([
			"fetch failed",
			"plain text reason",
		]);
		expect(sent[0].stack).toContain("fetch failed");
	});

	test("reports the same error once per session", () => {
		const sent = install();
		fire("boom");
		fire("boom");
		fire("boom", { lineno: 11 });
		expect(sent).toHaveLength(2);
	});

	test("stops after a few different errors so a loop cannot flood the server", () => {
		const sent = install(3);
		for (let i = 0; i < 10; i++) fire(`error ${i}`);
		expect(sent).toHaveLength(3);
	});

	test("ignores the noise browsers make", () => {
		const sent = install();
		fire("ResizeObserver loop completed with undelivered notifications.");
		fire("ResizeObserver loop limit exceeded");
		fire("Script error.", { filename: "", lineno: 0, colno: 0, error: null });
		fire("");
		expect(sent).toHaveLength(0);
	});

	test("never throws, even when sending does", () => {
		stop = installErrorReporting({
			send: () => {
				throw new Error("network on fire");
			},
		});
		expect(() => fire("boom")).not.toThrow();
	});

	test("removes its listeners when stopped", () => {
		const remove = vi.spyOn(window, "removeEventListener");
		install();
		stop?.();
		stop = null;
		const names = remove.mock.calls.map((c) => c[0]);
		expect(names).toContain("error");
		expect(names).toContain("unhandledrejection");
	});

	test("sends with a beacon as JSON by default", () => {
		const beacon = vi.fn(() => true);
		vi.stubGlobal("navigator", { ...navigator, sendBeacon: beacon });
		stop = installErrorReporting();
		fire("beaconed");
		expect(beacon).toHaveBeenCalledTimes(1);
		const [url, blob] = beacon.mock.calls[0] as unknown as [string, Blob];
		expect(url).toBe("/api/client-error");
		expect(blob.type).toBe("application/json");
		vi.unstubAllGlobals();
	});

	test("falls back to fetch with keepalive when there is no beacon", () => {
		vi.stubGlobal("navigator", { ...navigator, sendBeacon: undefined });
		const f = vi.fn(() => Promise.resolve(new Response(null)));
		vi.stubGlobal("fetch", f);
		stop = installErrorReporting();
		fire("fetched");
		expect(f).toHaveBeenCalledTimes(1);
		const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
		expect(init.keepalive).toBe(true);
		expect(init.method).toBe("POST");
		vi.unstubAllGlobals();
	});
});
