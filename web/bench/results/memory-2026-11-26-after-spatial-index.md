# Client memory benchmark (2026-11-26, Chromium 158.0.8127.18, window 1600x900, dpr 1)

Bytes per element, by bucket. JS heap is read after two forced GCs; `Path2D` and the canvas are native, so they are read from the renderer's private anonymous memory (Pss_Anon). Ex = per element.

| elements | snapshot JSON | 1 raw data (parsed alone) B/el | 1' app heap, home view B/el | 4 retained beyond the parsed strokes B/el | 4 raw JSON string, outside the heap B/el | 4 parse peak, total heap MB | 2 caches in the heap B/el | 2 caches native B/el |
|---|---|---|---|---|---|---|---|---|
| 5000 | 21.6 MB | 9874 | 832 | -9041 | 9365 | 118 | 261 | 1087 |
| 20000 | 86.4 MB | 9845 | 775 | -9070 | 9161 | 255 | 256 | 1341 |

Bucket 3, the undo history: everything left on the board is erased in one grouped step (R-078) and the heap is read again. If the history did not hold the strokes the heap would fall by about (elements erased x bytes per element of bucket 1).

| elements | erased | heap before MB | heap after MB | expected fall MB | actual fall MB | held by history MB | heap after undo MB | heap after one more step MB | native (anon) before / after / after undo / after next step MB |
|---|---|---|---|---|---|---|---|---|---|
| 5000 | 4766 | 7.8 | 7.9 | 44.9 | -0.0 | 44.9 | 11.0 | 8.2 | 82 / 87 / 109 / 94 |
| 20000 | 1198 | 22.2 | 20.8 | 11.2 | 1.5 | 9.8 | 38.9 | 15.2 | 156 / 235 / 257 / 118 |

Process memory per scenario (MB): heap / renderer anon / renderer rss / GPU process anon.

| scenario | 5000 | 20000 |
|---|---|---|
| empty board (any size) | 2.7 / 52.1 / 240.2 / 17.5 | 2.7 / 52.1 / 240.2 / 17.5 |
| after load, home view | 6.7 / 74.9 / 295 / 17.6 | 17.5 / 127.2 / 347.6 / 17.6 |
| home view after a pan (caches of the strokes passed) | 7.2 / 74.9 / 296.9 / 18.6 | 18 / 130 / 352.2 / 18.7 |
| zoomed out, whole board in view | 7.9 / 81.3 / 301.7 / 17.6 | 22.3 / 157.3 / 377.6 / 17.6 |
| after the eraser sweeps | 8.7 / 89.3 / 311.2 / 18.7 | 23 / 171.4 / 392.2 / 18.7 |
| a fresh zoomed-out page, before erasing everything | 7.8 / 81.9 / 301.8 / 17.6 | 22.2 / 155.7 / 375.7 / 17.6 |
| after erasing everything | 7.9 / 87.4 / 308.8 / 17 | 20.8 / 235.1 / 456.7 / 17.3 |
| after undo of that | 11 / 109.4 / 296.2 / 16.9 | 38.9 / 257.2 / 478.5 / 18.4 |

Load and responsiveness (frame deltas in ms from requestAnimationFrame while the hand tool pans 120 steps; eraser = the time of the pointer-move handler, the hit test and the erase):

| | 5000 | 20000 |
|---|---|---|
| load to the first view (s) | 2.2 | 7.9 |
| pan, home view: p50 / p95 / max | 16.7 / 16.8 / 33.4, 5 > 33 ms | 16.7 / 33.4 / 66.8, 8 > 33 ms |
| pan, zoomed out: p50 / p95 / max | 16.7 / 116.6 / 266.7, 12 > 33 ms | 16.7 / 383.3 / 400, 25 > 33 ms |
| eraser pointer move: p50 / p95 / max ms | 0.1 / 0.2 / 0.7 | 0.2 / 0.4 / 26.4 |
| elements the sweeps erased | 123 | 135 |
| select all + Delete, ms the page was blocked | 227 | 463 |
