// Renders recorded lessons to MP4 (R-115, ADR 0029): a headless Chromium opens the app's render
// page, which draws the frames with the replay engine and encodes them as H.264 (WebCodecs); the
// chunks go to ffmpeg together with the lesson's sound.
//
// One recording, by hand:
//   node render.mjs --base http://localhost:8099 --board <id> --rec <id> --out out.mp4
//        [--seconds 30] [--size 1280x720] [--fps 30] [--bitrate 2000000] [--tmp /some/dir]
//
// As the worker of the app (takes recordings from its queue, one at a time, and sends each video
// to the store):
//   RENDER_TOKEN=... node render.mjs --worker --base http://app:8080 --jobs http://app:8081
//
// ffmpeg is run as `$FFMPEG` (default "ffmpeg"); to use a container, set FFMPEG="docker run --rm -i
// -v <tmp>:/w <image>" and FFMPEG_DIR=/w, so the files it reads and writes are named as it sees them.
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);
const t0 = Date.now();
const log = (msg) => console.error(`[render ${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

/**
 * Renders one recording to `out`. `onProgress(percent)` is told how far it is.
 * Returns the number of frames.
 */
async function renderRecording({ base, board, rec, out, seconds, width, height, fps, bitrate, tmp, onProgress }) {
	mkdirSync(tmp, { recursive: true });
	const ffmpeg = (process.env.FFMPEG ?? "ffmpeg").split(" ");
	const inside = (name) => (process.env.FFMPEG_DIR ? path.posix.join(process.env.FFMPEG_DIR, name) : path.join(tmp, name));

	// The sound of the recording, from where the player index says it is.
	const res = await fetch(`${base}/api/boards/${board}/recordings/${rec}/play`);
	if (!res.ok) throw new Error(`the player index: ${res.status}`);
	const index = await res.json();
	const audioRes = await fetch(new URL(index.audio, base));
	if (!audioRes.ok) throw new Error(`the sound: ${audioRes.status}`);
	const audio = Buffer.from(await audioRes.arrayBuffer());
	writeFileSync(path.join(tmp, "audio"), audio);
	log(`recording "${index.name}", ${(index.durationMs / 1000).toFixed(1)} s, sound ${(audio.length / 1024).toFixed(0)} KB`);

	const ff = spawn(
		ffmpeg[0],
		[
			...ffmpeg.slice(1),
			"-y", "-hide_banner", "-loglevel", "error",
			"-r", String(fps), "-f", "h264", "-i", "pipe:0",
			"-i", inside("audio"),
			"-map", "0:v", "-map", "1:a",
			"-c:v", "copy", "-c:a", "aac", "-b:a", "96k",
			"-movflags", "+faststart",
			inside("out.mp4"),
		],
		{ stdio: ["pipe", "inherit", "inherit"] },
	);
	const ffDone = new Promise((resolve, reject) => {
		ff.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
		ff.on("error", reject);
	});
	ffDone.catch(() => {}); // reported where it is awaited
	ff.stdin.on("error", () => {});

	const browser = await chromium.launch({
		args: [
			`--unsafely-treat-insecure-origin-as-secure=${new URL(base).origin}`,
			...(process.env.RENDER_NO_SANDBOX ? ["--no-sandbox"] : []),
		],
	});
	let frames;
	try {
		const page = await browser.newPage({ viewport: { width, height } });
		page.on("pageerror", (e) => log(`page error: ${e.message}`));
		const raw = process.env.KEEP_RAW ? createWriteStream(path.join(tmp, "raw.h264")) : null;
		await page.exposeFunction("__emit", (b64) => {
			const b = Buffer.from(b64, "base64");
			raw?.write(b);
			ff.stdin.write(b);
		});
		await page.exposeFunction("__progress", (done, total) => {
			log(`frame ${done} / ${total}`);
			onProgress?.(total ? Math.floor((done / total) * 100) : 0);
		});
		await page.goto(`${base}/b/${board}/r/${rec}?render=1`);
		await page.waitForFunction(() => window.__replay !== undefined);
		await page.evaluate(() => window.__replay.ready);
		log("loaded, rendering");
		const t1 = Date.now();
		({ frames } = await page.evaluate((o) => window.__replay.encode(o), { width, height, fps, bitrate, seconds }));
		const took = (Date.now() - t1) / 1000;
		log(`${frames} frames in ${took.toFixed(1)} s = ${(frames / took).toFixed(0)} frames/s (${(frames / fps / took).toFixed(1)}x real time)`);
	} catch (e) {
		ff.kill();
		throw e;
	} finally {
		await browser.close();
	}
	ff.stdin.end();
	await ffDone;
	copyFileSync(path.join(tmp, "out.mp4"), out);
	log(`wrote ${out}, ${(statSync(out).size / 1024).toFixed(0)} KB`);
	return frames;
}

const settings = () => {
	const [width, height] = arg("size", "1280x720").split("x").map(Number);
	return {
		width,
		height,
		fps: Number(arg("fps", "30")),
		bitrate: Number(arg("bitrate", "2000000")),
		seconds: arg("seconds") ? Number(arg("seconds")) : undefined,
	};
};

// --- the worker ---------------------------------------------------------------------------------

/** PUTs a file as it is, with its length (S3 takes no chunked uploads); returns the status. */
function putFile(url, file, headers) {
	return new Promise((resolve, reject) => {
		const u = new URL(url);
		const req = (u.protocol === "https:" ? https : http).request(
			u,
			{ method: "PUT", headers: { ...headers, "Content-Type": "video/mp4", "Content-Length": statSync(file).size } },
			(res) => {
				res.resume();
				res.on("end", () => resolve(res.statusCode));
			},
		);
		req.on("error", reject);
		createReadStream(file).pipe(req);
	});
}

async function worker() {
	const base = arg("base");
	const jobs = arg("jobs");
	const token = process.env.RENDER_TOKEN;
	if (!base || !jobs || !token) throw new Error("--worker needs --base, --jobs and RENDER_TOKEN");
	const auth = { Authorization: `Bearer ${token}` };
	const api = (method, url, body) =>
		fetch(new URL(url, jobs), {
			method,
			headers: { ...auth, "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	const pause = Number(process.env.RENDER_POLL_SECONDS ?? 10) * 1000;
	log(`worker: asking ${jobs} for recordings to render`);
	for (;;) {
		let job;
		try {
			const res = await api("POST", "/render/claim");
			if (res.status === 200) job = await res.json();
			else if (res.status !== 204) log(`claim: ${res.status}`);
		} catch (e) {
			log(`claim: ${e.message}`);
		}
		if (!job) {
			await new Promise((r) => setTimeout(r, pause));
			continue;
		}
		const where = `/render/${job.board}/${job.rec}`;
		const tmp = mkdtempSync(path.join(process.env.RENDER_TMP ?? tmpdir(), "render-"));
		try {
			log(`rendering ${job.rec}`);
			let last = 0;
			await renderRecording({
				...settings(),
				base,
				board: job.board,
				rec: job.rec,
				out: path.join(tmp, "video.mp4"),
				tmp,
				onProgress: (percent) => {
					if (Date.now() - last < 5000) return;
					last = Date.now();
					api("POST", `${where}/progress`, { percent }).catch(() => {});
				},
			});
			const file = path.join(tmp, "video.mp4");
			const upload = new URL(job.upload, jobs);
			// Our token goes only to our own port; a signed address of the bucket takes nothing else.
			const status = await putFile(upload, file, upload.origin === new URL(jobs).origin ? auth : {});
			if (status < 200 || status >= 300) throw new Error(`the store refused the video: ${status}`);
			const done = await api("POST", `${where}/done`, { bytes: statSync(file).size });
			if (!done.ok) log(`done: ${done.status} (the recording is gone?)`);
			else log(`${job.rec} is ready`);
		} catch (e) {
			log(`failed on ${job.rec}: ${e.message}`);
			await api("POST", `${where}/fail`, { reason: String(e.message).slice(0, 200) }).catch(() => {});
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	}
}

if (flag("worker")) {
	await worker();
} else {
	const board = arg("board");
	const rec = arg("rec");
	if (!board || !rec) throw new Error("--board and --rec are required");
	const tmp = arg("tmp") ?? mkdtempSync(path.join(tmpdir(), "render-"));
	await renderRecording({ ...settings(), base: arg("base", "http://localhost:8099"), board, rec, out: arg("out", "out.mp4"), tmp });
}
