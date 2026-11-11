#!/usr/bin/env python3
"""Load test for the Inkroom server: many simulated people on one board.

Creates a throw-away board (and deletes it afterwards), connects N WebSocket clients to it and
lets some of them draw: finished strokes (`add`) and pen movement (`live`). Reports how long a
stroke takes from the sender to every client, how much CPU and memory the server container used,
whether anybody was dropped and whether every stroke reached the database.

    python3 scripts/loadtest.py --clients 30 --drawers 5 --seconds 15
    python3 scripts/loadtest.py --clients 30 --drawers 30 --live-hz 30   # everybody draws

Needs `pip install websockets`. Against a local `docker compose up` the seeded test account
works; elsewhere pass --email and --password (or LOAD_EMAIL and LOAD_PASSWORD).
"""

import argparse
import asyncio
import json
import multiprocessing as mp
import os
import statistics
import subprocess
import threading
import time
import urllib.request

import websockets


def api(base, method, path, body=None, cookie=None):
    """One JSON request; returns (status, headers, parsed body or None)."""
    req = urllib.request.Request(
        base + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json", **({"Cookie": cookie} if cookie else {})},
    )
    with urllib.request.urlopen(req) as r:
        raw = r.read()
        return r.status, r.headers, json.loads(raw) if raw else None


def dumps(obj):
    """Compact JSON, so the receivers can recognise an `add` by its first bytes."""
    return json.dumps(obj, separators=(",", ":"))


def stroke(client, n, now_ms):
    """A rectangle; `z` carries the send time, which is how the receivers measure latency."""
    x, y = (client * 37 + n * 11) % 900, (client * 53 + n * 17) % 600
    return {
        "id": f"c{client}-{n}",
        "authorId": f"load-{client}",
        "color": "#111111",
        "size": 2,
        "z": now_ms,
        "kind": "rect",
        "points": [[x, y, 0.5], [x + 80, y + 50, 0.5]],
    }


async def run_client(ws_base, board, client, drawing, args, stats, start_at, stop_at):
    """One person: listens to everything, and if `drawing` also draws until `stop_at`."""
    uri = f"{ws_base}/ws/{board}?id=load-{client}&name=load-{client}"
    latencies, received, added = [], 0, 0
    closed_early = False
    try:
        async with websockets.connect(uri, max_size=None, ping_interval=None) as ws:
            await ws.recv()  # the snapshot

            async def listen():
                nonlocal received
                async for raw in ws:
                    received += 1
                    if raw.startswith('{"t":"add"'):  # only these are parsed: it is a lot of traffic
                        z = json.loads(raw)["stroke"]["z"]
                        latencies.append(time.time() * 1000 - z)

            async def draw():
                nonlocal added
                n = live_k = 0
                next_add = next_live = start_at
                while time.time() < stop_at:
                    now = time.time()
                    if now >= next_live:
                        live_k += 1
                        await ws.send(dumps({
                            "t": "live", "id": f"l{client}-{live_k // 40}", "authorId": f"load-{client}",
                            "color": "#111111", "size": 2, "z": int(now * 1000),
                            "points": [[live_k % 900, (live_k * 3) % 600, 0.5]],
                        }))
                        next_live += 1 / args.live_hz
                    if now >= next_add:
                        n += 1
                        await ws.send(dumps({"t": "add", "stroke": stroke(client, n, now * 1000)}))
                        added += 1
                        next_add += 1 / args.add_hz
                    await asyncio.sleep(max(0, min(next_live, next_add) - time.time()))

            listener = asyncio.create_task(listen())
            await asyncio.sleep(max(0, start_at - time.time()))
            if drawing:
                await draw()
            await asyncio.sleep(max(0, stop_at + 1 - time.time()))  # let the last echoes arrive
            if listener.done() and listener.exception():
                closed_early = True
            listener.cancel()
    except Exception as e:  # a refused or dropped connection
        closed_early = True
        stats.put({"error": repr(e)})
    stats.put({"latencies": latencies, "received": received, "added": added, "closed_early": closed_early})


def worker(ws_base, board, ids, drawers, args, stats, start_at, stop_at):
    async def main():
        await asyncio.gather(*[
            run_client(ws_base, board, c, c in drawers, args, stats, start_at, stop_at) for c in ids
        ])
    asyncio.run(main())


