import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Recording } from "./api";
import { clock, megabytes, RecordingControls } from "./recording-controls";

const listRecordings = vi.hoisted(() => vi.fn());
const deleteRecording = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({
	listRecordings,
	deleteRecording,
	errorMessage: (e: unknown) => (e instanceof Error ? e.message : "Błąd"),
}));

const source = { snapshot: () => ({}), attach: () => () => {} } as never;

const rec = (over: Partial<Recording> = {}): Recording => ({
	id: "r1",
	name: "Lekcja 25.11.2026, 17:30",
	createdAt: "2026-11-25T17:30:00Z",
	durationMs: 65_000,
	bytes: 12 << 20,
	finished: true,
	video: "",
	videoProgress: 0,
	videoBytes: 0,
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
		deleteRecording.mockReset().mockResolvedValue(undefined);
	});
	afterEach(() => {
		act(() => render(null, root));
		root.remove();
	});

	test("the record button is only there where the device can record", () => {
		act(() =>
			render(
				<RecordingControls source={source} boardId="b" canRecord={false} />,
				root,
			),
		);
		expect(btn("Nagrywaj")).toBeNull();
		expect(btn("Nagrania")).not.toBeNull();
		act(() =>
			render(<RecordingControls source={source} boardId="b" canRecord />, root),
		);
		expect(btn("Nagrywaj")).not.toBeNull();
	});

	test("records until the button is pressed again, then ends the recording", async () => {
		const stop = vi.fn().mockResolvedValue(undefined);
		const start = vi.fn().mockResolvedValue({ stop });
		act(() =>
			render(
				<RecordingControls
					source={source}
					boardId="b"
					canRecord
					start={start}
				/>,
				root,
			),
		);
		act(() => btn("Nagrywaj").click());
		await flush();
		expect(start).toHaveBeenCalledWith("b", source, expect.any(Function));
		expect(btn("Zakończ nagrywanie").classList.contains("recording")).toBe(
			true,
		);
		expect(root.querySelector(".rec-time")?.textContent).toBe("0:00");

		act(() => btn("Zakończ nagrywanie").click());
		await flush();
		expect(stop).toHaveBeenCalledTimes(1);
		expect(btn("Nagrywaj")).not.toBeNull();
	});

	test("after the stop it says it is saving, until the end of the recording is on the server", async () => {
		let done: () => void = () => {};
		const stop = vi.fn().mockReturnValue(new Promise<void>((r) => (done = r)));
		const start = vi.fn().mockResolvedValue({ stop });
		const onRecording = vi.fn();
		act(() =>
			render(
				<RecordingControls
					source={source}
					boardId="b"
					canRecord
					start={start}
					onRecording={onRecording}
				/>,
				root,
			),
		);
		act(() => btn("Nagrywaj").click());
		await flush();
		act(() => btn("Zakończ nagrywanie").click());
		await flush();
		// Nobody can start a new one, or be told it is done, while the last part is on its way.
		expect(btn("Nagrywaj")).toBeNull();
		const saving = btn("Zapisuję nagranie") as HTMLButtonElement;
		expect(saving.disabled).toBe(true);
		expect(root.textContent).toContain("Zapisuję");
		expect(onRecording).toHaveBeenLastCalledWith(false); // the red dot is off at once
		done();
		await flush();
		expect(btn("Nagrywaj")).not.toBeNull();
	});

	test("says why when recording cannot start", async () => {
		const start = vi
			.fn()
			.mockRejectedValue(new Error("Brak dostępu do mikrofonu"));
		act(() =>
			render(
				<RecordingControls
					source={source}
					boardId="b"
					canRecord
					start={start}
				/>,
				root,
			),
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
		const start = vi.fn().mockImplementation(async (_b, _s, onEnd) => {
			end = onEnd;
			return { stop: vi.fn() };
		});
		act(() =>
			render(
				<RecordingControls
					source={source}
					boardId="b"
					canRecord
					start={start}
				/>,
				root,
			),
		);
		act(() => btn("Nagrywaj").click());
		await flush();
		act(() => end("Nie udało się wysłać nagrania"));
		expect(btn("Nagrywaj")).not.toBeNull();
		expect(root.querySelector("[role='alert']")?.textContent).toBe(
			"Nie udało się wysłać nagrania",
		);
	});

	test("the red dot is switched on while recording and off when it ends", async () => {
		const onRecording = vi.fn();
		const stop = vi.fn().mockResolvedValue(undefined);
		const start = vi.fn().mockResolvedValue({ stop });
		act(() =>
			render(
				<RecordingControls
					source={source}
					boardId="b"
					canRecord
					start={start}
					onRecording={onRecording}
				/>,
				root,
			),
		);
		expect(onRecording).not.toHaveBeenCalled(); // nothing to say before a recording
		act(() => btn("Nagrywaj").click());
		await flush();
		expect(onRecording).toHaveBeenLastCalledWith(true);
		act(() => btn("Zakończ nagrywanie").click());
		await flush();
		expect(onRecording).toHaveBeenLastCalledWith(false);
	});

	test("warns five minutes before the limit and stops at 1 h 15 min (R-094)", async () => {
		vi.useFakeTimers();
		try {
			const stop = vi.fn().mockResolvedValue(undefined);
			const start = vi.fn().mockResolvedValue({ stop });
			act(() =>
				render(
					<RecordingControls
						source={source}
						boardId="b"
						canRecord
						start={start}
					/>,
					root,
				),
			);
			await act(async () => {
				btn("Nagrywaj").click();
				await vi.advanceTimersByTimeAsync(0);
			});
			await act(async () => {
				await vi.advanceTimersByTimeAsync(69 * 60_000 + 59_000);
			});
			expect(root.querySelector("[role='status']")).toBeNull();
			await act(async () => {
				await vi.advanceTimersByTimeAsync(1_000);
			}); // 70 min
			expect(root.querySelector("[role='status']")?.textContent).toContain(
				"5 minut",
			);
			expect(stop).not.toHaveBeenCalled();
			await act(async () => {
				await vi.advanceTimersByTimeAsync(5 * 60_000);
			}); // 75 min
			expect(stop).toHaveBeenCalledTimes(1);
			expect(btn("Nagrywaj")).not.toBeNull();
			expect(root.querySelector("[role='status']")?.textContent).toContain(
				"limit",
			);
		} finally {
			vi.useRealTimers();
		}
	});

	test("only the owner may delete, and only after a second press (R-019)", async () => {
		listRecordings.mockResolvedValue([rec()]);
		act(() =>
			render(
				<RecordingControls source={source} boardId="b" canRecord={false} />,
				root,
			),
		);
		act(() => btn("Nagrania").click());
		await flush();
		expect(document.querySelector(".recordings-pop button.danger")).toBeNull();
		expect(
			document.querySelector(".recordings-pop [aria-label='Usuń nagranie']"),
		).toBeNull();

		act(() =>
			render(
				<RecordingControls
					source={source}
					boardId="b"
					canRecord={false}
					canDelete
				/>,
				root,
			),
		);
		await flush();
		const del = () =>
			document.querySelector(
				".recordings-pop [aria-label='Usuń nagranie']",
			) as HTMLButtonElement;
		act(() => del().click());
		expect(deleteRecording).not.toHaveBeenCalled(); // asks first
		const confirm = document.querySelector(
			".recordings-pop button.danger",
		) as HTMLButtonElement;
		expect(confirm.textContent).toBe("Na pewno usunąć?");
		listRecordings.mockResolvedValue([]);
		act(() => confirm.click());
		await flush();
		expect(deleteRecording).toHaveBeenCalledWith("b", "r1");
		expect(document.querySelector(".recordings-pop")?.textContent).toBe(
			"Brak nagrań",
		);
	});

	test("a recording still in progress has no download link", async () => {
		listRecordings.mockResolvedValue([rec({ finished: false, bytes: 0 })]);
		act(() =>
			render(
				<RecordingControls source={source} boardId="b" canRecord={false} />,
				root,
			),
		);
		act(() => btn("Nagrania").click());
		await flush();
		expect(document.querySelector(".recordings-pop a")).toBeNull();
		expect(document.querySelector(".recordings-pop")?.textContent).toContain(
			"w toku",
		);
	});

	test("lists the recordings of the board with a link to the player each (R-114)", async () => {
		listRecordings.mockResolvedValue([rec(), rec({ id: "r2", name: "Druga" })]);
		act(() =>
			render(
				<RecordingControls source={source} boardId="b" canRecord={false} />,
				root,
			),
		);
		act(() => btn("Nagrania").click());
		await flush();
		expect(listRecordings).toHaveBeenCalledWith("b");
		const links = [
			...document.querySelectorAll<HTMLAnchorElement>(".recordings-pop a"),
		];
		expect(links.map((a) => a.getAttribute("href"))).toEqual([
			"/b/b/r/r1",
			"/b/b/r/r2",
		]);
		expect(links.map((a) => a.textContent)).toEqual(["Odtwórz", "Odtwórz"]);
		const text = document.querySelector(".recordings-pop")?.textContent ?? "";
		expect(text).toContain("1:05");
		expect(text).toContain("12 MB");
	});

	test("links a ready video and says how far an unfinished one is (R-115)", async () => {
		listRecordings.mockResolvedValue([
			rec({ id: "r1", video: "ready", videoBytes: 5 << 20 }),
			rec({ id: "r2", video: "rendering", videoProgress: 40 }),
			rec({ id: "r3", video: "queued" }),
			rec({ id: "r4", video: "failed" }),
			rec({ id: "r5" }),
		]);
		act(() =>
			render(
				<RecordingControls source={source} boardId="b" canRecord={false} />,
				root,
			),
		);
		act(() => btn("Nagrania").click());
		await flush();
		const hrefs = [
			...document.querySelectorAll<HTMLAnchorElement>(".recordings-pop a"),
		].map((a) => a.getAttribute("href"));
		expect(hrefs.filter((h) => h?.includes("/v/"))).toEqual(["/b/b/v/r1"]);
		const items = [...document.querySelectorAll(".recordings-pop li")].map(
			(li) => li.textContent ?? "",
		);
		expect(items[1]).toContain("wideo 40%");
		expect(items[2]).toContain("wideo w kolejce");
		expect(items[3]).toContain("wideo nie wyszło");
		expect(items[4]).not.toContain("wideo ");
		expect(items[0]).not.toContain("wideo ");
	});

	test("asks again while a video is being prepared and the list is open (R-115)", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		listRecordings.mockResolvedValue([
			rec({ video: "rendering", videoProgress: 10 }),
		]);
		act(() =>
			render(
				<RecordingControls source={source} boardId="b" canRecord={false} />,
				root,
			),
		);
		act(() => btn("Nagrania").click());
		await flush();
		const asked = listRecordings.mock.calls.length;
		listRecordings.mockResolvedValue([rec({ video: "ready" })]);
		await act(async () => {
			vi.advanceTimersByTime(10_100);
		});
		await flush();
		expect(listRecordings.mock.calls.length).toBeGreaterThan(asked);
		expect(
			document.querySelector('.recordings-pop a[href="/b/b/v/r1"]'),
		).not.toBeNull();
		vi.useRealTimers();
	});

	test("says so when there are no recordings", async () => {
		act(() =>
			render(
				<RecordingControls source={source} boardId="b" canRecord={false} />,
				root,
			),
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
