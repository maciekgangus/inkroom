import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { syncAccountShortcuts } from "./account-shortcuts";
import {
	exportShortcuts,
	resetShortcuts,
	setShortcut,
	setShortcutSync,
	toolKey,
} from "./shortcuts";

describe("syncAccountShortcuts (R-086)", () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	const answer = (shortcuts: Record<string, string>) =>
		fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
			init?.method === "PUT"
				? new Response(null, { status: 204 })
				: new Response(JSON.stringify({ shortcuts }), { status: 200 }),
		);
	const puts = () =>
		fetchMock.mock.calls
			.filter(([, init]) => init?.method === "PUT")
			.map(([, init]) => JSON.parse(init.body));

	beforeEach(() => {
		localStorage.clear();
		resetShortcuts();
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});
	afterEach(() => {
		setShortcutSync(null);
		vi.unstubAllGlobals();
	});

	test("the account's keys win over this device's", async () => {
		setShortcut("pen", "KeyB");
		answer({ eraser: "KeyX" });
		await syncAccountShortcuts();
		expect(exportShortcuts()).toEqual({ eraser: "KeyX" });
		expect(toolKey("eraser")?.code).toBe("KeyX");
		expect(puts()).toEqual([]);
	});

	test("an account with none takes this device's keys", async () => {
		setShortcut("pen", "KeyB");
		answer({});
		await syncAccountShortcuts();
		expect(puts()).toEqual([{ shortcuts: { pen: "KeyB" } }]);
	});

	test("later changes are sent to the account", async () => {
		answer({});
		await syncAccountShortcuts();
		setShortcut("line", "KeyN");
		await Promise.resolve();
		expect(puts()).toEqual([{ shortcuts: { line: "KeyN" } }]);
	});

	test("a failing server leaves the local keys alone", async () => {
		setShortcut("pen", "KeyB");
		fetchMock.mockRejectedValue(new Error("offline"));
		await syncAccountShortcuts();
		expect(toolKey("pen")?.code).toBe("KeyB");
	});
});