def docker_sampler(container, samples, stop):
    """CPU % and memory of the server container, once a second."""
    while not stop.is_set():
        out = subprocess.run(
            ["docker", "stats", "--no-stream", "--format", "{{.CPUPerc}} {{.MemUsage}}", container],
            capture_output=True, text=True,
        ).stdout.split()
        if out:
            samples.append((float(out[0].rstrip("%")), out[1]))
        stop.wait(0.5)


def pct(values, p):
    return statistics.quantiles(values, n=100, method="inclusive")[p - 1] if len(values) > 1 else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8080")
    ap.add_argument("--clients", type=int, default=30)
    ap.add_argument("--drawers", type=int, default=5, help="how many of them draw")
    ap.add_argument("--seconds", type=float, default=15)
    ap.add_argument("--live-hz", type=float, default=60, help="pen samples a second, per drawer")
    ap.add_argument("--add-hz", type=float, default=1, help="finished strokes a second, per drawer")
    ap.add_argument("--procs", type=int, default=4, help="processes the clients are spread over")
    ap.add_argument("--container", default="inkroom-app-1")
    ap.add_argument("--email", default=os.environ.get("LOAD_EMAIL", "test@example.test"))
    ap.add_argument("--password", default=os.environ.get("LOAD_PASSWORD", ""))
    args = ap.parse_args()
    if not args.password:
        ap.error("pass --password or set LOAD_PASSWORD (locally: the seeded test account's)")

    _, headers, _ = api(args.url, "POST", "/api/login", {"email": args.email, "password": args.password})
    cookie = headers["Set-Cookie"].split(";")[0]
    _, _, board = api(args.url, "POST", "/api/boards", {"name": "load test"}, cookie)
    board_id = board["id"]
    ws_base = args.url.replace("http", "ws", 1)

    stats = mp.Queue()
    start_at = time.time() + 3  # all clients connect first
    stop_at = start_at + args.seconds
    ids = list(range(args.clients))
    drawers = set(ids[: args.drawers])
    procs = [
        mp.Process(target=worker, args=(ws_base, board_id, ids[i :: args.procs], drawers, args, stats, start_at, stop_at))
        for i in range(args.procs)
    ]
    samples, stop = [], threading.Event()
    sampler = threading.Thread(target=docker_sampler, args=(args.container, samples, stop), daemon=True)
    sampler.start()
    for p in procs:
        p.start()

    results = [stats.get() for _ in range(args.clients)]
    for p in procs:
        p.join()
    stop.set()
    sampler.join()

    lat = [x for r in results for x in r.get("latencies", [])]
    errors = [r["error"] for r in results if "error" in r]
    added = sum(r.get("added", 0) for r in results)
    received = sum(r.get("received", 0) for r in results)
    dropped = sum(1 for r in results if r.get("closed_early"))

    time.sleep(1.5)  # the server writes in batches every 500 ms
    async def count_saved():
        async with websockets.connect(f"{ws_base}/ws/{board_id}", max_size=None) as ws:
            return len(json.loads(await ws.recv())["strokes"])
    saved = asyncio.run(count_saved())
    api(args.url, "DELETE", f"/api/boards/{board_id}", None, cookie)

    cpu = [s[0] for s in samples]
    print(f"clients {args.clients}, drawers {args.drawers}, {args.seconds:.0f} s, live {args.live_hz:g} Hz, add {args.add_hz:g} Hz")
    print(f"messages received by all clients: {received}  ({received / args.seconds:,.0f} a second)")
    if lat:
        print(f"stroke delivery (sender to each client, ms): median {statistics.median(lat):.1f}, p95 {pct(lat, 95):.1f}, p99 {pct(lat, 99):.1f}, max {max(lat):.1f}  (n={len(lat)})")
    print(f"strokes sent {added}, stored in the database {saved}" + ("" if saved == added else "   <-- MISMATCH"))
    print(f"clients dropped or refused: {dropped}" + (f"  {errors[:3]}" if errors else ""))
    if cpu:
        print(f"server container CPU: median {statistics.median(cpu):.0f}%, peak {max(cpu):.0f}% (100% = one core), memory {samples[-1][1]}")


if __name__ == "__main__":
    main()
