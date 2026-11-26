# Renderer (R-115, ADR 0029)

Renders a recorded lesson to an MP4 in the background: a headless Chromium opens the app's render
page (`/b/<board>/r/<recording>?render=1`), which draws the frames with the replay engine and
encodes them as H.264 (WebCodecs, in the page); the chunks go to ffmpeg together with the sound.

It runs in two ways: on one recording from the command line (below), or as the **worker** of the
app, which takes recordings from the app's queue one at a time, renders each and sends the video to
the store (stage 2 of ADR 0029). The container and the rendering during the recording come later.

```sh
RENDER_TOKEN=<the app's RENDER_TOKEN> node render.mjs --worker \
     --base http://app:8080 --jobs http://app:8081   # the app's address and its job port (RENDER_ADDR)
```

The app turns the queue on when it has `RENDER_TOKEN`, and serves the job port on `RENDER_ADDR`
(default `127.0.0.1:8081`, not published). The worker polls every `RENDER_POLL_SECONDS` (10) and
keeps its temporary files under `RENDER_TMP`. Chromium runs as `channel: "chromium"` (new headless):
the default headless shell ignores the flag that makes the app's http address a secure context, and
WebCodecs needs one.

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
