import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Recording } from "./api";
import { clock, megabytes, RecordingControls } from "./recording-controls";

const listRecordings = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({
	listRecordings,
	recordingUrl: (b: string, id: string) => `/api/boards/${b}/recordings/${id}`,
	errorMessage: (e: unknown) => (e instanceof Error ? e.message : "Błąd"),
}));

const rec = (over: Partial<Recording> = {}): Recording => ({
	id: "r1",
	name: "Lekcja 25.11.2026, 17:30",
	createdAt: "2026-11-25T17:30:00Z",
	durationMs: 65_000,
	bytes: 12 << 20,
	finished: true,
	...over,
});

describe("RecordingControls (R-112)", () => {
	let root: HTMLElement;
	const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
	const btn = (label: string) =>
		root.querySelector(`button[aria-label='${label}']`) as HTMLButtonElement;

	beforeEach(() => {
		root = document.createElement("div");
		document.body.append(root);
		listRecordings.mockReset().mockResolvedValue([]);
	});
	afterEach(() => {
		act(() => render(null, root));
		root.remove();
	});

	test("the record button is only there where the device can record", () => {
		act(() =>
			render(<RecordingControls boardId="b" canRecord={false} />, root),
		);
		expect(btn("Nagrywaj")).toBeNull();
		expect(btn("Nagrania")).not.toBeNull();
		act(() => render(<RecordingControls boardId="b" canRecord />, root));
		expect(btn("Nagrywaj")).not.toBeNull();
	});

	test("records until the button is pressed again, then ends the recording", async () => {
		const stop = vi.fn().mockResolvedValue(undefined);
		const start = vi.fn().mockResolvedValue({ stop });
		act(() =>
			render(<RecordingControls boardId="b" canRecord start={start} />, root),
		);
		act(() => btn("Nagrywaj").click());
		await flush();
		expect(start).toHaveBeenCalledWith("b", expect.any(Function));
		expect(btn("Zakończ nagrywanie").classList.contains("recording")).toBe(
			true,
		);
		expect(root.querySelector(".rec-time")?.textContent).toBe("0:00");

		act(() => btn("Zakończ nagrywanie").click());
		await flush();
		expect(stop).toHaveBeenCalledTimes(1);
		expect(btn("Nagrywaj")).not.toBeNull();
	});

	test("says why when recording cannot start", async () => {
		const start = vi
			.fn()
			.mockRejectedValue(new Error("Brak dostępu do mikrofonu"));
		act(() =>
			render(<RecordingControls boardId="b" canRecord start={start} />, root),
		);
		act(() => btn("Nagrywaj").click());
		await flush();
		expect(root.querySelector("[role='alert']")?.textContent).toBe(
			"Brak dostępu do mikrofonu",
		);
		expect(btn("Nagrywaj")).not.toBeNull();
	});

	test("returns to idle and shows the reason when the recording ends by itself", async () => {
		let end: (why?: string) => void = () => {};
		const start = vi.fn().mockImplementation(async (_b, onEnd) => {
			end = onEnd;
			return { stop: vi.fn() };
		});
		act(() =>
			render(<RecordingControls boardId="b" canRecord start={start} />, root),
		);
		act(() => btn("Nagrywaj").click());
		await flush();
		act(() => end("Nie udało się wysłać nagrania"));
		expect(btn("Nagrywaj")).not.toBeNull();
		expect(root.querySelector("[role='alert']")?.textContent).toBe(
			"Nie udało się wysłać nagrania",
		);
	});

	test("lists the recordings of the board with a download link each", async () => {
		listRecordings.mockResolvedValue([
			rec(),
			rec({ id: "r2", name: "Druga", finished: false, bytes: 0 }),
		]);
		act(() =>
			render(<RecordingControls boardId="b" canRecord={false} />, root),
		);
		act(() => btn("Nagrania").click());
		await flush();
		expect(listRecordings).toHaveBeenCalledWith("b");
		const links = [
			...document.querySelectorAll<HTMLAnchorElement>(".recordings-pop a"),
		];
		expect(links.map((a) => a.getAttribute("href"))).toEqual([
			"/api/boards/b/recordings/r1",
			"/api/boards/b/recordings/r2",
		]);
		expect(links.every((a) => a.hasAttribute("download"))).toBe(true);
		const text = document.querySelector(".recordings-pop")?.textContent ?? "";
		expect(text).toContain("1:05");
		expect(text).toContain("12 MB");
		expect(text).toContain("w toku");
	});

	test("says so when there are no recordings", async () => {
		act(() =>
			render(<RecordingControls boardId="b" canRecord={false} />, root),
		);
		act(() => btn("Nagrania").click());
		await flush();
		expect(document.querySelector(".recordings-pop")?.textContent).toBe(
			"Brak nagrań",
		);
	});
});

describe("clock and megabytes", () => {
	test("show a length and a size", () => {
		expect(clock(0)).toBe("0:00");
		expect(clock(65_000)).toBe("1:05");
		expect(clock(3_725_000)).toBe("1:02:05");
		expect(megabytes(0)).toBe("1 MB");
		expect(megabytes(12 << 20)).toBe("12 MB");
	});
});
