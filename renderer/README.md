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

Measured on a VM with 4 vCPU, 720p, 30 fps (see ADR 0029): a simple board renders about 8 times
faster than real time; a very dense hour (4000 strokes, 300 thousand events) about 1.8 times, using
about 1 GB and 1.4 cores.
