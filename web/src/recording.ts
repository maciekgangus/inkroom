import * as api from "./api";
import { hasFinePointer } from "./pointer";

// Lesson recording, stage 1 (R-112): the screen and the microphone of the person who records go
// to the server in chunks, as the browser produces them.

/** MP4 where the browser can record it, WebM otherwise (R-094); the user never chooses. */
const MIME_TYPES = [
	"video/mp4;codecs=avc1.42E01E,mp4a.40.2",
	"video/webm;codecs=vp9,opus",
	"video/webm;codecs=vp8,opus",
	"video/webm",
];

/** How often MediaRecorder hands over a chunk, in ms. */
const CHUNK_MS = 3000;

/** The first container the browser can record, if any. */
function recordingMime(): string | undefined {
	if (typeof MediaRecorder === "undefined") return undefined;
	return MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

/**
 * Whether this device may record: a computer (a tablet's Safari cannot capture the screen) whose
 * browser can capture the screen and record video.
 */
export function canRecordScreen(): boolean {
	return (
		hasFinePointer() &&
		typeof navigator.mediaDevices?.getDisplayMedia === "function" &&
		recordingMime() !== undefined
	);
}

/** An error whose message is for the user and that no retry would cure. */
class Refused extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends one chunk to `url` at `offset`, the byte where the file on the server must end. A failed
 * try is repeated a few times; the server refuses a chunk it already holds (its answer got lost)
 * with its size, and then the chunk is done. Returns the offset after the chunk.
 */
export async function sendChunk(
	url: string,
	offset: number,
	chunk: Blob,
	wait: (ms: number) => Promise<unknown> = sleep,
	tries = 6,
): Promise<number> {
	const end = offset + chunk.size;
	for (let attempt = 1; ; attempt++) {
		try {
			const res = await fetch(`${url}?offset=${offset}`, {
				method: "PUT",
				headers: { "Content-Type": "application/octet-stream" },
				body: chunk,
			});
			if (res.ok) return end;
			if (res.status === 409) {
				const body = await res.json().catch(() => ({}));
				if (body.size === end) return end;
				throw new Refused("Nagranie rozjechało się z serwerem");
			}
			if (res.status < 500) throw new Refused(`Błąd ${res.status}`);
		} catch (e) {
			if (e instanceof Refused) throw e;
		}
		if (attempt >= tries) throw new Refused("Nie udało się wysłać nagrania");
		await wait(Math.min(500 * 2 ** (attempt - 1), 8000));
	}
}

/** A recording in progress. */
export interface Session {
	/** Finishes the recording: what was recorded is on the server when this resolves. */
	stop(): Promise<void>;
}

/**
 * Asks for a screen (a window, a tab or the whole screen) and the microphone, and starts
 * recording them. `onEnd` is called when the recording stops by itself: the person stopped sharing
 * in the browser's bar, or sending failed (then with the reason).
 */
export async function startScreenRecording(
	boardId: string,
	onEnd: (error?: string) => void,
): Promise<Session> {
	const mime = recordingMime();
	if (!mime) throw new Error("Ta przeglądarka nie nagrywa ekranu");
	let screen: MediaStream;
	try {
		screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
	} catch {
		throw new Error("Nie wybrano ekranu do nagrywania");
	}
	let mic: MediaStream;
	try {
		mic = await navigator.mediaDevices.getUserMedia({ audio: true });
	} catch {
		for (const t of screen.getTracks()) t.stop();
		throw new Error("Brak dostępu do mikrofonu");
	}
	const stream = new MediaStream([
		...screen.getVideoTracks(),
		...mic.getAudioTracks(),
	]);
	const release = () => {
		for (const t of [...screen.getTracks(), ...mic.getTracks()]) t.stop();
	};

	let id: string;
	try {
		const name = new Date().toLocaleString("pl-PL", {
			day: "2-digit",
			month: "2-digit",
			year: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
		({ id } = await api.startRecording(boardId, `Lekcja ${name}`, mime));
	} catch (e) {
		release();
		throw e;
	}

	const url = api.recordingUrl(boardId, id) + "/chunk";
	const recorder = new MediaRecorder(stream, { mimeType: mime });
	const startedAt = Date.now();
	let sent = 0;
	let failure: Error | undefined;
	// Chunks go one after another, so the file is in order; a failure ends sending for good.
	let sending: Promise<void> = Promise.resolve();
	let ending: Promise<void> | undefined;
	const stop = () => {
		ending ??= (async () => {
			if (recorder.state !== "inactive") recorder.stop();
			await stopped;
			release();
			await sending; // the last chunk comes right after stop()
			await api.finishRecording(boardId, id, Date.now() - startedAt);
			if (failure) throw failure;
		})();
		return ending;
	};
	// The recording ends without the person pressing stop: they stopped sharing in the browser's
	// bar, or sending failed.
	const endByItself = () =>
		stop().then(
			() => onEnd(),
			(e) => onEnd(e instanceof Error ? e.message : "Błąd"),
		);
	recorder.ondataavailable = (e) => {
		if (e.data.size === 0) return;
		sending = sending.then(async () => {
			if (failure) return;
			try {
				sent = await sendChunk(url, sent, e.data);
			} catch (err) {
				failure = err instanceof Error ? err : new Error("Błąd");
				void endByItself();
			}
		});
	};
	const stopped = new Promise<void>((resolve) => {
		recorder.onstop = () => resolve();
	});
	screen.getVideoTracks()[0]?.addEventListener("ended", () => {
		void endByItself();
	});
	recorder.start(CHUNK_MS);
	return { stop };
}
