# 0027. Podświetlenie obiektu pod kursorem przy zaznaczaniu (hover)

- Status: accepted
- Data: 2026-11-26

## Kontekst
R-112: w narzędziu „Zaznacz” (`select`, R-021, R-034, R-072) użytkownik dopiero po kliknięciu widzi, który obiekt złapał. Gdy kilka elementów leży blisko siebie albo na sobie (kreski na układzie współrzędnych, napisy na stronie PDF, nakładające się kształty), łatwo ruszyć niechciany obiekt — szczególnie przy zapasie trafienia `HIT_PX = 8 px` (R-072).

Ograniczenia:
- Responsywność ponad wszystko (priorytet 1, N-012) oraz pełna obsługa iPadów i tabletów z Androidem (priorytet 2), w tym ścisłe limity pamięci GPU na słabszych tabletach Samsung (R-077, R-100).
- Według benchmarku (`web/bench/results/memory-2026-11-21-after-3-packed-points.md`) liniowe przeszukiwanie 20 tys. elementów przy `pointermove` trwa ok. 51 ms (mediana) — naiwne sprawdzanie trafienia przy każdym ruchu myszy na dużej tablicy dławiłoby wątek główny.
- Funkcja ma być czysto lokalna, bez zmian protokołu, serwera ani formatu tablicy.

## Rozważane opcje
Warstwa rysowania:
1. **Osobny trzeci `<canvas>` tylko na podświetlenia (wzorzec z IDROO).** Zmiana podświetlanego obiektu nie przemalowuje warstwy `live`, ale dokłada trzeci pełnoekranowy bufor GPU (ok. 8–16 MB VRAM na ekranach HiDPI), co stoi w sprzeczności z oszczędzaniem pamięci na tabletach (R-077, R-100).
2. **Rysowanie na istniejącej warstwie `live` (`CanvasRenderer`).** Zero dodatkowego bufora GPU. Warstwa `live` przemalowuje się wyłącznie przy zmianie identyfikatora obiektu pod kursorem (`hoveredId`), a nie przy każdym pikselu ruchu myszy. Wada: jeśli aktualnie zaznaczonych jest bardzo dużo obiektów z kosztowną poświatą `drawGlow`, zmiana hovera przemalowuje je razem z warstwą `live`.

Wygląd podświetlenia:
1. **Ta sama dwuprzejściowa poświata `shadowBlur` co zaznaczenie (R-058).** Łatwo pomylić obiekt „pod kursorem” z obiektem już zaznaczonym, a `shadowBlur` mocno obciąża GPU przy szybkim przesuwaniu kursora nad gęstym rysunkiem.
2. **Lekki obrys / subtelne podświetlenie bez wieloprzekładkowego bluru**, wizualnie wyraźnie słabsze od poświaty zaznaczenia (R-058), rysowane z istniejącego cache'u ścieżek w `CanvasRenderer` (bez przeliczania `perfect-freehand` od zera).

