import { useEffect, useRef, useState } from "preact/hooks";
import * as api from "../api";
import type { Background } from "../board/background";
import { CanvasRenderer } from "../board/canvas-renderer";
import { ImageCache } from "../board/image-cache";
import { Viewport } from "../board/viewport";
import { Cursors } from "../cursors";
import { EditableName } from "../editable-name";
import { Icon } from "../icon";
import { clock } from "../recording-controls";
import { currentTheme, displayColor, useTheme } from "../theme";
import { fitCamera } from "./camera";
import { BG, BOARD, LIVE, type ReplayEngine } from "./engine";
import { load, type PlayIndex } from "./load";

const RATES = [0.5, 1, 1.5, 2];

interface Props {
	boardId: string;
	recId: string;
}

/**
 * The player of a recorded lesson (R-114): the sound, and the board drawn again from the event
 * log with the same renderer as the live board, in step with the sound's clock. Read only.
 */
export function ReplayView({ boardId, recId }: Props) {
	const [loaded, setLoaded] = useState<
		{ index: PlayIndex; engine: ReplayEngine } | { error: string } | null
	>(null);
	const [background, setBackground] = useState<Background>("plain");
	const [cursors, setCursors] = useState<
		{ id: string; name: string; x: number; y: number }[]
	>([]);
	const [playing, setPlaying] = useState(false);
	const [time, setTime] = useState(0);
	const [rate, setRate] = useState(1);
	const [audioError, setAudioError] = useState(false);
	/** The recording's name (the owner may change it) and whether the viewer is the board's owner. */
	const [name, setName] = useState("");
	const [owner, setOwner] = useState(false);
	const theme = useTheme();
	const committedRef = useRef<HTMLCanvasElement>(null);
	const liveRef = useRef<HTMLCanvasElement>(null);
	const audioRef = useRef<HTMLAudioElement>(null);
	const viewport = useRef(new Viewport()).current;
	/** Draws the frame at the time held in `at` (set by the effect below). */
	const frame = useRef<(force?: boolean) => void>(() => {});
	const at = useRef(0); // the time shown, in ms
	const playingRef = useRef(false);

	useEffect(() => {
		let gone = false;
		load(boardId, recId).then(
			(l) => !gone && setLoaded(l),
			(e) =>
				!gone && setLoaded({ error: e instanceof Error ? e.message : "Błąd" }),
		);
		return () => {
			gone = true;
		};
	}, [boardId, recId]);

	useEffect(() => {
		let gone = false;
		api.boardInfo(boardId).then(
			(info) => !gone && setOwner(!!info?.owner),
			() => {},
		);
		return () => {
			gone = true;
		};
	}, [boardId]);

	const ready = loaded && "engine" in loaded ? loaded : null;
	useEffect(() => {
		if (ready) setName(ready.index.name);
	}, [ready]);
	const duration = ready
		? Math.max(ready.index.durationMs, ready.engine.lastEventMs)
		: 0;

	useEffect(() => {
		const committed = committedRef.current;
		const live = liveRef.current;
		const audio = audioRef.current;
		if (!ready || !committed || !live || !audio) return;
		const { engine } = ready;
		const images = new ImageCache(boardId, () =>
			canvas.redraw(engine.board.strokes),
		);
		const canvas = new CanvasRenderer(committed, live, viewport, images);
		canvas.ink = (c) => displayColor(c, currentTheme());
		let raf = 0;
		let shown = "";
		let lasersShown = 0;
		let lastUi = 0;
		let boardDirty = true;

		const paint = (force = false) => {
			raf = 0;
			const t = playingRef.current ? audio.currentTime * 1000 : at.current;
			at.current = t;
			const changed = engine.seek(t);
			if (changed & BG || force) setBackground(engine.background);
			if (changed & BOARD || boardDirty) {
				canvas.redraw(engine.board.strokes);
				boardDirty = false;
			}
			if (changed & (BOARD | LIVE) || force)
				canvas.setRemoteLive(engine.live());
			const cam = fitCamera(engine.camera(t), innerWidth, innerHeight);
			if (
				cam.x !== viewport.x ||
				cam.y !== viewport.y ||
				cam.scale !== viewport.scale
			) {
				viewport.x = cam.x;
				viewport.y = cam.y;
				viewport.scale = cam.scale;
				canvas.moveView();
			}
			const lines = engine.lasers.visible(t);
			if (lines.length > 0 || lasersShown > 0) canvas.setLasers(lines);
			lasersShown = lines.length;
			const cs = engine.cursors(t);
			const key = JSON.stringify(cs);
			if (key !== shown) {
				shown = key;
				setCursors(cs);
			} else if (cs.length > 0) {
				setCursors(cs); // a cursor moves with the camera even when it did not
			}
			const now = performance.now();
			if (force || now - lastUi > 100) {
				lastUi = now;
				setTime(t);
			}
			if (playingRef.current) raf = requestAnimationFrame(() => paint());
		};
		frame.current = (force = false) => {
			if (!raf) raf = requestAnimationFrame(() => paint(force));
		};
		const resize = () => {
			canvas.resize();
			boardDirty = true;
			frame.current(true);
		};
		resize();
		addEventListener("resize", resize);
		const ended = () => {
			playingRef.current = false;
			setPlaying(false);
			at.current = duration;
			frame.current(true);
		};
		audio.addEventListener("ended", ended);
		return () => {
			removeEventListener("resize", resize);
			audio.removeEventListener("ended", ended);
			cancelAnimationFrame(raf);
			frame.current = () => {};
		};
		// biome-ignore lint/correctness/useExhaustiveDependencies: set up once per recording
	}, [ready, boardId, viewport, duration]);

	// The grid is drawn on the board canvas: tell it the kind and the theme's colour (as the board does).
	useEffect(() => {
		frame.current(true);
		// biome-ignore lint/correctness/useExhaustiveDependencies: a new theme or backdrop repaints
	}, [background, theme]);

	const seek = (ms: number) => {
		const t = Math.max(0, Math.min(duration, ms));
		at.current = t;
		if (audioRef.current) audioRef.current.currentTime = t / 1000;
		setTime(t);
		frame.current(true);
	};
	const toggle = async () => {
		const audio = audioRef.current;
		if (!audio) return;
		if (playingRef.current) {
			audio.pause();
			playingRef.current = false;
			setPlaying(false);
			return;
		}
		if (at.current >= duration - 100) seek(0);
		audio.playbackRate = rate;
		try {
			await audio.play();
		} catch {
			setAudioError(true);
			return;
		}
		playingRef.current = true;
		setPlaying(true);
		frame.current();
	};
	useEffect(() => {
		const key = (e: KeyboardEvent) => {
			if (!ready) return;
			if (e.key === " ") {
				e.preventDefault();
				void toggle();
			} else if (e.key === "ArrowLeft") seek(at.current - 5000);
			else if (e.key === "ArrowRight") seek(at.current + 5000);
		};
		addEventListener("keydown", key);
		return () => removeEventListener("keydown", key);
	});

	if (loaded && "error" in loaded) {
		return (
			<main class="center">
				<h1>Nie można odtworzyć nagrania</h1>
				<p class="muted">{loaded.error}</p>
				<a class="nav-link" href={`/b/${boardId}`}>
					Wróć do tablicy
				</a>
			</main>
		);
	}

	return (
		<>
			<div class="board-bg" data-background={background} />
			<canvas id="board" ref={committedRef} />
			<canvas id="live" ref={liveRef} />
			<Cursors cursors={cursors} viewport={viewport} />
			<div class="replay-top">
				<a class="replay-back" href={`/b/${boardId}`}>
					← Tablica
				</a>
				{ready ? (
					<EditableName
						class="replay-name"
						name={name || ready.index.name}
						editable={owner}
						onSave={async (next) => {
							await api.renameRecording(boardId, recId, next);
							setName(next);
						}}
					/>
				) : (
					<span class="replay-name">Wczytywanie…</span>
				)}
				{ready?.index.video && (
					<a class="replay-back" href={`/b/${boardId}/v/${recId}`}>
						Wideo
					</a>
				)}
			</div>
			{ready && (
				<>
					{/* biome-ignore lint/a11y/useMediaCaption: the recording is a lesson's own voice */}
					<audio
						ref={audioRef}
						src={ready.index.audio}
						preload="auto"
						onError={() => setAudioError(true)}
					/>
					<section class="replay-bar" aria-label="Odtwarzacz">
						<button
							type="button"
							class="replay-play"
							aria-label={playing ? "Pauza" : "Odtwórz"}
							title={playing ? "Pauza (spacja)" : "Odtwórz (spacja)"}
							onClick={() => void toggle()}
						>
							<Icon name={playing ? "pause" : "play"} />
						</button>
						<span class="replay-time">
							{clock(time)} / {clock(duration)}
						</span>
						<input
							type="range"
							class="replay-seek"
							aria-label="Przewiń"
							min={0}
							max={Math.max(1, Math.round(duration))}
							step={100}
							value={Math.round(time)}
							onInput={(e) => seek(Number(e.currentTarget.value))}
						/>
						<span class="replay-rate-wrap">
							<select
								class="replay-rate"
								aria-label="Prędkość"
								value={String(rate)}
								onChange={(e) => {
									const r = Number(e.currentTarget.value);
									setRate(r);
									if (audioRef.current) audioRef.current.playbackRate = r;
								}}
							>
								{RATES.map((r) => (
									<option key={r} value={String(r)}>
										{String(r).replace(".", ",")}×
									</option>
								))}
							</select>
						</span>
					</section>
					{audioError && (
						<div class="replay-note" role="alert">
							Nie udało się odtworzyć dźwięku tego nagrania.
						</div>
					)}
				</>
			)}
		</>
	);
}
