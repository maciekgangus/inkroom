import { useEffect, useRef, useState } from "preact/hooks";
import * as api from "./api";
import { closeOnDismiss } from "./dismiss";
import { Icon } from "./icon";
import { Portal } from "./portal";
import { type Session, startScreenRecording } from "./recording";

/** One recording lasts at most 1 h 15 min; five minutes before, the owner is warned (R-094). */
export const MAX_RECORDING_MS = 75 * 60_000;
export const WARN_BEFORE_MS = 5 * 60_000;

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
	/** Shows the record button: the owner of the board, on a computer (R-094). */
	canRecord: boolean;
	/** Shows a delete button on each recording: the owner of the board. */
	canDelete?: boolean;
	/** Told when recording starts (true) and ends (false), for everyone's red dot. */
	onRecording?: (on: boolean) => void;
	/** Starts a recording; a test hands in a stand-in. */
	start?: typeof startScreenRecording;
}

/**
 * Recording a lesson (R-094): a "Nagrywaj" button that turns into the red "Zakończ nagrywanie"
 * with the time, and a "Nagrania" button opening the list of this board's recordings with a
 * download link each, and for the owner a delete button. Anyone with the board sees the list.
 */
export function RecordingControls({
	boardId,
	canRecord,
	canDelete,
	onRecording,
	start = startScreenRecording,
}: Props) {
	const [phase, setPhase] = useState<"idle" | "starting" | "recording">("idle");
	const [error, setError] = useState("");
	/** A word that is not a failure: the limit is near, or was reached. */
	const [note, setNote] = useState("");
	const [seconds, setSeconds] = useState(0);
	const session = useRef<Session | undefined>(undefined);
	const [open, setOpen] = useState(false);
	/** Where the list hangs (client pixels), taken from its button when it opens. */
	const [at, setAt] = useState({ top: 0, left: 0, width: 360 });
	const [list, setList] = useState<api.Recording[] | null>(null);
	/** The recording asked "Na pewno usunąć?" about. */
	const [confirming, setConfirming] = useState("");

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
				? closeOnDismiss(".recordings-wrap, .recordings-pop", () =>
						setOpen(false),
					)
				: undefined,
		[open],
	);

	// The timer, the limit (a warning, then the end), and a warning before the tab is closed.
	const stopRef = useRef<(why?: string) => Promise<void>>(async () => {});
	useEffect(() => {
		if (phase !== "recording") return;
		const t0 = Date.now();
		setSeconds(0);
		const tick = setInterval(
			() => setSeconds(Math.floor((Date.now() - t0) / 1000)),
			1000,
		);
		const warn = setTimeout(
			() =>
				setNote("Nagranie skończy się samo za 5 minut (limit 1 godz. 15 min)"),
			MAX_RECORDING_MS - WARN_BEFORE_MS,
		);
		const limit = setTimeout(
			() =>
				void stopRef.current(
					"Osiągnięto limit 1 godz. 15 min: nagranie zapisane. Możesz zacząć kolejne.",
				),
			MAX_RECORDING_MS,
		);
		const beforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
		addEventListener("beforeunload", beforeUnload);
		return () => {
			clearInterval(tick);
			clearTimeout(warn);
			clearTimeout(limit);
			removeEventListener("beforeunload", beforeUnload);
		};
	}, [phase]);
	// Everyone's red dot follows the phase; nothing is said before there was a recording.
	const wasRecording = useRef(false);
	const tell = useRef(onRecording);
	tell.current = onRecording; // the latest, without running the effect again for a new function
	useEffect(() => {
		const now = phase === "recording";
		if (now || wasRecording.current) tell.current?.(now);
		wasRecording.current = now;
	}, [phase]);
	// Leaving the board ends the recording (what is recorded is kept).
	useEffect(() => () => void session.current?.stop().catch(() => {}), []);

	const ended = (why?: string) => {
		session.current = undefined;
		setPhase("idle");
		setNote("");
		setError(why ?? "");
		if (open) void reload();
	};
	/** Ends the recording on the owner's wish or at the limit, and says `why` if given. */
	const stop = async (why?: string) => {
		const s = session.current;
		session.current = undefined;
		setPhase("idle");
		setNote(why ?? "");
		try {
			await s?.stop();
		} catch (e) {
			setNote("");
			setError(api.errorMessage(e));
		}
		if (open) void reload();
	};
	stopRef.current = stop;

	const toggle = async () => {
		if (phase === "starting") return;
		setError("");
		setNote("");
		if (phase === "recording") return stop();
		setPhase("starting");
		try {
			session.current = await start(boardId, ended);
			setPhase("recording");
		} catch (e) {
			setPhase("idle");
			setError(api.errorMessage(e));
		}
	};

	const remove = async (id: string) => {
		setConfirming("");
		try {
			await api.deleteRecording(boardId, id);
			await reload();
		} catch (e) {
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
					{!error && note && (
						<span class="share-said rec-note" role="status">
							{note}
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
					onClick={(e) => {
						// Outside the top bar, which is transformed and would clip or move it.
						const r = e.currentTarget.getBoundingClientRect();
						const width = Math.min(360, innerWidth - 16);
						const left = Math.max(
							8,
							Math.min(r.right - width, innerWidth - width - 8),
						);
						setAt({ top: r.bottom + 8, left, width });
						setConfirming("");
						setOpen(!open);
					}}
				>
					<Icon name="film" />
				</button>
				{open && (
					<Portal>
						<div
							class="recordings-pop"
							role="dialog"
							aria-label="Nagrania"
							style={{
								top: `${at.top}px`,
								left: `${at.left}px`,
								width: `${at.width}px`,
							}}
						>
							{list === null ? (
								<p class="muted">Wczytywanie…</p>
							) : list.length === 0 ? (
								<p class="muted">Brak nagrań</p>
							) : (
								<ul>
									{list.map((r) => (
										<li key={r.id}>
											<span class="rec-name">{r.name}</span>
											<span class="muted rec-meta">
												{new Date(r.createdAt).toLocaleDateString("pl-PL")}
												{" · "}
												{r.finished ? clock(r.durationMs) : "w toku"}
												{r.finished && ` · ${megabytes(r.bytes)}`}
											</span>
											<span class="rec-actions">
												{r.finished && (
													<a href={api.recordingUrl(boardId, r.id)} download>
														Pobierz
													</a>
												)}
												{canDelete &&
													(confirming === r.id ? (
														<button
															type="button"
															class="danger"
															onClick={() => remove(r.id)}
														>
															Na pewno usunąć?
														</button>
													) : (
														<button
															type="button"
															class="rec-delete"
															aria-label="Usuń nagranie"
															title="Usuń nagranie"
															onClick={() => setConfirming(r.id)}
														>
															<Icon name="trash" />
														</button>
													))}
											</span>
										</li>
									))}
								</ul>
							)}
						</div>
					</Portal>
				)}
			</div>
		</>
	);
}
