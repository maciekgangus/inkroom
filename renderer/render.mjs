// Renders a recorded lesson to an MP4 (R-115, ADR 0029): a headless Chromium opens the app's render
// page, which draws the frames with the replay engine and encodes them as H.264 (WebCodecs); the
// chunks go to ffmpeg together with the lesson's sound.
//
//   node render.mjs --base http://localhost:8099 --board <id> --rec <id> --out out.mp4
//        [--seconds 30] [--size 1280x720] [--fps 30] [--bitrate 2000000] [--tmp /some/dir]
//
// ffmpeg is run as `$FFMPEG` (default "ffmpeg"); to use a container, set FFMPEG="docker run --rm -i
// -v <tmp>:/w <image>" and FFMPEG_DIR=/w, so the files it reads and writes are named as it sees them.
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, mkdtempSync, writeFileSync, statSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : fallback;
};
const base = arg("base", "http://localhost:8099");
const board = arg("board");
const rec = arg("rec");
const out = arg("out", "out.mp4");
const seconds = arg("seconds") ? Number(arg("seconds")) : undefined;
const [width, height] = arg("size", "1280x720").split("x").map(Number);
const fps = Number(arg("fps", "30"));
const bitrate = Number(arg("bitrate", "2000000"));
if (!board || !rec) throw new Error("--board and --rec are required");

const tmp = arg("tmp") ?? mkdtempSync(path.join(tmpdir(), "render-"));
mkdirSync(tmp, { recursive: true });
const ffmpeg = (process.env.FFMPEG ?? "ffmpeg").split(" ");
const inside = (name) => (process.env.FFMPEG_DIR ? path.posix.join(process.env.FFMPEG_DIR, name) : path.join(tmp, name));

const log = (msg) => console.error(`[render ${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
const t0 = Date.now();

// The sound of the recording, from where the player index says it is.
const index = await (await fetch(`${base}/api/boards/${board}/recordings/${rec}/play`)).json();
const audioUrl = new URL(index.audio, base).toString();
const audio = Buffer.from(await (await fetch(audioUrl)).arrayBuffer());
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
ff.stdin.on("error", () => {});

const browser = await chromium.launch({
	args: [
		`--unsafely-treat-insecure-origin-as-secure=${new URL(base).origin}`,
		...(process.env.RENDER_NO_SANDBOX ? ["--no-sandbox"] : []),
	],
});
try {
	const page = await browser.newPage({ viewport: { width, height } });
	page.on("pageerror", (e) => log(`page error: ${e.message}`));
	const raw = process.env.KEEP_RAW ? createWriteStream(path.join(tmp, "raw.h264")) : null;
	await page.exposeFunction("__emit", (b64) => {
		const b = Buffer.from(b64, "base64");
		raw?.write(b);
		ff.stdin.write(b);
	});
	await page.exposeFunction("__progress", (done, total) => log(`frame ${done} / ${total}`));
	await page.goto(`${base}/b/${board}/r/${rec}?render=1`);
	await page.waitForFunction(() => window.__replay !== undefined);
	await page.evaluate(() => window.__replay.ready);
	log("loaded, rendering");
	const t1 = Date.now();
	const { frames } = await page.evaluate((o) => window.__replay.encode(o), { width, height, fps, bitrate, seconds });
	const took = (Date.now() - t1) / 1000;
	log(`${frames} frames in ${took.toFixed(1)} s = ${(frames / took).toFixed(0)} frames/s (${(frames / fps / took).toFixed(1)}x real time)`);
} finally {
	await browser.close();
}
ff.stdin.end();
await ffDone;
copyFileSync(path.join(tmp, "out.mp4"), out);
log(`wrote ${out}, ${(statSync(out).size / 1024).toFixed(0)} KB`);
