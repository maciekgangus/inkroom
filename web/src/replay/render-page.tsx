import { useEffect } from "preact/hooks";
import { ImageCache } from "../board/image-cache";
import { fitCamera } from "./camera";
import type { ReplayEngine } from "./engine";
import { frameCount, frameTimeMs, keyframeEvery } from "./frames";
import { load } from "./load";
import { paintFrame } from "./paint";

/** What the renderer (R-115) asks of the page: the size, the rate and how many frames. */
export interface RenderOptions {
	width: number;
	height: number;
	fps: number;
	bitrate: number;
	/** Render only the first `seconds` of the recording (a test or a preview); all if left out. */
	seconds?: number;
}

/** What the page tells the renderer, set by the renderer before the page loads. */
interface Bridge {
	__emit?: (base64: string) => void;
	__progress?: (done: number, total: number) => void;
}

declare global {
	interface Window {
		/** The renderer's way in: ready when the recording is loaded; `encode` renders the video. */
		__replay?: {
			ready: Promise<{ durationMs: number; name: string }>;
			encode: (o: RenderOptions) => Promise<{ frames: number }>;
		};
	}
}

const base64 = (bytes: Uint8Array): string => {
	let s = "";
	for (let i = 0; i < bytes.length; i += 0x8000)
		s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
};

/** The pictures of a recording are loaded before the first frame, so none is missing from it. */
async function warmImages(engine: ReplayEngine, images: ImageCache) {
	const srcs = new Set<string>();
	const note = (s: { kind?: string; src?: string }) => {
		if (s.kind === "image" && s.src) srcs.add(s.src);
	};
	engine.seek(engine.lastEventMs + 1);
	for (const s of engine.board.strokes) note(s);
	engine.seek(0);
	const t0 = performance.now();
	while (performance.now() - t0 < 20_000) {
		let missing = 0;
		for (const s of srcs) if (!images.get(s)) missing++;
		if (missing === 0) return;
		await new Promise((r) => setTimeout(r, 100));
	}
}

/**
 * The page a headless browser opens to render a recording to video (R-115, ADR 0029): no controls,
 * only `window.__replay`. Frames are drawn with the replay engine and the board's own painting, and
 * encoded here, in the page (WebCodecs, H.264 in Annex B), so they never travel as pictures.
 */
export function RenderPage({
	boardId,
	recId,
}: {
	boardId: string;
	recId: string;
}) {
	useEffect(() => {
		const bridge = window as unknown as Bridge;
		const loaded = load(boardId, recId);
		window.__replay = {
			ready: loaded.then(({ index }) => ({
				durationMs: index.durationMs,
				name: index.name,
			})),
			encode: async (o) => {
				const { index, engine } = await loaded;
				const images = new ImageCache(boardId, () => {});
				await warmImages(engine, images);
				const canvas = document.createElement("canvas");
				canvas.width = o.width;
				canvas.height = o.height;
				const ctx = canvas.getContext("2d", { alpha: false });
				if (!ctx) throw new Error("no 2d canvas");
				const duration = Math.min(
					Math.max(index.durationMs, engine.lastEventMs),
					o.seconds ? o.seconds * 1000 : Number.POSITIVE_INFINITY,
				);
				const total = frameCount(duration, o.fps);
				let failure: Error | undefined;
				const encoder = new VideoEncoder({
					output: (chunk) => {
						const data = new Uint8Array(chunk.byteLength);
						chunk.copyTo(data);
						bridge.__emit?.(base64(data));
					},
					error: (e) => {
						failure = e instanceof Error ? e : new Error(String(e));
					},
				});
				encoder.configure({
					// Baseline: the browser's software encoder takes no more; level 3.1 up to 720p, 4.0 above.
					codec:
						o.width * o.height > 1280 * 720 ? "avc1.420028" : "avc1.42001f",
					width: o.width,
					height: o.height,
					bitrate: o.bitrate,
					framerate: o.fps,
					avc: { format: "annexb" },
				});
				const keyEvery = keyframeEvery(o.fps);
				for (let i = 0; i < total; i++) {
					if (failure) throw failure;
					const t = frameTimeMs(i, o.fps);
					engine.seek(t);
					const view = fitCamera(engine.camera(t), o.width, o.height);
					paintFrame(
						ctx,
						o.width,
						o.height,
						{
							strokes: engine.board.strokes,
							live: engine.live(),
							background: engine.background,
							lasers: engine.lasers.visible(t),
							cursors: engine.cursors(t),
							view,
						},
						images,
					);
					const frame = new VideoFrame(canvas, {
						timestamp: Math.round((i * 1e6) / o.fps),
						duration: Math.round(1e6 / o.fps),
					});
					encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
					frame.close();
					// Do not run ahead of the encoder: frames waiting for it are memory.
					while (encoder.encodeQueueSize > 8)
						await new Promise((r) => setTimeout(r, 1));
					if (i % 300 === 0) bridge.__progress?.(i, total);
				}
				await encoder.flush();
				encoder.close();
				if (failure) throw failure;
				bridge.__progress?.(total, total);
				return { frames: total };
			},
		};
		return () => {
			window.__replay = undefined;
		};
	}, [boardId, recId]);
	return <main class="center">Renderowanie…</main>;
}
