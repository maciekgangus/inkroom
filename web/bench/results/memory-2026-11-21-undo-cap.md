# Client memory benchmark (2026-11-21, Chromium 158.0.8127.18, window 1600x900, dpr 1)

Bytes per element, by bucket. JS heap is read after two forced GCs; `Path2D` and the canvas are native, so they are read from the renderer's private anonymous memory (Pss_Anon). Ex = per element.

| elements | snapshot JSON | 1 raw data (parsed alone) B/el | 1' app heap, home view B/el | 4 retained beyond the parsed strokes B/el | 4 raw JSON string, outside the heap B/el | 4 parse peak, total heap MB | 2 caches in the heap B/el | 2 caches native B/el |
| -------- | ------------- | ------------------------------ | --------------------------- | ----------------------------------------- | ---------------------------------------- | --------------------------- | ------------------------- | -------------------- |
| 20000    | 86.4 MB       | 9845                           | 10094                       | 249                                       | 9162                                     | 260                         | 32                        | 5816                 |

Bucket 3, the undo history: everything left on the board is erased in one grouped step (R-078) and the heap is read again. If the history did not hold the strokes the heap would fall by about (elements erased x bytes per element of bucket 1).

| elements | erased | heap before MB | heap after MB | expected fall MB | actual fall MB | held by history MB | heap after undo MB | heap after one more step MB | native (anon) before / after / after undo / after next step MB |
| -------- | ------ | -------------- | ------------- | ---------------- | -------------- | ------------------ | ------------------ | --------------------------- | -------------------------------------------------------------- |
| 20000    | 19865  | 194.5          | 194.9         | 186.5            | -0.4           | 186.9              | 195.5              | 4.3                         | 368 / 383 / 386 / 79                                           |

Process memory per scenario (MB): heap / renderer anon / renderer rss / GPU process anon.

| scenario                                             | 20000                        |
| ---------------------------------------------------- | ---------------------------- |
| empty board (any size)                               | 2.7 / 49.3 / 237.6 / 15.8    |
| after load, home view                                | 195.2 / 259.8 / 451.9 / 15.8 |
| home view after a pan (caches of the strokes passed) | 195.7 / 261.5 / 484.1 / 17.2 |
| zoomed out, whole board in view                      | 195.8 / 370 / 562.8 / 15.8   |
| after the eraser sweeps                              | 196.5 / 405.3 / 654.9 / 17.3 |
| a fresh zoomed-out page, before erasing everything   | 194.5 / 367.6 / 560.4 / 15.8 |
| after erasing everything                             | 194.9 / 383.3 / 606.2 / 15.8 |
| after undo of that                                   | 195.5 / 386 / 608.5 / 15.5   |

Load and responsiveness (frame deltas in ms from requestAnimationFrame while the hand tool pans 120 steps; eraser = the time of the pointer-move handler, the hit test and the erase):

|                                              | 20000                            |
| -------------------------------------------- | -------------------------------- |
| load to the first view (s)                   | 4.7                              |
| pan, home view: p50 / p95 / max              | 16.7 / 16.8 / 50, 5 > 33 ms      |
| pan, zoomed out: p50 / p95 / max             | 16.7 / 199.9 / 216.6, 12 > 33 ms |
| eraser pointer move: p50 / p95 / max ms      | 57.8 / 64.5 / 74.7               |
| elements the sweeps erased                   | 135                              |
| select all + Delete, ms the page was blocked | 219                              |
