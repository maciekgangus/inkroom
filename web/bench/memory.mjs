// Client memory benchmark for boards with many strokes (R-100). Not part of the test suites or CI:
//   cd web && npm run bench:memory          (BENCH_SIZES=5000,20000,50000 by default)
// It builds the server and the seed tool, starts a throwaway server, seeds boards through the real
// store, opens each in a fresh headless Chromium and measures four buckets separately (see README):
//   1 raw point data   2 render caches   3 undo/redo history   4 snapshot parse.

import { execFileSync, spawn } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PORT = Number(process.env.BENCH_PORT ?? 8198);
const BASE = `http://localhost:${PORT}`;
const SIZES = (process.env.BENCH_SIZES ?? "5000,20000,50000")
	.split(",")
	.map(Number);
const EMAIL = "bench@example.test";
const PASS = "bench-pass-12345";
const W = 1600;
const H = 900;
const MB = 1024 * 1024;

const log = (...a) => console.error("[bench]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the server and the seeded boards ------------------------------------------------------
const tmp = mkdtempSync(path.join(tmpdir(), "inkroom-bench-"));
const dataDir = path.join(tmp, "data");
mkdirSync(dataDir);
log("building the server and the seed tool");
execFileSync("go", ["build", "-o", path.join(tmp, "server"), "./cmd/server"], {
	cwd: path.join(ROOT, "server"),
	stdio: "inherit",
});
execFileSync(
	"go",
	["build", "-o", path.join(tmp, "benchseed"), "./cmd/benchseed"],
	{ cwd: path.join(ROOT, "server"), stdio: "inherit" },
);
const server = spawn(path.join(tmp, "server"), [], {
	env: {
		...process.env,
		DATA_DIR: dataDir,
		PORT: String(PORT),
		STATIC_DIR: path.join(ROOT, "web/dist"),
		METRICS_ADDR: `127.0.0.1:${PORT + 1000}`,
		SEED_USER_EMAIL: EMAIL,
		SEED_USER_PASSWORD: PASS,
		APP_VERSION: "bench",
		LOG_LEVEL: "ERROR",
	},
	stdio: "ignore",
});
const cleanup = () => {
	server.kill();
	rmSync(tmp, { recursive: true, force: true });
};
process.on("exit", cleanup);
for (let i = 0; i < 60; i++) {
	try {
		if ((await fetch(`${BASE}/healthz`)).ok) break;
	} catch {}
	await sleep(500);
}

const seed = (n, name) =>
	execFileSync(
		path.join(tmp, "benchseed"),
		[
			"-db",
			path.join(dataDir, "inkroom.db"),
			"-email",
			EMAIL,
			"-n",
			String(n),
			"-name",
			name,
		],
		{ encoding: "utf8" },
	).trim();

// ---- process memory of Chromium ------------------------------------------------------------
const smaps = (pid) => {
	const out = {};
	try {
		for (const line of readFileSync(`/proc/${pid}/smaps_rollup`, "utf8").split(
			"\n",
		)) {
			const m = /^(\w+):\s+(\d+) kB/.exec(line);
			if (m) out[m[1]] = Number(m[2]) * 1024;
		}
	} catch {}
	return out;
};

/** One reading: JS heap after two forced collections, and the memory of the renderer and GPU processes. */
async function sample(cdp, browserCdp) {
	await cdp.send("HeapProfiler.collectGarbage");
	await cdp.send("HeapProfiler.collectGarbage");
	await sleep(300);
	const heap = await cdp.send("Runtime.getHeapUsage");
	const { processInfo } = await browserCdp.send("SystemInfo.getProcessInfo");
	let renderer = {};
	let gpu = {};
	for (const p of processInfo) {
		const s = smaps(p.id);
		if (p.type === "renderer" && (s.Rss ?? 0) > (renderer.Rss ?? 0))
			renderer = s;
		if (p.type === "GPU") gpu = s;
	}
	return {
		heap: heap.usedSize,
		heapTotal: heap.totalSize,
		rendererRss: renderer.Rss ?? 0,
		rendererAnon: renderer.Pss_Anon ?? 0,
		gpuRss: gpu.Rss ?? 0,
		gpuAnon: gpu.Pss_Anon ?? 0,
	};
}

async function openPage(boardId, view) {
	const browser = await chromium.launch({
		args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"],
	});
	const context = await browser.newContext({
		viewport: { width: W, height: H },
		deviceScaleFactor: 1,
	});
	const req = context.request;
	const login = await req.post(`${BASE}/api/login`, {
		data: { login: EMAIL, password: PASS },
	});
	if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
	if (view) await req.put(`${BASE}/api/boards/${boardId}/view`, { data: view });
	if (process.env.BENCH_DEVMEM)
		await context.addInitScript(
			`Object.defineProperty(navigator,'deviceMemory',{get:()=>${Number(process.env.BENCH_DEVMEM)}})`,
		);
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	const browserCdp = await browser.newBrowserCDPSession();
	let snapshotBytes = 0;
	page.on("websocket", (ws) =>
		ws.on("framereceived", (f) => {
			const len =
				typeof f.payload === "string" ? f.payload.length : f.payload.byteLength;
			if (len > snapshotBytes) snapshotBytes = len;
		}),
	);
	// The JS heap peak while loading (the parse spike), polled.
	let peak = 0;
	let polling = true;
	(async () => {
		while (polling) {
			try {
				const h = await cdp.send("Runtime.getHeapUsage");
				peak = Math.max(peak, h.totalSize);
			} catch {}
			await sleep(40);
		}
	})();
	const t0 = Date.now();
	await page.goto(`${BASE}/b/${boardId}`);
	await page.waitForSelector(".participants", { timeout: 600_000 });
	const loadMs = Date.now() - t0;
	polling = false;
	await sleep(3000); // let the first paint settle
	return {
		browser,
		context,
		page,
		cdp,
		browserCdp,
		info: () => ({ snapshotBytes, loadMs, heapPeakTotal: peak }),
	};
}

const stats = (xs) => {
	if (!xs.length) return null;
	const s = [...xs].sort((a, b) => a - b);
	const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
	return {
		n: s.length,
		p50: +q(0.5).toFixed(2),
		p95: +q(0.95).toFixed(2),
		max: +s[s.length - 1].toFixed(2),
		over33ms: s.filter((x) => x > 33).length,
	};
};

/** The hand tool dragged across the board, one pointer move per frame: the time between frames. */
async function panFrames(page) {
	return page.evaluate(async () => {
		const live = document.querySelector("canvas#live");
		live.setPointerCapture = () => {};
		const fire = (type, x, y, down) =>
			live.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					cancelable: true,
					pointerId: 1,
					pointerType: "mouse",
					isPrimary: true,
					clientX: x,
					clientY: y,
					pressure: down ? 0.5 : 0,
					button: 0,
					buttons: down ? 1 : 0,
				}),
			);
		const frame = () => new Promise((r) => requestAnimationFrame(r));
		let x = 1200;
		let y = 700;
		fire("pointerdown", x, y, true);
		await frame();
		const times = [];
		let last = await frame();
		for (let i = 0; i < 120; i++) {
			x -= 8;
			y -= 3;
			fire("pointermove", x, y, true);
			const t = await frame();
			times.push(t - last);
			last = t;
		}
		fire("pointerup", x, y, false);
		return times;
	});
}

