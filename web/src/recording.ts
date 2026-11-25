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

/**
 * What the picture costs. A steady 30 frames a second and a bitrate well above the browser's
 * default (about 2.5 Mb/s, which smears a board that is panned fast) keep motion clean; the size
 * is capped at Full HD so a big monitor does not make the encoder drop frames. 5 Mb/s is about
 * 40 MB a minute (the teacher's upload must keep up). Raise FRAME_RATE to 60 for smoother panning
 * if the computer can encode it.
 */
const FRAME_RATE = 30;
const VIDEO_BITS_PER_SECOND = 5_000_000;
const AUDIO_BITS_PER_SECOND = 128_000;
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;

/** How often MediaRecorder hands over a chunk, in ms. */
const CHUNK_MS = 3000;

/** The first container the browser can record, if any. */
function recordingMime(): string | undefined {
	if (typeof MediaRecorder === "undefined") return undefined;
	return MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

/**
 * Whether this device gets the record button: a computer (a tablet's Safari cannot capture the
 * screen). Whether the browser can is not asked here: a page over plain http hides screen capture
 * from the browser, and a button that is missing without a word is worse than one that explains
 * itself when pressed (see startScreenRecording).
 */
export function canRecordScreen(): boolean {
	return hasFinePointer();
}

/** An error whose message is for the user and that no retry would cure. */
class Refused extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Cuts the chunks MediaRecorder hands over into parts of exactly `size` bytes: S3 wants parts of
 * at least 5 MiB, and R2 wants all of them but the last to be of one size.
 */
export class PartCutter {
	private pending: Blob[] = [];
	private bytes = 0;
	constructor(private size: number) {}

	/** Adds a chunk; returns the whole parts that are now complete. */
	push(chunk: Blob): Blob[] {
		this.pending.push(chunk);
		this.bytes += chunk.size;
		const out: Blob[] = [];
		while (this.bytes >= this.size) {
			const all = new Blob(this.pending);
			out.push(all.slice(0, this.size));
			this.pending = [all.slice(this.size)];
			this.bytes -= this.size;
		}
		return out;
	}

	/** What is left when the recording ends: the last part, of any size; null for nothing. */
	rest(): Blob | null {
		return this.bytes > 0 ? new Blob(this.pending) : null;
	}
}

/** Where a part goes (see `api.recordingPart`). */
type Address = { url: string; method: string };

/** A status the store gives that no new try would change. */
const final = (status: number) =>
	status >= 400 && status < 500 && ![403, 408, 429].includes(status);

/**
 * Sends one part. Every try asks for a new address, because a signed one runs out; a failed try is
 * repeated a few times (a part sent again overwrites itself, so a retry is safe).
 */
export async function uploadPart(
	address: () => Promise<Address>,
	part: Blob,
	wait: (ms: number) => Promise<unknown> = sleep,
	tries = 6,
): Promise<void> {
	for (let attempt = 1; ; attempt++) {
		try {
			const { url, method } = await address();
			const res = await fetch(url, { method, body: part });
			if (res.ok) return;
			if (final(res.status)) throw new Refused(`Błąd ${res.status}`);
		} catch (e) {
			if (e instanceof Refused) throw e;
			const status = (e as { status?: number }).status;
			if (status !== undefined && final(status)) throw new Refused(errMsg(e));
		}
		if (attempt >= tries) throw new Refused("Nie udało się wysłać nagrania");
		await wait(Math.min(500 * 2 ** (attempt - 1), 8000));
	}
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Błąd");

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
	if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
		throw new Error(
			isSecureContext
				? "Ta przeglądarka nie udostępnia ekranu do nagrywania"
				: "Nagrywanie ekranu działa tylko na stronie https albo localhost, a ta jest po http",
		);
	}
	const mime = recordingMime();
	if (!mime) throw new Error("Ta przeglądarka nie nagrywa wideo");
	let screen: MediaStream;
	try {
		screen = await navigator.mediaDevices.getDisplayMedia({
			video: {
				frameRate: { ideal: FRAME_RATE, max: FRAME_RATE },
				width: { max: MAX_WIDTH },
				height: { max: MAX_HEIGHT },
			},
		});
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
	// A board that is drawn on and panned is motion first: the encoder keeps the frame rate up
	// rather than the sharpness of a single frame.
	for (const t of screen.getVideoTracks()) t.contentHint = "motion";
	const stream = new MediaStream([
		...screen.getVideoTracks(),
		...mic.getAudioTracks(),
	]);
	const release = () => {
		for (const t of [...screen.getTracks(), ...mic.getTracks()]) t.stop();
	};

	let id: string;
	let partSize: number;
	try {
		const name = new Date().toLocaleString("pl-PL", {
			day: "2-digit",
			month: "2-digit",
			year: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
		({ id, partSize } = await api.startRecording(
			boardId,
			`Lekcja ${name}`,
			mime,
		));
	} catch (e) {
		release();
		throw e;
	}

	const recorder = new MediaRecorder(stream, {
		mimeType: mime,
		videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
		audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
	});
	const startedAt = Date.now();
	const cutter = new PartCutter(partSize);
	let partNo = 0;
	let failure: Error | undefined;
	// Parts go one after another; a failure ends sending for good.
	let sending: Promise<void> = Promise.resolve();
	const enqueue = (part: Blob) => {
		const n = ++partNo;
		sending = sending.then(async () => {
			if (failure) return;
			try {
				await uploadPart(() => api.recordingPart(boardId, id, n), part);
			} catch (err) {
				failure = err instanceof Error ? err : new Error("Błąd");
				void endByItself();
			}
		});
	};
	let ending: Promise<void> | undefined;
	const stop = () => {
		ending ??= (async () => {
			if (recorder.state !== "inactive") recorder.stop();
			await stopped;
			release();
			const tail = cutter.rest(); // the last chunk comes right after stop()
			if (tail) enqueue(tail);
			await sending;
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
		for (const part of cutter.push(e.data)) enqueue(part);
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
