import { afterEach, describe, expect, test, vi } from "vitest";
import {
	enhanceVoice,
	listMics,
	micChoice,
	nextGain,
	PartCutter,
	type RecordingSource,
	SEGMENT_MS,
	setMicChoice,
	startBoardRecording,
	TOO_SHORT,
	uploadPart,
} from "./recording";
import type { EventLog } from "./recording-log";

const blob = (n: number, ch = "x") => new Blob([ch.repeat(n)]);
const text = (b: Blob) => b.text();
const answer = (status: number) => new Response(null, { status });

describe("PartCutter (R-094)", () => {
	test("hands out parts of exactly the part size and keeps the rest", async () => {
		const c = new PartCutter(10);
		expect(c.push(blob(4, "a"))).toEqual([]);
		const parts = c.push(blob(27, "b")); // 31 in all: three parts of 10 and 1 left
		expect(parts.map((p) => p.size)).toEqual([10, 10, 10]);
		expect(await text(parts[0])).toBe("aaaabbbbbb");
		expect(await text(parts[1])).toBe("bbbbbbbbbb");
		const rest = c.rest();
		expect(rest?.size).toBe(1);
		expect(await text(rest as Blob)).toBe("b");
	});

	test("a chunk that completes a part exactly leaves nothing", () => {
		const c = new PartCutter(10);
		expect(c.push(blob(10)).map((p) => p.size)).toEqual([10]);
		expect(c.rest()).toBeNull();
	});

	test("nothing recorded, nothing to send", () => {
		expect(new PartCutter(10).rest()).toBeNull();
	});
});

describe("uploadPart (R-094)", () => {
	const wait = vi.fn().mockResolvedValue(undefined);
	const part = blob(4);
	const address = () =>
		Promise.resolve({ url: "https://bucket.test/p?n=1", method: "PUT" });
	afterEach(() => {
		vi.unstubAllGlobals();
		wait.mockClear();
	});

	test("sends the part to the address it was given", async () => {
		const fetchMock = vi.fn().mockResolvedValue(answer(200));
		vi.stubGlobal("fetch", fetchMock);
		await uploadPart(address, part, wait);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://bucket.test/p?n=1");
		expect(init.method).toBe("PUT");
		expect(init.body).toBe(part);
		// No header of ours: the signed request of the bucket must reach it as signed.
		expect(init.headers).toBeUndefined();
	});

	test("asks for a new address on every try (a signed one may have run out)", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(answer(403))
			.mockResolvedValueOnce(answer(200));
		vi.stubGlobal("fetch", fetchMock);
		const addr = vi.fn(address);
		await uploadPart(addr, part, wait);
		expect(addr).toHaveBeenCalledTimes(2);
	});

	test("retries a network failure and a server error, then succeeds", async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new TypeError("offline"))
			.mockResolvedValueOnce(answer(503))
			.mockResolvedValueOnce(answer(200));
		vi.stubGlobal("fetch", fetchMock);
		await uploadPart(address, part, wait);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(wait.mock.calls.map((c) => c[0])).toEqual([500, 1000]);
	});

	test("gives up after a few tries", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
		vi.stubGlobal("fetch", fetchMock);
		await expect(uploadPart(address, part, wait, 3)).rejects.toThrow(
			"Nie udało się wysłać",
		);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	test("does not retry what the store refused for good", async () => {
		const fetchMock = vi.fn().mockResolvedValue(answer(413));
		vi.stubGlobal("fetch", fetchMock);
		await expect(uploadPart(address, part, wait)).rejects.toThrow("413");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test("does not retry when the server will not give an address (the recording is over)", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const refused = Object.assign(new Error("Nagranie jest już zakończone"), {
			status: 409,
		});
		await expect(
			uploadPart(() => Promise.reject(refused), part, wait),
		).rejects.toThrow("zakończone");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("retries when the address could not be asked for at all", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(200)));
		const addr = vi
			.fn()
			.mockRejectedValueOnce(new TypeError("offline"))
			.mockImplementation(address);
		await uploadPart(addr, part, wait);
		expect(addr).toHaveBeenCalledTimes(2);
	});
});

