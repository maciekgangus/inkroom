import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PlayIndex } from "./load";
import { POLL_MS, VideoView } from "./video-view";

const boardInfo = vi.hoisted(() => vi.fn());
const renameRecording = vi.hoisted(() => vi.fn());
vi.mock("../api", () => ({ boardInfo, renameRecording }));

const B = "b".repeat(32);
const R = "c".repeat(32);

const index = (over: Partial<PlayIndex> = {}): PlayIndex => ({
	v: 1,
	name: "Lekcja",
	durationMs: 65_000,
	mime: "audio/webm",
	audio: "/a",
	snapshot: "/s",
	segments: [],
	videoState: "",
	videoProgress: 0,
	...over,
});

describe("VideoView (R-115)", () => {
	let root: HTMLElement;
	let answers: (PlayIndex | number)[];
	const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		root = document.createElement("div");
		document.body.append(root);
		boardInfo.mockResolvedValue({ owner: false });
		answers = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				const next = answers.length > 1 ? answers.shift() : answers[0];
				if (typeof next === "number")
					return new Response(
						JSON.stringify({ error: "Nie ma takiego nagrania" }),
						{ status: next },
					);
				return new Response(JSON.stringify(next));
			}),
		);
	});
	afterEach(() => {
		render(null, root);
		root.remove();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	const show = async () => {
		act(() => render(<VideoView boardId={B} recId={R} />, root));
		await flush();
	};

	test("plays a ready video in an ordinary player, with a way to download it", async () => {
		answers = [
			index({ videoState: "ready", video: "https://bucket.test/v.mp4?get" }),
		];
		await show();
		const video = root.querySelector("video") as HTMLVideoElement;
		expect(video.getAttribute("src")).toBe("https://bucket.test/v.mp4?get");
		expect(video.controls).toBe(true);
		const links = [...root.querySelectorAll("a")].map((a) => [
			a.textContent,
			a.getAttribute("href"),
		]);
		expect(links).toContainEqual([
			"Pobierz wideo",
			`/api/boards/${B}/recordings/${R}/video`,
		]);
		expect(links).toContainEqual(["Odtwórz na tablicy", `/b/${B}/r/${R}`]);
		expect(root.textContent).toContain("Lekcja");
	});

	test("says that a video waits in the queue, and asks again until it is ready", async () => {
		answers = [
			index({ videoState: "queued" }),
			index({ videoState: "ready", video: "/v.mp4" }),
		];
		await show();
		expect(root.textContent).toContain("Wideo czeka w kolejce");
		expect(root.querySelector("video")).toBeNull();
		await act(async () => {
			vi.advanceTimersByTime(POLL_MS + 10);
		});
		await flush();
		expect(root.querySelector("video")).not.toBeNull();
		expect(root.textContent).not.toContain("w kolejce");
	});

	test("shows how far the rendering is", async () => {
		answers = [index({ videoState: "rendering", videoProgress: 42 })];
		await show();
		expect(root.textContent).toContain("Przygotowuję wideo… 42%");
		const bar = root.querySelector("progress") as HTMLProgressElement;
		expect(bar.value).toBe(42);
		expect(root.textContent).toContain("1:05");
	});

	test("does not ask again once the rendering failed, and points at the board's player", async () => {
		answers = [index({ videoState: "failed" })];
		await show();
		expect(root.textContent).toContain("Nie udało się przygotować wideo");
		const asked = (fetch as unknown as { mock: { calls: unknown[] } }).mock
			.calls.length;
		await act(async () => {
			vi.advanceTimersByTime(POLL_MS * 3);
		});
		expect(
			(fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
		).toBe(asked);
	});

	test("says so for a recording that has no video", async () => {
		answers = [index()];
		await show();
		expect(root.textContent).toContain("Ta lekcja nie ma wideo");
		expect(root.querySelector("a[download]")).toBeNull();
	});

	test("shows the reason when the recording cannot be read", async () => {
		answers = [404];
		await show();
		expect(root.textContent).toContain("Nie można pokazać wideo");
		expect(root.textContent).toContain("Nie ma takiego nagrania");
	});

	test("the owner can rename the recording from the video page", async () => {
		boardInfo.mockResolvedValue({ owner: true });
		renameRecording.mockResolvedValue(undefined);
		answers = [index({ videoState: "ready", video: "/v.mp4" })];
		await show();
		expect(root.querySelector(".name-edit")).not.toBeNull();
	});
});
