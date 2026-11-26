import * as api from "./api";
import type { Background } from "./board/background";
import type { Stroke } from "./board/board";
import type { Rect } from "./board/viewport";
import { EventLog, LOG_VERSION } from "./recording-log";

// Recording a lesson (R-113, ADR 0028): the sound of the person who records and the log of what
// happens on the board go to the server as the browser produces them. No picture of the screen is
// made, so nothing but the microphone is asked for.

/** The sound: MP4/AAC where the browser can record it, WebM/Opus otherwise; the user never chooses. */
const MIME_TYPES = [
	"audio/mp4;codecs=mp4a.40.2",
	"audio/webm;codecs=opus",
	"audio/webm",
];
const AUDIO_BITS_PER_SECOND = 96_000; // a voice with its consonants: about 43 MB an hour
/** How much louder than the microphone gives it the voice is recorded (a limiter keeps it from clipping). */
const VOICE_BOOST = 2.5;

/** How often MediaRecorder hands over a chunk, in ms. */
const CHUNK_MS = 3000;
/** How often a segment of the event log is sent, in ms. */
export const SEGMENT_MS = 10_000;

/** The first container the browser can record, if any. */
function audioMime(): string | undefined {
	if (typeof MediaRecorder === "undefined") return undefined;
	return MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
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
	/**
	 * Finishes the recording: what was recorded is on the server when this resolves. `discarded` is
	 * true when it was too short to keep and the server dropped it.
	 */
	stop(): Promise<{ discarded: boolean } | undefined>;
}

/** What the server says about a recording that was shorter than a minute. */
export const TOO_SHORT = "Nagranie krótsze niż minuta nie zostało zapisane";

/**
 * Makes the voice easier to understand than what a laptop or tablet microphone gives: the browser's
 * own noise suppression and echo cancellation, then a high-pass filter (rumble, desk knocks), a
 * low-pass one (hiss above what speech needs), a boost and a limiter so a loud word does not clip.
 * Where the Web Audio API is missing, the plain microphone is recorded.
 */
export function enhanceVoice(mic: MediaStream): {
	stream: MediaStream;
	close: () => void;
} {
	const plain = { stream: mic, close: () => {} };
	try {
		const Ctx = globalThis.AudioContext;
		if (typeof Ctx !== "function") return plain;
		const ctx = new Ctx();
		const out = ctx.createMediaStreamDestination();
		const high = ctx.createBiquadFilter();
		high.type = "highpass";
		high.frequency.value = 100;
		const low = ctx.createBiquadFilter();
		low.type = "lowpass";
		low.frequency.value = 7500;
		const boost = ctx.createGain();
		boost.gain.value = VOICE_BOOST;
		const limiter = ctx.createDynamicsCompressor();
		limiter.threshold.value = -6;
		limiter.knee.value = 0;
		limiter.ratio.value = 20;
		limiter.attack.value = 0.003;
		limiter.release.value = 0.15;
		ctx.createMediaStreamSource(mic).connect(high);
		high.connect(low);
		low.connect(boost);
		boost.connect(limiter);
		limiter.connect(out);
		void ctx.resume?.();
		return {
			stream: out.stream,
			close: () => void ctx.close().catch(() => {}),
		};
	} catch {
		return plain;
	}
}

/** The first object of the log: the state of the board when the recording began. */
export interface Snapshot {
	strokes: Stroke[];
	background: Background;
	/** The board rectangle in view and the size of the window it was shown in. */
	view: Rect;
	win: { w: number; h: number };
}

/** What the recorder needs from the board (given by the board view). */
export interface RecordingSource {
	/** The state of the board now. */
	snapshot(): Snapshot;
	/** Starts feeding events into `log`; returns the function that stops it. */
	attach(log: EventLog): () => void;
}

/**
 * Starts recording: the microphone and the event log of the board. `onEnd` is called when the
 * recording stops by itself: sending failed, or the microphone went away (then with the reason).
 */
export async function startBoardRecording(
	boardId: string,
	source: RecordingSource,
	onEnd: (error?: string) => void,
): Promise<Session> {
	if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
		throw new Error(
			isSecureContext
				? "Ta przeglądarka nie udostępnia mikrofonu"
				: "Nagrywanie działa tylko na stronie https albo localhost (mikrofon), a ta jest po http",
		);
	}
	const mime = audioMime();
	if (!mime) throw new Error("Ta przeglądarka nie nagrywa dźwięku");
	let mic: MediaStream;
	try {
		mic = await navigator.mediaDevices.getUserMedia({
			audio: {
				channelCount: 1,
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true,
			},
		});
	} catch {
		throw new Error("Brak dostępu do mikrofonu");
	}
	const voice = enhanceVoice(mic);
	const release = () => {
		for (const t of mic.getTracks()) t.stop();
		voice.close();
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

	const recorder = new MediaRecorder(voice.stream, {
		mimeType: mime,
		audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
	});
	const cutter = new PartCutter(partSize);
	let partNo = 0;
	let segment = 0;
	let failure: Error | undefined;
	// Everything goes one after another, so the sound is in order; a failure ends sending for good.
	let sending: Promise<void> = Promise.resolve();
	const queue = (send: () => Promise<void>) => {
		sending = sending.then(async () => {
			if (failure) return;
			try {
				await send();
			} catch (err) {
				failure = err instanceof Error ? err : new Error("Błąd");
				void endByItself();
			}
		});
	};
	const sendPart = (part: Blob) => {
		const n = ++partNo;
		queue(() => uploadPart(() => api.recordingPart(boardId, id, n), part));
	};
	const sendSegment = (n: number, data: unknown) => {
		const body = new Blob([JSON.stringify(data)]);
		queue(() => uploadPart(() => api.recordingEvents(boardId, id, n), body));
	};

	let t0 = performance.now();
	let log: EventLog | undefined;
	let detach: (() => void) | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	// The log begins when the sound does, so a time in the log is a time in the recording.
	recorder.onstart = () => {
		t0 = performance.now();
		log = new EventLog(() => performance.now());
		sendSegment(0, { v: LOG_VERSION, ...source.snapshot() });
		detach = source.attach(log);
		timer = setInterval(
			() => sendSegment(++segment, log?.take() ?? []),
			SEGMENT_MS,
		);
	};
	recorder.ondataavailable = (e) => {
		for (const part of cutter.push(e.data)) sendPart(part);
	};
	const stopped = new Promise<void>((resolve) => {
		recorder.onstop = () => resolve();
	});

	let ending: Promise<{ discarded: boolean }> | undefined;
	const stop = () => {
		ending ??= (async () => {
			clearInterval(timer);
			detach?.();
			if (recorder.state !== "inactive") recorder.stop();
			await stopped;
			release();
			const tail = cutter.rest(); // the last chunk comes right after stop()
			if (tail) sendPart(tail);
			sendSegment(++segment, log?.take() ?? []);
			await sending;
			const done = await api.finishRecording(
				boardId,
				id,
				Math.round(performance.now() - t0),
			);
			if (failure) throw failure;
			return { discarded: done?.discarded === true };
		})();
		return ending;
	};
	// The recording ends without the person pressing stop: sending failed, or the microphone left.
	const endByItself = () =>
		stop().then(
			(r) => onEnd(r.discarded ? TOO_SHORT : undefined),
			(e) => onEnd(e instanceof Error ? e.message : "Błąd"),
		);
	for (const track of mic.getAudioTracks()) {
		track.addEventListener("ended", () => {
			void endByItself();
		});
	}
	recorder.start(CHUNK_MS);
	return { stop };
}