/** The eraser swept over the board in rows; the time of every pointer move handler (the hit test). */
async function eraseSweeps(page) {
	return page.evaluate(async () => {
		const live = document.querySelector("canvas#live");
		live.setPointerCapture = () => {};
		const fire = (type, x, y, down) =>
			live.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					cancelable: true,
					pointerId: 1,
					pointerType: "mouse",
					isPrimary: true,
					clientX: x,
					clientY: y,
					pressure: down ? 0.5 : 0,
					button: 0,
					buttons: down ? 1 : 0,
				}),
			);
		const frame = () => new Promise((r) => requestAnimationFrame(r));
		const times = [];
		for (let y = 60; y < 860; y += 50) {
			fire("pointerdown", 20, y, true);
			for (let x = 60; x <= 1580; x += 40) {
				const t = performance.now();
				fire("pointermove", x, y, true);
				times.push(performance.now() - t);
			}
			fire("pointerup", 1580, y, false);
			await frame();
		}
		return times;
	});
}

/** One short pen stroke on the board: a further undo step, after which a huge older step may be dropped (R-008, R-100). */
async function drawOneStroke(page) {
	await page.keyboard.press("KeyF"); // the pen
	await page.evaluate(async () => {
		const live = document.querySelector("canvas#live");
		live.setPointerCapture = () => {};
		const fire = (type, x, y, down) =>
			live.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					cancelable: true,
					pointerId: 2,
					pointerType: "mouse",
					isPrimary: true,
					clientX: x,
					clientY: y,
					pressure: down ? 0.5 : 0,
					button: 0,
					buttons: down ? 1 : 0,
				}),
			);
		fire("pointerdown", 300, 300, true);
		for (let i = 1; i <= 20; i++)
			fire("pointermove", 300 + i * 10, 300 + i * 4, true);
		fire("pointerup", 500, 380, false);
	});
}

