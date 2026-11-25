import { useEffect, useRef, useState } from "preact/hooks";
import * as api from "./api";
import { closeOnDismiss } from "./dismiss";
import { Icon } from "./icon";
import { type Session, startScreenRecording } from "./recording";

/** The length of a recording as 1:05 or 1:02:05. */
export function clock(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = String(total % 60).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** A size as 12 MB (a recording is megabytes at least). */
export function megabytes(bytes: number): string {
	return `${Math.max(1, Math.round(bytes / (1 << 20)))} MB`;
}

interface Props {
	boardId: string;
	/** Shows the record button; the list of recordings is there either way (R-112). */
	canRecord: boolean;
	/** Starts a recording; a test hands in a stand-in. */
	start?: typeof startScreenRecording;
}

/**
 * Recording a lesson (R-112, stage 1): a "Nagrywaj" button that turns into the red "Zakończ
 * nagrywanie" with the time, and a "Nagrania" button opening the list of this board's recordings
 * with a download link each. The parent shows it to logged-in people only.
 */
export function RecordingControls({
	boardId,
	canRecord,
	start = startScreenRecording,
}: Props) {
	const [phase, setPhase] = useState<"idle" | "starting" | "recording">("idle");
	const [error, setError] = useState("");
	const [seconds, setSeconds] = useState(0);
	const session = useRef<Session | undefined>(undefined);
	const [open, setOpen] = useState(false);
	const [list, setList] = useState<api.Recording[] | null>(null);

	const reload = () =>
		api
			.listRecordings(boardId)
			.then(setList, (e) => setError(api.errorMessage(e)));
	useEffect(() => {
		if (open) void reload();
		// biome-ignore lint/correctness/useExhaustiveDependencies: reload follows boardId
	}, [open, boardId]);
	useEffect(
		() =>
			open
				? closeOnDismiss(".recordings-wrap", () => setOpen(false))
				: undefined,
		[open],
	);

	// The timer, and a warning before the tab is closed with a recording running.
	useEffect(() => {
		if (phase !== "recording") return;
		const t0 = Date.now();
		setSeconds(0);
		const tick = setInterval(
			() => setSeconds(Math.floor((Date.now() - t0) / 1000)),
			1000,
		);
		const warn = (e: BeforeUnloadEvent) => e.preventDefault();
		addEventListener("beforeunload", warn);
		return () => {
			clearInterval(tick);
			removeEventListener("beforeunload", warn);
		};
	}, [phase]);
	// Leaving the board ends the recording (what is recorded is kept).
	useEffect(() => () => void session.current?.stop().catch(() => {}), []);

	const ended = (why?: string) => {
		session.current = undefined;
		setPhase("idle");
		setError(why ?? "");
		if (open) void reload();
	};
	const toggle = async () => {
		if (phase === "starting") return;
		setError("");
		if (phase === "recording") {
			const s = session.current;
			session.current = undefined;
			setPhase("idle");
			try {
				await s?.stop();
			} catch (e) {
				setError(api.errorMessage(e));
			}
			if (open) void reload();
			return;
		}
		setPhase("starting");
		try {
			session.current = await start(boardId, ended);
			setPhase("recording");
		} catch (e) {
			setPhase("idle");
			setError(api.errorMessage(e));
		}
	};

	const recording = phase === "recording";
	return (
		<>
			{canRecord && (
				<div class="share-wrap">
					<button
						type="button"
						class={`board-menu${recording ? " recording" : ""}`}
						aria-label={recording ? "Zakończ nagrywanie" : "Nagrywaj"}
						title={recording ? "Zakończ nagrywanie" : "Nagrywaj lekcję"}
						disabled={phase === "starting"}
						onClick={toggle}
					>
						<Icon name="record" />
						{recording && <span class="rec-time">{clock(seconds * 1000)}</span>}
					</button>
					{error && (
						<span class="share-said" role="alert">
							{error}
						</span>
					)}
				</div>
			)}
			<div class="share-wrap recordings-wrap">
				<button
					type="button"
					class={`board-menu${open ? " active" : ""}`}
					aria-label="Nagrania"
					title="Nagrania"
					aria-expanded={open}
					onClick={() => setOpen(!open)}
				>
					<Icon name="film" />
				</button>
				{open && (
					<div class="recordings-pop" role="dialog" aria-label="Nagrania">
						{list === null ? (
							<p class="muted">Wczytywanie…</p>
						) : list.length === 0 ? (
							<p class="muted">Brak nagrań</p>
						) : (
							<ul>
								{list.map((r) => (
									<li key={r.id}>
										<span class="rec-name">{r.name}</span>
										<span class="muted">
											{new Date(r.createdAt).toLocaleDateString("pl-PL")}
											{" · "}
											{r.finished ? clock(r.durationMs) : "w toku"}
											{" · "}
											{megabytes(r.bytes)}
										</span>
										<a href={api.recordingUrl(boardId, r.id)} download>
											Pobierz
										</a>
									</li>
								))}
							</ul>
						)}
					</div>
				)}
			</div>
		</>
	);
}
