# Benchmark pamięci klienta (R-100)

Mierzy, gdzie idzie pamięć przeglądarki na tablicy z wieloma elementami, **osobno w czterech koszykach**
(nigdy jedna suma sterty):

| #   | Koszyk                                                    | Jak jest mierzony                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Surowe punkty kresek (`[x, y, nacisk]` w `Stroke.points`) | Ta sama migawka wczytana w pustej karcie bez aplikacji (`parsedOnly`): sterta po `JSON.parse` minus sterta przed, po dwóch wymuszonych GC. Dodatkowo „1′”: sterta aplikacji po wczytaniu (widok domowy) minus sterta pustej tablicy.                                                                                                                                                                                                                                                                                                                                                |
| 2   | Pamięci podręczne rysowania (`Path2D`, ramki w `WeakMap`) | Różnica między widokiem „oddalonym” (skala 0,1, cała tablica w widoku, wszystkie pamięci podręczne pełne) a widokiem domowym (skala 1, ok. 1,2% elementów w widoku). Część w stercie JS = różnica sterty, część natywna (`Path2D`) = różnica prywatnej pamięci anonimowej procesu renderera (`Pss_Anon` z `/proc/<pid>/smaps_rollup`) minus różnica sterty. Migawka sterty JS natywnych obiektów nie widzi, dlatego pamięć procesu.                                                                                                                                                 |
| 3   | Historia cofania i ponawiania                             | W świeżej karcie z oddalonym widokiem: kursorem zaznaczania obejmuję całą tablicę i naciskam Delete (jeden grupowy krok, R-078). Liczba skasowanych elementów jest odczytana z serwera. Oczekiwane zwolnienie = skasowane × bajty na element (z koszyka 1); to, co faktycznie spadło (sterta i pamięć natywna), porównane z tym: różnica to pamięć trzymana przez historię (`Board.record` nie ma limitu głębokości, skasowane kreski zostają w `Action.group`). Po tym jedno cofnięcie. Osobno: zamiatanie gumką po oddalonej tablicy mierzy tylko czas obsługi ruchu (trafianie). |
| 4   | Przetworzenie migawki                                     | Szczyt całkowitej sterty JS w trakcie wczytywania (próbkowany co 40 ms), rozmiar wiadomości migawki, oraz „dodatkowo trzymane po wczytaniu” = sterta aplikacji minus sterta samych sparsowanych kresek (powinno być bliskie zeru, jeśli surowy tekst nie jest trzymany), a obok sterta samego ciągu JSON.                                                                                                                                                                                                                                                                           |

Dodatkowo (linia bazowa przed zmianami z kroku 2): czasy klatek przy przesuwaniu ręką (120 kroków, różnice
między `requestAnimationFrame`) w widoku domowym i oddalonym oraz czas obsługi ruchu gumki (trafianie).

## Uruchomienie

```sh
cd web && npm ci            # raz
npm run bench:memory        # domyślnie tablice 5000, 20000 i 50000 elementów
BENCH_SIZES=2000 npm run bench:memory   # szybka próba
```

Skrypt sam buduje klienta i serwer (`server/cmd/server`) oraz narzędzie zasiewające
(`server/cmd/benchseed`, tylko deweloperskie, nie ma go w obrazie), startuje serwer z tymczasową bazą
na porcie `BENCH_PORT` (domyślnie 8198), zakłada tablice przez prawdziwy `store.Apply` (tę samą drogę, którą
zapisuje hub), otwiera każdą w osobnej, świeżej instancji Chromium (okno 1600×900, dpr 1) i sprząta po sobie.
Wynik: tabela w konsoli oraz `bench/results/memory-<data>.{md,json}`.

Tablica zasiewana jest deterministycznie (`-seed 1`): ok. 93% to odręczne kreski piórem naturalnym po 100 do 300
punktów z naciskiem (współrzędne z dwoma miejscami po przecinku, nacisk z trzema), reszta to linie, prostokąty,
elipsy i teksty, rozrzucone po obszarze 15000×8000 jednostek, który mieści się w oknie 1600×900 przy
najmniejszym zbliżeniu (0,1).

## Jak czytać wyniki i czego nie przeceniać

- Bajty na element są liczone po dwóch wymuszonych GC, więc to pamięć trzymana, nie szczyt (szczyt jest osobno).
- Chromium działa tu bez GPU (renderowanie programowe), więc czasy klatek są wyższe niż na tablecie z GPU,
  ale służą do **porównań przed i po**, nie jako bezwzględna liczba. To samo dotyczy pamięci bitmapy warstwy:
  jest w obu porównywanych widokach taka sama i się skraca.
- Pamięć anonimowa renderera obejmuje też obiekty natywne poza `Path2D` (np. bitmapę warstwy), dlatego liczy się
  tylko różnica między widokami o tym samym rozmiarze okna.
- Karty w tle nie wykonują `requestAnimationFrame`; skrypt używa jednej karty na przeglądarkę, widocznej.
- Liczby z `results/` to linia bazowa z dnia wpisanego w nazwie pliku: po zmianach z kroku 2 uruchom skrypt
  ponownie i porównaj.

## Historia cofania i „jeden krok więcej” (R-008, R-100)

Koszyk 3 ma od kroku 2b dodatkową kolumnę „heap after one more step”: po skasowaniu wszystkiego, cofnięciu i
ponowieniu (Ctrl+Shift+Z) rysowany jest jeden krótki ślad piórem. Najnowszy krok historii jest zawsze zachowany,
więc zaraz po „usuń wszystko” sterta nie spada (można jeszcze cofnąć); dopiero następny krok powoduje
odrzucenie tego dużego i zwolnienie skasowanych kresek. Zmienna `BENCH_DEVMEM=4` ustawia `navigator.deviceMemory`
(budżet historii zależy od niej: 600 tys. punktów przy 4 GB, 1,5 mln przy 8 GB lub więcej).
Wyniki po zmianie: `bench/results/memory-2026-11-21-undo-cap.md`.
