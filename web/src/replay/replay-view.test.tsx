import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setTheme } from "../theme";
import type { PlayIndex } from "./load";
import { ReplayView } from "./replay-view";

const boardInfo = vi.hoisted(() => vi.fn());
const renameRecording = vi.hoisted(() => vi.fn());
vi.mock("../api", () => ({ boardInfo, renameRecording }));

const B = "b".repeat(32);
const R = "c".repeat(32);

interface RecordedDraw {
	strokeStyles: string[];
	strokeCount: number;
}

function installCanvasFake() {
	const contexts = new Map<HTMLCanvasElement, RecordedDraw>();
	const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
	getContext.mockImplementation(function (this: HTMLCanvasElement) {
		let state = contexts.get(this);
		if (!state) {
			state = { strokeStyles: [], strokeCount: 0 };
			contexts.set(this, state);
		}
		const rec = state;
		let currentStrokeStyle = "#000000";
		const ctx = new Proxy(
			{},
			{
				get: (_t, k) => {
					if (k === "canvas") return this;
					if (k === "strokeStyle") return currentStrokeStyle;
					if (k === "stroke")
						return () => {
							rec.strokeCount++;
							rec.strokeStyles.push(currentStrokeStyle);
						};
					return () => ctx;
				},
				set: (_t, k, v) => {
					if (k === "strokeStyle") currentStrokeStyle = String(v);
					return true;
				},
			},
		);
		return ctx as unknown as CanvasRenderingContext2D;
	});
	return {
		boardDraws: () => {
			const el = document.querySelector<HTMLCanvasElement>("canvas#board");
			return el ? contexts.get(el) : undefined;
		},
		restore: () => getContext.mockRestore(),
	};
}

describe("ReplayView (R-114)", () => {
	let root: HTMLElement;
	let canvasFake: ReturnType<typeof installCanvasFake>;
	const playSpy = vi.fn(async () => {});
	const pauseSpy = vi.fn();

	const flush = () =>
		act(
			() =>
				new Promise<void>((r) => {
					setTimeout(r, 50);
				}),
		);

	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		localStorage.clear();
		setTheme("light");
		vi.stubGlobal(
			"Path2D",
			class {
				moveTo() {}
				lineTo() {}
				quadraticCurveTo() {}
				closePath() {}
				rect() {}
				ellipse() {}
				arc() {}
			},
		);
		canvasFake = installCanvasFake();
		vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(playSpy);
		vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pauseSpy);

		boardInfo.mockResolvedValue({ owner: true });
		renameRecording.mockResolvedValue(undefined);
		const index: PlayIndex = {
			v: 1,
			name: "Lekcja 1",
			durationMs: 65_000,
			mime: "audio/webm",
			audio: "/api/audio",
			snapshot: "/api/snapshot",
			segments: [],
			videoState: "",
			videoProgress: 0,
		};
		const snapshot = {
			v: 1,
			background: "grid",
			view: { minX: 0, minY: 0, maxX: 800, maxY: 600 },
			win: { w: 800, h: 600 },
			strokes: [
				{
					id: "s1",
					authorId: "a",
					color: "#111111",
					size: 4,
					z: 1,
					kind: "line",
					points: [
						[20, 20, 0.5],
						[120, 20, 0.5],
					],
				},
			],
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				if (url.endsWith("/play")) return new Response(JSON.stringify(index));
				if (url.endsWith("/snapshot"))
					return new Response(JSON.stringify(snapshot));
				return new Response("[]");
			}),
		);
		root = document.createElement("div");
		document.body.append(root);
	});

	afterEach(() => {
		render(null, root);
		root.remove();
		canvasFake.restore();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.useRealTimers();
		vi.clearAllMocks();
		localStorage.clear();
		delete document.documentElement.dataset.theme;
	});

	const mount = async () => {
		act(() => render(<ReplayView boardId={B} recId={R} />, root));
		await flush();
		await flush();
		expect(root.querySelector("audio")).not.toBeNull();
	};

	test("draws the board's grid background and repaints strokes in the new theme even while paused", async () => {
		await mount();
		const draws = canvasFake.boardDraws();
		expect(draws).toBeDefined();
		// Grid background adds grid + cluster strokes in addition to the element stroke (#111111).
		expect(draws?.strokeStyles.length).toBeGreaterThanOrEqual(3);
		expect(draws?.strokeStyles).toContain("#111111");

		const countBeforeTheme = draws?.strokeCount ?? 0;
		act(() => setTheme("dark"));
		await flush();

		// Switching theme while paused repaints the committed canvas with the dark-mode ink colour.
		expect(draws?.strokeCount).toBeGreaterThan(countBeforeTheme);
		expect(draws?.strokeStyles.slice(countBeforeTheme)).toContain("#8f8fff");
	});

	test("ignores Space and Arrow shortcuts while typing a recording name or adjusting the seek slider", async () => {
		await mount();
		const audio = root.querySelector("audio") as HTMLAudioElement;
		expect(audio).not.toBeNull();

		const editBtn = root.querySelector(
			'button[aria-label="Zmień nazwę nagrania"]',
		) as HTMLButtonElement;
		act(() => editBtn.click());
		const input = root.querySelector("input.name-field") as HTMLInputElement;
		expect(input).not.toBeNull();
		input.focus();

		const spaceInInput = new KeyboardEvent("keydown", {
			key: " ",
			bubbles: true,
			cancelable: true,
		});
		act(() => {
			input.dispatchEvent(spaceInInput);
			input.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "ArrowRight",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(spaceInInput.defaultPrevented).toBe(false);
		expect(playSpy).not.toHaveBeenCalled();
		expect(audio.currentTime).toBe(0);

		// Cancel rename, focus the range slider: ArrowRight must not trigger the 5s global seek.
		act(() => {
			input.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});
		const slider = root.querySelector("input.replay-seek") as HTMLInputElement;
		slider.focus();
		act(() => {
			slider.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "ArrowRight",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(audio.currentTime).toBe(0);

		// Outside inputs/controls, global shortcuts work normally.
		act(() => {
			document.body.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "ArrowRight",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(audio.currentTime).toBe(5);

		const spaceOnBody = new KeyboardEvent("keydown", {
			key: " ",
			bubbles: true,
			cancelable: true,
		});
		act(() => {
			document.body.dispatchEvent(spaceOnBody);
		});
		expect(spaceOnBody.defaultPrevented).toBe(true);
		expect(playSpy).toHaveBeenCalledTimes(1);
	});
});
