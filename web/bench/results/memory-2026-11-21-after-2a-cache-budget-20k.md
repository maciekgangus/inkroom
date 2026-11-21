# Client memory benchmark (2026-11-21, Chromium 158.0.8127.18, window 1600x900, dpr 1)

Bytes per element, by bucket. JS heap is read after two forced GCs; `Path2D` and the canvas are native, so they are read from the renderer's private anonymous memory (Pss_Anon). Ex = per element.

| elements | snapshot JSON | 1 raw data (parsed alone) B/el | 1' app heap, home view B/el | 4 retained beyond the parsed strokes B/el | 4 raw JSON string, outside the heap B/el | 4 parse peak, total heap MB | 2 caches in the heap B/el | 2 caches native B/el |
| -------- | ------------- | ------------------------------ | --------------------------- | ----------------------------------------- | ---------------------------------------- | --------------------------- | ------------------------- | -------------------- |
| 20000    | 86.4 MB       | 9845                           | 10080                       | 235                                       | 9163                                     | 259                         | 141                       | 1851                 |

Bucket 3, the undo history: everything left on the board is erased in one grouped step (R-078) and the heap is read again. If the history did not hold the strokes the heap would fall by about (elements erased x bytes per element of bucket 1).

| elements | erased | heap before MB | heap after MB | expected fall MB | actual fall MB | held by history MB | heap after undo MB | native (anon) before / after / after undo MB |
| -------- | ------ | -------------- | ------------- | ---------------- | -------------- | ------------------ | ------------------ | -------------------------------------------- |
| 20000    | 19865  | 196.3          | 197.3         | 186.5            | -1.0           | 187.5              | 198.7              | 295 / 310 / 320                              |

Process memory per scenario (MB): heap / renderer anon / renderer rss / GPU process anon.

| scenario                                             | 20000                        |
| ---------------------------------------------------- | ---------------------------- |
| empty board (any size)                               | 2.7 / 49.3 / 237.8 / 15.8    |
| after load, home view                                | 195 / 259.7 / 452.4 / 15.8   |
| home view after a pan (caches of the strokes passed) | 195.4 / 261.5 / 484.6 / 17.2 |
| zoomed out, whole board in view                      | 197.6 / 297.2 / 489.1 / 15.8 |
| after the eraser sweeps                              | 198.3 / 330.8 / 551.9 / 17.3 |
| a fresh zoomed-out page, before erasing everything   | 196.3 / 295.3 / 487.3 / 15.8 |
| after erasing everything                             | 197.3 / 310.2 / 532.2 / 15.8 |
| after undo of that                                   | 198.7 / 320.3 / 541.8 / 15.5 |

Load and responsiveness (frame deltas in ms from requestAnimationFrame while the hand tool pans 120 steps; eraser = the time of the pointer-move handler, the hit test and the erase):

|                                              | 20000                            |
| -------------------------------------------- | -------------------------------- |
| load to the first view (s)                   | 4.7                              |
| pan, home view: p50 / p95 / max              | 16.7 / 16.8 / 50.1, 4 > 33 ms    |
| pan, zoomed out: p50 / p95 / max             | 16.7 / 183.3 / 216.7, 12 > 33 ms |
| eraser pointer move: p50 / p95 / max ms      | 56.5 / 60.7 / 70.2               |
| elements the sweeps erased                   | 135                              |
| select all + Delete, ms the page was blocked | 1476                             |