describe("startBoardRecording (R-113)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	/** A browser and a server that remember what they were asked. */
	function fake(
		opts: { secure?: boolean; mic?: "ok" | "denied" | "none" } = {},
	) {
		vi.useFakeTimers();
		const calls: { method: string; url: string; body?: string }[] = [];
		const stopped: string[] = [];
		let recorder: {
			ondataavailable?: (e: { data: Blob }) => void;
			onstart?: () => void;
			onstop?: () => void;
			state: string;
			options?: MediaRecorderOptions;
		} = { state: "inactive" };
		const track = {
			stop: () => stopped.push("mic"),
			addEventListener() {},
		};
		const displayCalls: unknown[] = [];
		vi.stubGlobal("isSecureContext", opts.secure ?? true);
		vi.stubGlobal(
			"navigator",
			opts.mic === "none"
				? {}
				: {
						mediaDevices: {
							getDisplayMedia: (c: unknown) => displayCalls.push(c),
							getUserMedia: async (c: unknown) => {
								calls.push({ method: "MIC", url: JSON.stringify(c) });
								if (opts.mic === "denied") throw new Error("denied");
								return {
									getTracks: () => [track],
									getAudioTracks: () => [track],
								};
							},
						},
					},
		);
		vi.stubGlobal(
			"MediaRecorder",
			class {
				static isTypeSupported = (t: string) => t.startsWith("audio/webm");
				state = "inactive";
				ondataavailable?: (e: { data: Blob }) => void;
				onstart?: () => void;
				onstop?: () => void;
				constructor(_s: unknown, o: MediaRecorderOptions) {
					recorder = this as never;
					(recorder as { options?: MediaRecorderOptions }).options = o;
				}
				start() {
					this.state = "recording";
					queueMicrotask(() => this.onstart?.());
				}
				stop() {
					this.state = "inactive";
					queueMicrotask(() => this.onstop?.());
				}
			},
		);
		vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
			const method = init.method ?? "GET";
			const body =
				init.body instanceof Blob
					? await init.body.text()
					: (init.body as string | undefined);
			calls.push({ method, url, body });
			const json = (v: unknown) =>
				new Response(JSON.stringify(v), { status: 200 });
			if (url.endsWith("/recordings")) return json({ id: "r1", partSize: 10 });
			if (/\/events\/\d+$/.test(url) && method === "POST")
				return json({
					url: `/put-events/${url.split("/").pop()}`,
					method: "PUT",
				});
			if (/\/parts\/\d+$/.test(url) && method === "POST")
				return json({
					url: `/put-part/${url.split("/").pop()}`,
					method: "PUT",
				});
			return new Response(null, { status: 204 });
		});
		let log: EventLog | undefined;
		let detached = false;
		const source: RecordingSource = {
			snapshot: () => ({
				strokes: [{ id: "s0" }] as never,
				background: "grid",
				view: { minX: 0, minY: 0, maxX: 800, maxY: 600 },
				win: { w: 800, h: 600 },
			}),
			attach: (l) => {
				log = l;
				return () => {
					detached = true;
				};
			},
		};
		return {
			calls,
			stopped,
			displayCalls,
			source,
			recorder: () => recorder,
			log: () => log,
			detached: () => detached,
		};
	}
	const puts = (
		calls: { method: string; url: string; body?: string }[],
		prefix: string,
	) => calls.filter((c) => c.method === "PUT" && c.url.startsWith(prefix));

	test("asks for the microphone only: no screen, no window to pick", async () => {
		const f = fake();
		await startBoardRecording("b", f.source, () => {});
		expect(f.displayCalls).toEqual([]);
		expect(f.calls[0]).toEqual({
			method: "MIC",
			url: JSON.stringify({
				audio: {
					channelCount: 1,
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: false,
				},
			}),
		});
		expect(f.recorder().options?.mimeType).toMatch(/^audio\/webm/);
	});

	test("a recording the server dropped for being too short says so", async () => {
		const f = fake();
		const inner = globalThis.fetch;
		vi.stubGlobal("fetch", async (url: string, init?: RequestInit) =>
			url.endsWith("/finish")
				? new Response(JSON.stringify({ discarded: true }), { status: 200 })
				: inner(url, init),
		);
		const ended: (string | undefined)[] = [];
		const session = await startBoardRecording("b", f.source, (e) =>
			ended.push(e),
		);
		await vi.advanceTimersByTimeAsync(0);
		await expect(session.stop()).resolves.toEqual({ discarded: true });
		expect(TOO_SHORT).toMatch(/krótsze niż minuta/);
	});

	test("sends the starting state, then a segment of the log every few seconds, then the end", async () => {
		const f = fake();
		const session = await startBoardRecording("b", f.source, () => {});
		await vi.advanceTimersByTimeAsync(0);
		// The starting state is segment 0, taken when the sound begins.
		const first = puts(f.calls, "/put-events/0");
		expect(first).toHaveLength(1);
		const snap = JSON.parse(first[0].body as string);
		expect(snap).toMatchObject({
			v: 1,
			background: "grid",
			strokes: [{ id: "s0" }],
			win: { w: 800, h: 600 },
		});

		f.log()?.message({ t: "remove", id: "x" }, false);
		await vi.advanceTimersByTimeAsync(SEGMENT_MS);
		const seg1 = puts(f.calls, "/put-events/1");
		expect(seg1).toHaveLength(1);
		expect(JSON.parse(seg1[0].body as string)).toEqual([
			[expect.any(Number), "r", "x"],
		]);

		f.log()?.message({ t: "remove", id: "y" }, false);
		const done = session.stop();
		await vi.advanceTimersByTimeAsync(0);
		await done;
		expect(f.detached()).toBe(true);
		expect(
			JSON.parse(puts(f.calls, "/put-events/2")[0].body as string),
		).toEqual([[expect.any(Number), "r", "y"]]);
		const finish = f.calls.find((c) => c.url.endsWith("/finish"));
		expect(
			JSON.parse(finish?.body as string).durationMs,
		).toBeGreaterThanOrEqual(SEGMENT_MS);
		expect(f.stopped).toContain("mic");
	});

	test("the sound goes in parts of the size the server named, the last one shorter", async () => {
		const f = fake();
		const session = await startBoardRecording("b", f.source, () => {});
		await vi.advanceTimersByTimeAsync(0);
		f.recorder().ondataavailable?.({ data: new Blob(["x".repeat(25)]) }); // 25 bytes, parts of 10
		const done = session.stop();
		await vi.advanceTimersByTimeAsync(0);
		await done;
		const sizes = puts(f.calls, "/put-part/").map(
			(c) => (c.body as string).length,
		);
		expect(sizes).toEqual([10, 10, 5]);
	});

	test("a page over plain http says why: the browser hides the microphone there", async () => {
		const f = fake({ secure: false, mic: "none" });
		await expect(startBoardRecording("b", f.source, () => {})).rejects.toThrow(
			"https",
		);
	});

	test("a refused microphone creates no recording", async () => {
		const f = fake({ mic: "denied" });
		await expect(startBoardRecording("b", f.source, () => {})).rejects.toThrow(
			"mikrofonu",
		);
		expect(f.calls.some((c) => c.url.endsWith("/recordings"))).toBe(false);
	});
});

