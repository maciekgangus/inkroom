# 0031. Kafelkowy indeks przestrzenny elementów tablicy

- Status: accepted
- Data: 2026-11-26

## Kontekst
R-118 (realizacja indeksu przestrzennego z R-043, uzupełnienie R-100 i R-112): obecnie każda operacja trafiania i przycinania na tablicy przegląda liniowo całą listę `board.strokes` — gumka (`findHit`), kliknięcie i hover w Zaznacz (`startSelect`, `pickObject`), menu PPM (`contextTarget`), dwuklik na tekście (`editTextAt`), ramka i lasso (`marquee`, `lasso`) oraz przycinanie widoku w `CanvasRenderer.paintCommitted()`.

Benchmark na tablicy z 20 tys. elementów (`web/bench/results/memory-2026-11-21-after-3-packed-points.md`) pokazuje, że samo trafianie gumką podczas ruchu kursora zajmuje **51,4 ms** (mediana, maks. 57,2 ms), co przekracza budżet klatki 16,7 ms (N-012) i zmusiło R-112 do tymczasowego wyłączania hovera na dużych tablicach.

Ograniczenia:
- Priorytet 1: responsywność, priorytet 2: iPady i słabsze tablety z Androidem (mały narzut RAM, R-100).
- Prostota i brak ciężkich zewnętrznych bibliotek (`web/package.json` trzyma minimum zależności).
- Nieskończone płótno (R-010): elementy mogą leżeć na dowolnych współrzędnych dodatnich i ujemnych.
- Identyczność wyników z dotychczasowym skanem liniowym (ta sama kolejność rysowania `(z, id)` i trafiania) oraz brak rozjazdu po zdalnych zmianach, cofaniu/ponawianiu i asynchronicznym ładowaniu czcionek (R-044, R-101, ADR 0026).
- Numeracja: `ADR 0028`–`0030` oraz `R-113`–`R-117` są zarezerwowane przez otwarty PR #134, stąd numer `0031` i `R-118`.

## Rozważane opcje
1. **Drzewo czwórkowe (quadtree) lub R-tree (np. zewnętrzna biblioteka `rbush`).** Dobrze radzi sobie z nierównomiernym skupieniem obiektów, ale quadtree źle znosi nieskończone płótno bez stałych granic i wymaga przebudowy przy wzroście obszaru, a własne R-tree jest złożone w utrzymaniu (albo dokłada zewnętrzną zależność).
2. **Siatka kafelkowa w przestrzeni świata (`1024 × 1024`) + osobny kubełek `largeObjects`, utrzymywana wewnątrz `Board`.** Stały czas O(1) wstawiania i usuwania, naturalna obsługa nieskończonego płótna bez granic, kilkadziesiąt linii czystego TypeScriptu bez zależności, łatwa weryfikacja 1:1 ze skanem liniowym.
3. **Indeks utrzymywany osobno w `CanvasRenderer` lub `Controller`.** Wymuszałby dublowanie logiki synchronizacji ze zmianami tablicy albo osobne wykrywanie diffów przy każdym `redraw(strokes)`, zwiększając ryzyko rozjazdu między rysowaniem a trafianiem.

## Decyzja
Wybieramy **opcję 2**: własny, niewielki moduł `web/src/board/spatial-index.ts` (siatka kafelkowa + kubełek `largeObjects`), którego jedynym właścicielem i punktem aktualizacji jest `Board` (`web/src/board/board.ts`).