/** The select tool dragged over the whole screen, then Delete: everything in view is erased in one grouped step. */
async function selectAllAndDelete(page) {
	await page.keyboard.press("KeyQ");
	await page.evaluate(async () => {
		const live = document.querySelector("canvas#live");
		live.setPointerCapture = () => {};
		const fire = (type, x, y, down) =>
			live.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					cancelable: true,
					pointerId: 1,
					pointerType: "mouse",
					isPrimary: true,
					clientX: x,
					clientY: y,
					pressure: down ? 0.5 : 0,
					button: 0,
					buttons: down ? 1 : 0,
				}),
			);
		const frame = () => new Promise((r) => requestAnimationFrame(r));
		fire("pointerdown", 2, 2, true);
		await frame();
		fire("pointermove", 800, 450, true);
		await frame();
		fire("pointermove", 1598, 898, true);
		await frame();
		fire("pointerup", 1598, 898, false);
		await frame();
	});
	await sleep(1500);
	const t = Date.now();
	await page.keyboard.press("Delete");
	await page.evaluate(() => 1); // answers only when the page is free again: how long Delete blocked it
	return Date.now() - t;
}

/** The same snapshot read without the app: what its parsed strokes cost alone, and the raw string. */
async function parsedOnly(boardId) {
	const browser = await chromium.launch({
		args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"],
	});
	const context = await browser.newContext({
		viewport: { width: 800, height: 600 },
	});
	await context.request.post(`${BASE}/api/login`, {
		data: { login: EMAIL, password: PASS },
	});
	const page = await context.newPage();
	await page.goto(`${BASE}/healthz`);
	const cdp = await context.newCDPSession(page);
	const browserCdp = await browser.newBrowserCDPSession();
	const h0 = await sample(cdp, browserCdp);
	const textBytes = await page.evaluate(
		(url) =>
			new Promise((resolve, reject) => {
				const ws = new WebSocket(url);
				ws.onerror = reject;
				ws.onmessage = (e) => {
					if (
						typeof e.data === "string" &&
						e.data.slice(-40).includes('"t":"snapshot"')
					) {
						window.__text = e.data;
						ws.close();
						resolve(e.data.length);
					}
				};
			}),
		`ws://localhost:${PORT}/ws/${boardId}`,
	);
	const h1 = await sample(cdp, browserCdp); // the raw JSON string held (it lives outside the JS heap)
	const count = await page.evaluate(() => {
		window.__strokes = JSON.parse(window.__text).strokes;
		window.__text = null;
		return window.__strokes.length;
	});
	const h2 = await sample(cdp, browserCdp);
	await browser.close();
	return {
		count,
		textBytes,
		heapString: h1.heap - h0.heap,
		anonString: h1.rendererAnon - h0.rendererAnon,
		heapParsed: h2.heap - h0.heap,
		anonParsed: h2.rendererAnon - h0.rendererAnon,
	};
}

const pick = (s) => ({
	heapMB: +(s.heap / MB).toFixed(1),
	rendererRssMB: +(s.rendererRss / MB).toFixed(1),
	rendererAnonMB: +(s.rendererAnon / MB).toFixed(1),
	gpuRssMB: +(s.gpuRss / MB).toFixed(1),
	gpuAnonMB: +(s.gpuAnon / MB).toFixed(1),
});

// ---- run -----------------------------------------------------------------------------------
const results = {
	date: new Date().toISOString(),
	window: [W, H],
	chromium: null,
	sizes: {},
};

// an empty board: what the app itself costs
log("empty board");
{
	const id = seed(0, "bench-empty");
	const p = await openPage(id, { x: 0, y: 0, scale: 1 });
	results.chromium = p.browser.version();
	results.empty = await sample(p.cdp, p.browserCdp);
	await p.browser.close();
}