describe("enhanceVoice", () => {
	afterEach(() => vi.unstubAllGlobals());

	const mic = { id: "mic" } as unknown as MediaStream;

	test("without the Web Audio API the plain microphone is recorded", () => {
		vi.stubGlobal("AudioContext", undefined);
		const v = enhanceVoice(mic);
		expect(v.stream).toBe(mic);
		v.close();
	});

	test("the voice goes through a filter, an automatic gain and a limiter, and the context is closed after", () => {
		vi.useFakeTimers();
		const made: string[] = [];
		const param = () => ({
			value: 0,
			setTargetAtTime: vi.fn(),
		});
		const node = (name: string, extra: object = {}) => ({
			connect: (to: unknown) => {
				made.push(`${name}->${(to as { name: string }).name}`);
				return to;
			},
			name,
			frequency: param(),
			gain: param(),
			threshold: param(),
			knee: param(),
			ratio: param(),
			attack: param(),
			release: param(),
			type: "",
			...extra,
		});
		let closed = false;
		const outStream = { id: "processed" };
		vi.stubGlobal(
			"AudioContext",
			class {
				currentTime = 0;
				createMediaStreamDestination = () => node("out", { stream: outStream });
				createBiquadFilter = () => node("filter");
				createGain = () => node("gain");
				createAnalyser = () =>
					node("meter", {
						fftSize: 0,
						getFloatTimeDomainData: (a: Float32Array) => a.fill(0.05),
					});
				createDynamicsCompressor = () => node("limiter");
				createMediaStreamSource = () => node("source");
				resume = () => Promise.resolve();
				close = () => {
					closed = true;
					return Promise.resolve();
				};
			},
		);
		const v = enhanceVoice(mic);
		expect(v.stream).toBe(outStream);
		expect(made).toEqual([
			"source->filter",
			"filter->meter",
			"filter->gain",
			"gain->limiter",
			"limiter->out",
		]);
		vi.advanceTimersByTime(200); // the level is looked at without errors
		v.close();
		expect(closed).toBe(true);
		vi.useRealTimers();
	});

	test("a browser that throws on the context leaves the plain microphone", () => {
		vi.stubGlobal(
			"AudioContext",
			class {
				constructor() {
					throw new Error("no");
				}
			},
		);
		expect(enhanceVoice(mic).stream).toBe(mic);
	});
});