Szczegóły konstrukcji:
- **Rozmiar komórki:** `CELL_SIZE = 1024` jednostek tablicy (`Math.floor(coord / 1024)` — bezpieczne dla dowolnych liczb zmiennoprzecinkowych bez przepełnienia operacji bitowych 32-bit).
- **Klucz komórki bez alokacji stringów:** dla współrzędnych komórek w bezpiecznym zakresie (np. `|cx|, |cy| < 2^20`, czyli ponad ±1 miliard jednostek tablicy) pakowany klucz liczbowy `Map<number, Set<Stroke>>`; obiekty z zakresem poza tą granicą trafiają bezpiecznie do `largeObjects`.
- **Kubełek `largeObjects`:** element, którego ramka `strokeBounds(s)` przykrywa więcej niż **`16` komórek** (np. bardzo duża strona PDF, rozciągnięta linia, ogromny układ współrzędnych) trafia do osobnego zbioru `large` sprawdzanego przy każdym zapytaniu zamiast zaśmiecać dziesiątki lub tysiące komórek siatki. Elementy z pustą lub niefinityczną ramką (`!Number.isFinite(...)`) nie wchodzą w pętle komórek (nie mogą zawiesić klienta).
- **Zapamiętane przypisanie przy wstawieniu (zero wycieków):** indeks trzyma mapę `id → { stroke, bounds, minCx, maxCx, minCy, maxCy, large }`. Usunięcie lub aktualizacja zawsze zdejmuje element z dokładnie tych komórek, do których został wstawiony — nigdy przez ponowne przeliczanie `strokeBounds`, które mogło się zmienić (np. po doładowaniu czcionki).
- **Ramka i zgodność z trafianiem:** indeks używa `strokeBounds(s)` (`web/src/board/bounds.ts`), które już obejmuje `worldBounds(s)` z zapasem co najmniej pół grubości linii (i zapasem dla tekstu oraz obrotu). Zapytanie o punkt z promieniem `r` odpytuje prostokąt `[x - r, y - r, x + r, y + r]`, co gwarantuje ścisły nadzbiór wszystkich elementów spełniających `strokeHit` / `objectHit`. Budowanie indeksu następuje po `packStroke(s)` (R-100), więc `pointsBox` czyta spakowane `Float32Array` bez rozpakowywania.
- **Kolejność i brak regresji przy oddaleniu (fallback):**
  - Zapytanie `board.queryRect(rect)` zwraca kandydatów przecinających `rect` (po sprawdzeniu zapamiętanej ramki `intersects(entry.bounds, rect)`), zdeduplikowanych i posortowanych w dokładnej kolejności rysowania `byOrder` (`(z, id)`).
  - Gdy tablica jest mała (np. `< 200` elementów) **albo** zapytanie obejmuje zbyt dużo komórek (np. `> 64` komórki, czyli mocno oddalony widok tablicy przy skali 0.1), `queryRect` nie zbiera komórek i nie sortuje dziesiątek tysięcy obiektów od zera — spada wprost do przejścia po już posortowanej liście `board.strokes` (w wariancie dla rysowania zwracając ją bez kopiowania/sortowania). Eliminuje to ryzyko regresji czasu klatki przy oddalonym panie.
- **Wszystkie mutacje w jednym miejscu (`Board`):** indeks jest aktualizowany w `insert`, `insertMany`, `replace` (także przy zmianie `z`), `remove`, `removeMany` i `setStrokes` (czyli automatycznie obejmuje też `undo`, `redo`, `applyRemote` i podgląd stylu).
- **Asynchroniczne czcionki (R-044, R-101, ADR 0026):** `Board.reindexText()` aktualizuje wpisy elementów `kind === "text"` po zmianie metryk czcionki i jest wywoływane w `web/src/board-view.tsx` obok `canvas.fontsChanged()` (po załadowaniu czcionek startowych oraz w `setFontReadyHandler`).
- **Podpięte miejsca zapytań:**
  - `web/src/board/controller.ts`: gumka (`erase`), zaznaczanie kliknięciem (`startSelect`), PPM (`contextTarget`), dwuklik na tekście (`editTextAt`), ramka (`marquee`), lasso (`lasso`, po ramce pętli) — oraz docelowo `pickObject` hovera z R-112 (po zmergowaniu PR #135 zdejmie tymczasowy próg 5000 elementów).
  - `web/src/board/canvas-renderer.ts`: opcjonalne źródło zapytań przestrzennych (np. przekazane do `CanvasRenderer` lub `setSpatialQuery`) używane w `paintCommitted()` do przycinania widoku, z zachowaniem pełnej zgodności testów bez indeksu.

## Konsekwencje
- **Serwer, baza danych i protokół bez zmian** (zmiana czysto kliencka w `web/src/board/` i `web/src/board-view.tsx`).
- **Pamięć:** niewielki narzut na stercie JS (ok. 1–4 MB przy 20 tys. obiektów — do zmierzenia w `web/bench/memory.mjs`, bez wpływu na VRAM ani limit canvasa z R-077).
- **Weryfikacja obowiązkowa:**
  - Testy jednostkowe i właściwościowe (randomizowane sekwencje `add`, `addMany`, `update`, `updateMany`, `erase`, `undo`, `redo`, `applyRemote`, `setStrokes`, zmiana `z`, obiekty obrócone, obiekty duże w `largeObjects`, puste punkty, `reindexText`) potwierdzające identyczność wyników z liniowym skanem `board.strokes`.
  - Benchmark `cd web && BENCH_SIZES=5000,20000 npm run bench:memory` porównany z bazą (`web/bench/results/memory-2026-11-21-after-3-packed-points.md`): wyraźny spadek `eraser pointer move` (z ~51 ms przy 20 tys. obiektów do pojedynczych milisekund) przy braku regresji `pan, zoomed out` i kontrolowanym zużyciu pamięci.
- **Fundament pod kolejne optymalizacje R-043:** ten sam indeks otwiera drogę do ewentualnego dirty-region repaintu w przyszłości i znosi ograniczenie rozmiaru tablicy dla hovera z R-112.
