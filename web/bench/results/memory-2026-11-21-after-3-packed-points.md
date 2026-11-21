# Client memory benchmark (2026-11-21, Chromium 158.0.8127.18, window 1600x900, dpr 1)

Bytes per element, by bucket. JS heap is read after two forced GCs; `Path2D` and the canvas are native, so they are read from the renderer's private anonymous memory (Pss_Anon). Ex = per element.

| elements | snapshot JSON | 1 raw data (parsed alone) B/el | 1' app heap, home view B/el | 4 retained beyond the parsed strokes B/el | 4 raw JSON string, outside the heap B/el | 4 parse peak, total heap MB | 2 caches in the heap B/el | 2 caches native B/el |
| -------- | ------------- | ------------------------------ | --------------------------- | ----------------------------------------- | ---------------------------------------- | --------------------------- | ------------------------- | -------------------- |
| 5000     | 21.6 MB       | 9874                           | 771                         | -9103                                     | 9374                                     | 117                         | 148                       | 1290                 |
| 20000    | 86.4 MB       | 9845                           | 720                         | -9125                                     | 9164                                     | 253                         | 142                       | 1237                 |

Bucket 3, the undo history: everything left on the board is erased in one grouped step (R-078) and the heap is read again. If the history did not hold the strokes the heap would fall by about (elements erased x bytes per element of bucket 1).

| elements | erased | heap before MB | heap after MB | expected fall MB | actual fall MB | held by history MB | heap after undo MB | heap after one more step MB | native (anon) before / after / after undo / after next step MB |
| -------- | ------ | -------------- | ------------- | ---------------- | -------------- | ------------------ | ------------------ | --------------------------- | -------------------------------------------------------------- |
| 5000     | 4877   | 7.0            | 7.5           | 45.9             | -0.5           | 46.5               | 7.7                | 7.5                         | 77 / 84 / 88 / 88                                              |
| 20000    | 19865  | 19.0           | 19.4          | 186.5            | -0.4           | 187.0              | 21.0               | 9.2                         | 149 / 163 / 192 / 113                                          |

Process memory per scenario (MB): heap / renderer anon / renderer rss / GPU process anon.

| scenario                                             | 5000                      | 20000                       |
| ---------------------------------------------------- | ------------------------- | --------------------------- |
| empty board (any size)                               | 2.7 / 49.3 / 237.3 / 15.8 | 2.7 / 49.3 / 237.3 / 15.8   |
| after load, home view                                | 6.4 / 71.1 / 265.5 / 15.8 | 16.4 / 124 / 316.2 / 15.8   |
| home view after a pan (caches of the strokes passed) | 6.8 / 71.9 / 295 / 17.3   | 16.9 / 125.7 / 348.2 / 17.3 |
| zoomed out, whole board in view                      | 7.1 / 77.8 / 299.4 / 15.8 | 19.1 / 150 / 343 / 15.8     |
| after the eraser sweeps                              | 7.8 / 86.9 / 308.6 / 17.2 | 19.8 / 163.7 / 413.4 / 17.3 |
| a fresh zoomed-out page, before erasing everything   | 7 / 77.1 / 271.6 / 15.8   | 19 / 149.4 / 342.4 / 15.8   |
| after erasing everything                             | 7.5 / 83.7 / 307 / 15.7   | 19.4 / 163.1 / 386.2 / 15.8 |
| after undo of that                                   | 7.7 / 88.1 / 310.8 / 16.1 | 21 / 191.7 / 414.4 / 15.5   |

Load and responsiveness (frame deltas in ms from requestAnimationFrame while the hand tool pans 120 steps; eraser = the time of the pointer-move handler, the hit test and the erase):

|                                              | 5000                          | 20000                            |
| -------------------------------------------- | ----------------------------- | -------------------------------- |
| load to the first view (s)                   | 1.2                           | 4.6                              |
| pan, home view: p50 / p95 / max              | 16.7 / 16.7 / 16.8, 0 > 33 ms | 16.7 / 16.8 / 33.4, 5 > 33 ms    |
| pan, zoomed out: p50 / p95 / max             | 16.7 / 33.3 / 100, 8 > 33 ms  | 16.7 / 166.6 / 199.9, 12 > 33 ms |
| eraser pointer move: p50 / p95 / max ms      | 12.5 / 13.7 / 18.1            | 51.4 / 53.3 / 57.2               |
| elements the sweeps erased                   | 123                           | 135                              |
| select all + Delete, ms the page was blocked | 80                            | 159                              |