for (const n of SIZES) {
	log(`board of ${n} elements: seeding`);
	const id = seed(n, `bench-${n}`);
	const r = { id, n };
	r.parsedOnly = await parsedOnly(id);

	log(`${n}: home view (scale 1, a few strokes in view)`);
	{
		const p = await openPage(id, { x: 0, y: 0, scale: 1 });
		r.load = p.info();
		r.home = await sample(p.cdp, p.browserCdp);
		await p.page.keyboard.press("KeyM"); // the hand tool
		r.homePanFrames = stats(await panFrames(p.page));
		await sleep(500);
		r.homeAfterPan = await sample(p.cdp, p.browserCdp);
		await p.browser.close();
	}

	log(
		`${n}: zoomed out (scale 0.1, the whole board in view: every cache fills)`,
	);
	{
		const p = await openPage(id, { x: -500, y: -500, scale: 0.1 }); // an empty corner, so a drag there starts a marquee
		r.zoomOut = await sample(p.cdp, p.browserCdp);
		await p.page.keyboard.press("KeyM");
		r.zoomOutPanFrames = stats(await panFrames(p.page));
		await p.page.keyboard.press("KeyE"); // the eraser
		r.eraseHitMs = stats(await eraseSweeps(p.page));
		await sleep(2500);
		r.afterSweeps = await sample(p.cdp, p.browserCdp);
		await p.browser.close();
	}

	log(
		`${n}: a fresh page, select everything and delete it (one grouped step, R-078), then undo`,
	);
	{
		// The pan above moved the view, so this is a new page at the same starting view.
		const p = await openPage(id, { x: -500, y: -500, scale: 0.1 });
		r.beforeEraseAll = await sample(p.cdp, p.browserCdp);
		r.remainingBeforeEraseAll = (await parsedOnly(id)).count;
		r.eraseAllMs = await selectAllAndDelete(p.page);
		await sleep(3000);
		r.afterEraseAll = await sample(p.cdp, p.browserCdp);
		await sleep(500);
		r.remainingAfterEraseAll = (await parsedOnly(id)).count;
		await p.page.keyboard.press("Control+KeyZ"); // the grouped step undone
		await sleep(3000);
		r.afterUndo = await sample(p.cdp, p.browserCdp);
		// erased again (redo), then one more step: the step that held everything is past the limit now
		await p.page.keyboard.press("Control+Shift+KeyZ");
		await sleep(3000);
		await drawOneStroke(p.page);
		await sleep(3000);
		r.afterNextStep = await sample(p.cdp, p.browserCdp);
		await p.browser.close();
	}
	results.sizes[n] = r;
}