## Decyzja
Wybieramy **opcję 2 dla warstwy** (`live`, bez trzeciego `<canvas>`) oraz **opcję 2 dla wyglądu** (lekki, odróżnialny od zaznaczenia obrys/halo rysowany z cache'u ścieżek).

Zasady zachowania:
- **Spójność 1:1 z kliknięciem:** hover korzysta z tej samej funkcji trafienia co kliknięcie w `startSelect` (`HIT_PX = 8 px`, najwyższy obiekt po kolejności `z`, R-072), więc to, co się podświetla, jest zawsze dokładnie tym obiektem, który zostanie złapany i przesunięty.
- **Kiedy działa:** wyłącznie w narzędziu `select`, w spoczynku (nie podczas przesuwania, skalowania, obrotu, ramki, lassa, przesuwania/zoomu widoku ani w trybie `readOnly`).
- **Urządzenia wejściowe:** włączony dla myszy (`pointerType === "mouse"`) oraz zawieszonego rysika (`pointerType === "pen"` bez wciśniętego przycisku, np. Apple Pencil Hover / S Pen); całkowicie wyłączony dla dotyku (`pointerType === "touch"`, gdzie palec przesuwa widok, R-070).
- **Priorytet uchwytów i zaznaczenia:** jeśli kursor stoi nad dowolnym uchwytem aktywnego zaznaczenia (skala, obrót, wierzchołek, końce linii, uchwyt parametru), podświetlenie obiektu pod spodem znika (klik chwyci uchwyt). Obiekt już zaznaczony nie dostaje drugiego podświetlenia hovera (świeci już mocniejszą poświatą R-058).
- **Czyszczenie:** hover znika natychmiast przy `pointerleave`, zmianie narzędzia, rozpoczęciu gestu (`pointerdown`), ruchu widoku oraz gdy wskazywany obiekt zostanie usunięty lub zmieniony zdalnie.
- **Wygląd:** półprzezroczysty obrys/halo w kolorze marki (`#5b5bf0` w motywie jasnym, `#8f8fff` w motywie ciemnym, zgodnie z `DESIGN.md` oraz uchwytami z R-047 i poświatą z R-058), wyraźnie delikatniejszy od zaznaczenia; dla obrazów i układu współrzędnych cienka ramka po obwodzie (jak w R-084). Bez dwuprzejściowego `shadowBlur`.

Zabezpieczenia wydajnościowe:
- **Dławienie (throttle) ~50 ms:** sprawdzanie trafienia przy ruchu w spoczynku odbywa się nie częściej niż co ~50 ms (wystarczająco natychmiastowo dla oka, 20 Hz, jak w IDROO).
- **Bez kopiowania tablicy + szybkie odrzucenie AABB:** szukanie trafienia idzie pętlą od końca `board.strokes` (bez `[...strokes].reverse()`) i najpierw sprawdza zapamiętaną ramkę obiektu powiększoną o zasięg trafienia, zanim wywoła kosztowne `objectHit()` / `toLocal()`.
- **Brak zbędnych przemalowań:** `renderer.setHover(...)` zleca klatkę na `live` tylko wtedy, gdy zmienił się `hoveredId`.
- **Ochrona przy dużym zaznaczeniu i bardzo dużych tablicach:** hover jest pomijany, gdy aktualnie zaznaczono dużo obiektów (np. > 50 — do czasu obniżenia kosztu poświaty zaznaczenia w R-043), aby nie wyzwalać drogiego przemalowania warstwy `live`. Docelowo hit-test hovera będzie korzystać z indeksu przestrzennego z R-043 (< 1 ms przy 20 tys. obiektów); do tego czasu powyżej bezpiecznego progu liczby elementów (do wyznaczenia pomiarem) hover może się automatycznie wyłączać zamiast lagować kursor.

## Konsekwencje
- **Serwer, baza i protokół bez zmian:** stan hovera jest wyłącznie lokalny w kliencie.
- **Zero nowego VRAM:** zostajemy przy dwóch warstwach `<canvas>` (`committed` i `live`).
- **Zakres zmian w kliencie:** `web/src/board/controller.ts` (stan `hoveredId`, dławiona obsługa ruchu bez wciśniętego przycisku, wydzielona funkcja trafienia bez kopiowania tablicy, respektowanie uchwytów), `web/src/board/canvas-renderer.ts` (`setHover` na warstwie `live` z użyciem cache'u ścieżek), `web/src/board-view.tsx` (przekazanie ruchu w spoczynku i czyszczenie przy `pointerleave` oraz starcie ruchu widoku).
- **Weryfikacja implementacji:** testy jednostkowe (trafianie 1:1 z kliknięciem dla obiektów obróconych, wypełnionych kształtów, tekstu i obrazów; priorytet uchwytów; brak hovera dla dotyku, w `readOnly` i podczas edycji; brak „wiszącego” podświetlenia po `pointerleave`, ruchu widoku lub zdalnym usunięciu obiektu), testy e2e oraz zrzuty ekranu w motywie jasnym i ciemnym.
- **Zależność wydajnościowa:** docelowa wydajność na tablicach > 10 tys. elementów zależy od indeksu przestrzennego (R-043); wstępne filtrowanie AABB i dławienie ~50 ms dają bezpieczny pomost bez czekania na cały R-043.