describe("nextGain", () => {
	test("a quiet voice is lifted slowly", () => {
		let g = 0;
		for (let i = 0; i < 20; i++) g = nextGain(g, -45, 50); // one second
		expect(g).toBeGreaterThan(2);
		expect(g).toBeLessThan(25 * 0.5);
		for (let i = 0; i < 400; i++) g = nextGain(g, -45, 50); // and in the end it gets there
		expect(g).toBeCloseTo(25, 0);
	});

	test("a loud word brings it down quickly", () => {
		let g = 20;
		for (let i = 0; i < 4; i++) g = nextGain(g, -10, 50); // 200 ms of a loud voice
		expect(g).toBeLessThan(5);
	});

	test("silence changes nothing, so the hiss between words is not raised", () => {
		expect(nextGain(12, -70, 50)).toBe(12);
		expect(nextGain(12, Number.NEGATIVE_INFINITY, 50)).toBe(12);
	});

	test("the gain stays between nothing and the limit", () => {
		let g = 0;
		for (let i = 0; i < 2000; i++) g = nextGain(g, -57, 50);
		expect(g).toBeLessThanOrEqual(30);
		expect(nextGain(0, -2, 50)).toBeGreaterThanOrEqual(0);
	});
});

describe("choosing a microphone", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		localStorage.clear();
	});

	const device = (deviceId: string, label: string, kind = "audioinput") => ({
		deviceId,
		label,
		kind,
	});

	test("the choice is remembered, and empty means the default one", () => {
		expect(micChoice()).toBe("");
		setMicChoice("usb-1");
		expect(micChoice()).toBe("usb-1");
		setMicChoice("");
		expect(micChoice()).toBe("");
	});

	test("lists microphones by name, without the browser's aliases and without cameras", async () => {
		vi.stubGlobal("navigator", {
			mediaDevices: {
				enumerateDevices: async () => [
					device("default", "Domyślne"),
					device("a", "Wbudowany mikrofon"),
					device("b", "Słuchawki USB"),
					device("c", "Kamera", "videoinput"),
				],
			},
		});
		expect(await listMics()).toEqual([
			{ id: "a", label: "Wbudowany mikrofon" },
			{ id: "b", label: "Słuchawki USB" },
		]);
	});

	test("names hidden until allowed: the microphone is opened and closed once to get them", async () => {
		let allowed = false;
		const stopped = vi.fn();
		vi.stubGlobal("navigator", {
			mediaDevices: {
				enumerateDevices: async () => [
					device("a", allowed ? "Mikrofon A" : ""),
				],
				getUserMedia: async () => {
					allowed = true;
					return { getTracks: () => [{ stop: stopped }] };
				},
			},
		});
		expect(await listMics()).toEqual([{ id: "a", label: "Mikrofon A" }]);
		expect(stopped).toHaveBeenCalledTimes(1);
	});

	test("a refusal to listen gives an empty list", async () => {
		vi.stubGlobal("navigator", {
			mediaDevices: {
				enumerateDevices: async () => [device("a", "")],
				getUserMedia: async () => {
					throw new Error("denied");
				},
			},
		});
		expect(await listMics()).toEqual([]);
	});
});
