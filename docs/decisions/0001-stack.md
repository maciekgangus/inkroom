# 0001. Wybór stosu technologicznego

- Status: accepted (warunek: spike na iPadzie z Apple Pencil, krok 2 w `docs/plan-stage-0.md`)
- Data: 2026-11-09

## Kontekst
Kryteria wynikają z SPEC.md, w kolejności ważności:

1. Responsywność i brak opóźnień przy rysowaniu (N-001, N-002).
2. Pełna obsługa iPada i innych tabletów z rysikiem, w tym Safari na iPadOS (N-003, N-010, R-005).
3. Niskie zużycie CPU na serwerze, RAM nie jest ograniczeniem (N-008).
4. Gotowa biblioteka tablicy zamiast własnej, jeśli jest warta uwagi i działa.
5. Własny serwer synchronizacji możliwy do uruchomienia u siebie i zapakowania w kontener Docker (N-006, N-009, ADR 0002), konta i zapis stanu (R-001, R-007).
6. Licencja pozwalająca na użycie w prowadzeniu korepetycji.

## Rozważane opcje (stan źródeł: 2026-11-09)

| Kryterium | tldraw + sync | Excalidraw + własny sync | Własny canvas + perfect-freehand + własny sync |
| --- | --- | --- | --- |
| 1. Responsywność | ++ | ~ (nastawiony na diagramy) | ++ (pełna kontrola nad pętlą rysowania) |
| 2. iPad + rysik | + (niezmierzone) | ~ (znane problemy z palm rejection i gubieniem kresek) | ~ (całość na nas, mierzymy w spike'u) |
| 3. CPU serwera | + (Node) | + (przekaźnik) | ++ (Go, przekaźnik + log) |
| 4. Gotowa biblioteka | ++ | + | − |
| 5. Własny serwer w Dockerze | ~ (Node: tylko przykład referencyjny) | ~ (brak współpracy w pakiecie npm, `excalidraw-room` prawdopodobnie nieutrzymywany) | ++ |
| 6. Licencja | − | ++ (MIT) | ++ (MIT) |

Skala: ++ bardzo dobrze, + dobrze, ~ niepewnie, − słabo. Oceny kryteriów 1 i 2 dla gotowych bibliotek wynikają z dokumentacji i wątków, nie z pomiarów.

Ustalenia o licencjach:
- **tldraw:** SDK nie jest open source. Produkcja wymaga licencji próbnej (100 dni), komercyjnej (cena nieopublikowana, źródła trzecie wskazują ok. 6 000 USD rocznie, niepotwierdzone) albo hobbystycznej (bezpłatna, tylko niekomercyjna, uznaniowa, ze znakiem wodnym). Sync samohostowany, ale serwer Node to tylko przykład referencyjny.
- **Excalidraw:** MIT. Pakiet npm nie ma wbudowanej współpracy.
- **perfect-freehand:** MIT, obsługuje nacisk.

## Decyzja
**Własny canvas (Pointer Events + `perfect-freehand`) + własny serwer synchronizacji w Go + SQLite.** tldraw odrzucony ze względu na licencję i brak woli płacenia ani zależności od uznaniowej zgody; powrót do tldraw nie jest przewidziany.

Uzasadnienie: zakres jest wąski (pióro, gumka, kolor, grubość, cofanie per użytkownik, strony), a największe ryzyko to wrażenia na iPadzie, nad którymi własny kod daje pełną kontrolę (`getCoalescedEvents`, rozróżnianie `pointerType` pen/touch, własna pętla rysowania).

Stos:
- **Klient:** TypeScript + Vite, silnik płótna w czystym TS, panel i logowanie w Preact.
- **Serwer:** Go, jeden proces (API, WebSocket, pliki statyczne). Pokoje w pamięci, zapis jako dziennik kresek (append-only) z okresowym zagęszczaniem.
- **Baza:** SQLite (`modernc.org/sqlite`, bez CGO), plik w wolumenie, kopia przez `sqlite3 .backup`.
- **Konta:** argon2id, ciasteczko sesji. Link tablicy to 128-bitowy losowy identyfikator.
- **Protokół:** JSON po WebSocket; binarny dopiero po pomiarze.
- **Narzędzia:** `go test`, Vitest, Biome, `gofmt`/`go vet`; Playwright od Etapu 2.
- **Docker:** jeden obraz wieloetapowy i jeden serwis w `docker-compose.yml`; `cloudflared` dochodzi w Etapie 3.5 (ADR 0003).

## Konsekwencje
- Spike na iPadzie (krok 2 planu Etapu 0) sprawdza wrażenia z rysowania. Jeśli nie spełni kryteriów, poprawiamy własny canvas, nie zmieniamy biblioteki.
- Wszystkie narzędzia P2/P3 (figury, tekst, strony, obrazy, eksport: R-010 do R-015) piszemy sami. Jeśli ich koszt zacznie boleć w Etapie 5, przeglądamy tę decyzję (nowy ADR).
- Dwa języki (Go i TS) to więcej narzędzi niż samo Node; świadomy kompromis na rzecz niskiego CPU i małego obrazu.
- Sekcja "Komendy" w CLAUDE.md i hooki (format, lint, testy) powstają w Etapie 0.
