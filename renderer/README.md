# Renderer (R-115, ADR 0029)

Renders a recorded lesson to an MP4 in the background: a headless Chromium opens the app's render
page (`/b/<board>/r/<recording>?render=1`), which draws the frames with the replay engine and
encodes them as H.264 (WebCodecs, in the page); the chunks go to ffmpeg together with the sound.

**This is the prototype** (stage 1 of ADR 0029): one recording from the command line. The job
protocol with the app, the upload to the bucket, the container and the rendering during the
recording come in later stages.

```sh
cd renderer && npm install            # Playwright; its Chromium: npx playwright install chromium
node render.mjs --base http://localhost:8099 --board <id> --rec <id> --out lesson.mp4 \
     [--seconds 30] [--size 1280x720] [--fps 30] [--bitrate 2000000]
```

ffmpeg is run as `$FFMPEG` (default `ffmpeg`). Without ffmpeg installed, use a container:
`FFMPEG="docker run --rm -i -v <tmp>:/w jrottenberg/ffmpeg:6.1-alpine" FFMPEG_DIR=/w node render.mjs ... --tmp <tmp>`.

Measured on a VM with 4 vCPU, 720p, 30 fps, 2 Mb/s (ADR 0029): a 16 s lesson on a simple board
renders in 2 s (8 times faster than real time). The first 20 minutes of a synthetic, very dense hour
(4000 strokes, 305 thousand events, the view and a cursor moving all the time, so no frame repeats)
took 13 minutes (1.5 times real time), used 1.5 cores on average (2 at most) and up to 2.1 GB
(all Chromium processes, with the whole hour's log loaded), and made 292 MB of video.