// ---- report --------------------------------------------------------------------------------
const per = (bytes, n) => (n ? Math.round(bytes / n) : 0);
const lines = [];
const out = (s = "") => lines.push(s);
const e = results.empty;
out(
	`# Client memory benchmark (${results.date.slice(0, 10)}, Chromium ${results.chromium}, window ${W}x${H}, dpr 1)`,
);
out();
out(
	"Bytes per element, by bucket. JS heap is read after two forced GCs; `Path2D` and the canvas are native, so they are read from the renderer's private anonymous memory (Pss_Anon). Ex = per element.",
);
out();
out(
	"| elements | snapshot JSON | 1 raw data (parsed alone) B/el | 1' app heap, home view B/el | 4 retained beyond the parsed strokes B/el | 4 raw JSON string, outside the heap B/el | 4 parse peak, total heap MB | 2 caches in the heap B/el | 2 caches native B/el |",
);
out("|---|---|---|---|---|---|---|---|---|");
const VISIBLE_HOME = 0.012; // the share of the elements in view at scale 1 (1600x900 of 15000x8000)
for (const n of SIZES) {
	const r = results.sizes[n];
	const extra = n * (1 - VISIBLE_HOME);
	const heapCache = r.zoomOut.heap - r.home.heap;
	const nativeCache = r.zoomOut.rendererAnon - r.home.rendererAnon - heapCache;
	out(
		`| ${n} | ${(r.load.snapshotBytes / MB).toFixed(1)} MB | ${per(r.parsedOnly.heapParsed, n)} | ${per(r.home.heap - e.heap, n)} | ${per(r.home.heap - e.heap - r.parsedOnly.heapParsed, n)} | ${per(r.parsedOnly.anonString, n)} | ${(r.load.heapPeakTotal / MB).toFixed(0)} | ${per(heapCache, extra)} | ${per(nativeCache, extra)} |`,
	);
}
out();
out(
	"Bucket 3, the undo history: everything left on the board is erased in one grouped step (R-078) and the heap is read again. If the history did not hold the strokes the heap would fall by about (elements erased x bytes per element of bucket 1).",
);
out();
out(
	"| elements | erased | heap before MB | heap after MB | expected fall MB | actual fall MB | held by history MB | heap after undo MB | heap after one more step MB | native (anon) before / after / after undo / after next step MB |",
);
out("|---|---|---|---|---|---|---|---|---|---|");
for (const n of SIZES) {
	const r = results.sizes[n];
	const erased = r.remainingBeforeEraseAll - r.remainingAfterEraseAll;
	const expected = (erased * r.parsedOnly.heapParsed) / n;
	const actual = r.beforeEraseAll.heap - r.afterEraseAll.heap;
	out(
		`| ${n} | ${erased} | ${(r.beforeEraseAll.heap / MB).toFixed(1)} | ${(r.afterEraseAll.heap / MB).toFixed(1)} | ${(expected / MB).toFixed(1)} | ${(actual / MB).toFixed(1)} | ${(Math.max(0, expected - actual) / MB).toFixed(1)} | ${(r.afterUndo.heap / MB).toFixed(1)} | ${(r.afterNextStep.heap / MB).toFixed(1)} | ${(r.beforeEraseAll.rendererAnon / MB).toFixed(0)} / ${(r.afterEraseAll.rendererAnon / MB).toFixed(0)} / ${(r.afterUndo.rendererAnon / MB).toFixed(0)} / ${(r.afterNextStep.rendererAnon / MB).toFixed(0)} |`,
	);
}
out();
out(
	"Process memory per scenario (MB): heap / renderer anon / renderer rss / GPU process anon.",
);
out();
out("| scenario | " + SIZES.join(" | ") + " |");
out("|---|" + SIZES.map(() => "---").join("|") + "|");
const fmt = (s) => {
	const p = pick(s);
	return `${p.heapMB} / ${p.rendererAnonMB} / ${p.rendererRssMB} / ${p.gpuAnonMB}`;
};
out(`| empty board (any size) | ${SIZES.map(() => fmt(e)).join(" | ")} |`);
for (const [label, key] of [
	["after load, home view", "home"],
	["home view after a pan (caches of the strokes passed)", "homeAfterPan"],
	["zoomed out, whole board in view", "zoomOut"],
	["after the eraser sweeps", "afterSweeps"],
	["a fresh zoomed-out page, before erasing everything", "beforeEraseAll"],
	["after erasing everything", "afterEraseAll"],
	["after undo of that", "afterUndo"],
]) {
	out(
		`| ${label} | ` +
			SIZES.map((n) => fmt(results.sizes[n][key])).join(" | ") +
			" |",
	);
}
out();
out(
	"Load and responsiveness (frame deltas in ms from requestAnimationFrame while the hand tool pans 120 steps; eraser = the time of the pointer-move handler, the hit test and the erase):",
);
out();
out("| | " + SIZES.join(" | ") + " |");
out("|---|" + SIZES.map(() => "---").join("|") + "|");
const fr = (s) => `${s.p50} / ${s.p95} / ${s.max}, ${s.over33ms} > 33 ms`;
out(
	"| load to the first view (s) | " +
		SIZES.map((n) => (results.sizes[n].load.loadMs / 1000).toFixed(1)).join(
			" | ",
		) +
		" |",
);
out(
	"| pan, home view: p50 / p95 / max | " +
		SIZES.map((n) => fr(results.sizes[n].homePanFrames)).join(" | ") +
		" |",
);
out(
	"| pan, zoomed out: p50 / p95 / max | " +
		SIZES.map((n) => fr(results.sizes[n].zoomOutPanFrames)).join(" | ") +
		" |",
);
out(
	"| eraser pointer move: p50 / p95 / max ms | " +
		SIZES.map((n) => {
			const s = results.sizes[n].eraseHitMs;
			return `${s.p50} / ${s.p95} / ${s.max}`;
		}).join(" | ") +
		" |",
);
out(
	"| elements the sweeps erased | " +
		SIZES.map((n) => n - results.sizes[n].remainingBeforeEraseAll).join(" | ") +
		" |",
);
out(
	"| select all + Delete, ms the page was blocked | " +
		SIZES.map((n) => results.sizes[n].eraseAllMs).join(" | ") +
		" |",
);

const dir = path.join(import.meta.dirname, "results");
mkdirSync(dir, { recursive: true });
const stamp = results.date.slice(0, 10);
writeFileSync(
	path.join(dir, `memory-${stamp}.json`),
	JSON.stringify(results, null, 2),
);
writeFileSync(path.join(dir, `memory-${stamp}.md`), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
cleanup();
