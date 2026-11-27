# 0033. Porcjowana migawka tablicy po WebSocket

- Status: accepted
- Data: 2026-11-27

## Kontekst
R-120 (uzupełnienie R-100, R-077, R-043 oraz rozszerzenie protokołu z ADR 0004): po spakowaniu punktów w `Float32Array` (R-100) pamięć robocza tablicy z 20 tys. elementów to zaledwie **16,4 MB** na stercie JS (`web/bench/results/memory-2026-11-21-after-3-packed-points.md`), ale samo wczytanie początkowej migawki po WebSocket pozostaje największym zagrożeniem OOM na tabletach z 4 GB RAM:
- Serwer wysyła jedną wiadomość `{"t":"snapshot","strokes":[...],"background":"..."}` o rozmiarze **86,4 MB** (20 tys. elementów) lub ponad **220 MB** (50 tys. elementów).
- W przeglądarce surowy string z WebSocketu zajmuje **~180 MB** poza stertą JS (UTF-16), a jednoczesny `JSON.parse` całej tablicy przed spakowaniem do `Float32Array` wybija stertę JS do **253 MB** (łącznie ~430 MB piku na starcie tablicy).
- Po stronie serwera Go `Room.snapshotLocked()` serializuje cały wielomegowy JSON pod blokadą `r.mu`, wstrzymując na ten czas obsługę pozostałych uczestników pokoju i alokując dziesiątki/setki MB naraz.

Ograniczenia:
- Zgodność wsteczna w obie strony podczas wdrożenia: otwarte karty starszej wersji klienta (przed kliknięciem banera R-099) muszą dalej normalnie działać.
- Bufor wychodzący klienta na serwerze ma stały rozmiar (`sendBuffer = 256` w `server/cmd/server/ws.go`): duża tablica o setkach porcji nie może przepełniać tego bufora i zrywać połączenia przy wejściu.
- Ścisła kolejność FIFO: migawka musi dotrzeć w całości przed `peers` i późniejszymi operacjami `add`/`update`/`remove`, a przerwanie połączenia w połowie strumienia nie może zostawiać niespójnego stanu.
- Zero zmian w bazie SQLite, formacie elementu i bez nowych zewnętrznych zależności.

## Rozważane opcje
1. **Format binarny po WebSocket (MessagePack / Protobuf / własny koder).** Zmniejsza rozmiar transmisji, ale wprowadza drugi format po obu stronach (Go i TypeScript), utrudnia debugowanie oraz współpracę z osią zdarzeń (R-113), a bez porcjowania i tak nie usuwa piku alokacji przy dekodowaniu całej tablicy naraz.
2. **Osobny endpoint HTTP z paginacją migawki.** Wymagałby numeracji sekwencyjnej i złożonego godzenia stanu pobranego przez HTTP ze zdarzeniami napływającymi równolegle po WebSocket.
3. **Porcjowana migawka JSON po tym samym WebSocket (`snapshot_start` → N × `snapshot_chunk` → `snapshot_end`), negocjowana parametrem `?chunks=1`.** Jedno połączenie, prosty JSON, pełna zgodność wsteczna i natychmiastowe pakowanie `Float32Array` po każdej małej porcji.

## Decyzja
Wybieramy **opcję 3**.

### Negocjacja i zgodność wsteczna
- Nowy klient otwiera WebSocket z parametrem zapytania `&chunks=1` (`web/src/app.tsx`).
- Bez parametru `chunks=1` (stare karty, starsze testy Go, pomiar bazowy `parsedOnly` w `web/bench/memory.mjs`) serwer wysyła dotychczasową pojedynczą ramkę `{"t":"snapshot","strokes":[...],"background":"..."}`.
- Nowy klient nadal obsługuje zarówno nowy strumień (`snapshot_start`/`snapshot_chunk`/`snapshot_end`), jak i starszą pojedynczą ramkę `snapshot`.

### Protokół (rozszerzenie ADR 0004)
Dla klienta z `chunks=1` każda migawka (przy `Join` oraz przy cofnięciu niedozwolonej edycji w `Handle`) składa się kolejno z:
1. `{"t":"snapshot_start","background":"...","total":N}` — otwiera nową migawkę; `total` to liczba elementów w migawce (`0` dla pustej tablicy — wtedy nie idzie żaden `snapshot_chunk`).
2. `0..K` ramek `{"t":"snapshot_chunk","strokes":[...]}` — kolejne elementy w porządku `seq`, dzielone na porcje z **podwójnym limitem**: co najwyżej **`500` elementów** oraz co najwyżej **`512 KiB`** surowego JSON-a na porcję. Pojedynczy element większy niż `512 KiB` trafia sam do jednej porcji (nigdy nie blokuje wysyłki).
3. `{"t":"snapshot_end"}` — zamyka migawkę i pozwala klientowi zatwierdzić całość.

### Serwer Go (`server/internal/room/`, `server/cmd/server/ws.go`, `server/internal/metrics/`)
- **Brak serializacji pod `r.mu` i brak przepełnienia `sendBuffer`:** pod mutexem `r.mu` serwer tworzy wyłącznie lekki obiekt `*Snapshot` (tło + płytka kopia uporządkowanego wycinka `[]json.RawMessage`, wskazującego na niezmienne `entry.raw` — bez `json.Marshal` i bez kopiowania bajtów) i umieszcza go jako **jeden wpis** w kolejce wychodzącej klienta. Nawet tablica z 100 tys. elementów zajmuje tylko 1 z 256 miejsc w buforze.
- **Leniwe porcjowanie w jednej goroutine zapisującej:** `ws-writer` w `ws.go` korzysta z wąskiego, głębokiego interfejsu klienta (`room.Client`, zgodnie z `codebase-design`), który przekazuje kolejno gotowe ramki `[]byte` w ścisłej kolejności FIFO: dla `*Snapshot` poza mutexem `r.mu` generuje i oddaje po jednej porcji naraz (z ponownym użyciem bufora ~512 KiB i osobnym `writeTimeout = 10 s` na każdą ramkę). Dzięki jednej kolejce `snapshot_start` → porcje → `snapshot_end` zawsze wyjdą przed `peers` oraz przed późniejszymi `add`/`update`/`remove`.
- **Metryki:** `"snapshot_start"`, `"snapshot_chunk"` i `"snapshot_end"` są dodane do znanych typów w `server/internal/metrics/inkroom.go` (`inkroom_ws_messages_total`).

### Klient TypeScript (`web/src/sync/sync.ts`, `web/src/app.tsx`)
- `snapshot_start` inicjuje (albo resetuje, jeśli poprzednia migawka nie została domknięta) stan tymczasowy: `snapshotBuf: Stroke[]`, `snapshotBg`, `snapshotOps: BoardOp[]`.
- `snapshot_chunk` parsuje porcję (≤ 512 KiB), **natychmiast wywołuje `packStroke(s)`** (`web/src/board/points.ts`, R-100) dla każdego elementu z porcji, żeby od razu zwolnić surowe tablice punktów dla GC, i dokłada spakowane elementy do `snapshotBuf` bez przemalowywania płótna w trakcie.
- Operacje `add`, `update`, `remove` odebrane między `snapshot_start` a `snapshot_end` są buforowane w `snapshotOps` i nakładane zaraz po `board.setStrokes(snapshotBuf)` (dodatkowa ochrona przed wyścigiem).
- `snapshot_end` woła wspólną ścieżkę kończącą `finishSnapshot` (tę samą co stary `case "snapshot"`): przekazuje `onBackground`, wywołuje raz `board.setStrokes(snapshotBuf)` (jednokrotne zbudowanie indeksu przestrzennego R-118 i jednokrotne malowanie tablicy — bez migotania pół-załadowanego stanu), nakłada `snapshotOps`, wznawia `follow`, nakłada i ponawia niepotwierdzone lokalne `pending` oraz raz woła `onUpdate()`.
- Zerwanie połączenia (`dropped()`) natychmiast czyści `snapshotBuf`, `snapshotOps` i `snapshotBg`, więc ponowne połączenie zawsze zaczyna od czystego stanu.

### Benchmark (`web/bench/memory.mjs`)
- Pomiar `snapshotBytes` sumuje bajty wszystkich ramek migawki (`snapshot`, `snapshot_start`, `snapshot_chunk`, `snapshot_end`) zamiast brać maksimum z jednej ramki. Funkcja `parsedOnly` nadal łączy się bez `?chunks=1`, zachowując ten sam punkt odniesienia dla surowego JSON-a.

## Konsekwencje
- Zmiany obejmują serwer Go (`server/internal/room/`, `server/internal/metrics/`, `server/cmd/server/ws.go`) oraz klienta (`web/src/sync/sync.ts`, `web/src/app.tsx`, `web/bench/memory.mjs`); baza SQLite i format zapisanych tablic bez zmian.
- Pik pamięci przy otwieraniu dużej tablicy (20 tys. elementów) spada z ~253 MB sterty JS + ~180 MB surowego stringa do poziomu bliskiego pamięci roboczej po spakowaniu (kilkadziesiąt MB), istotnie obniżając ryzyko OOM na tabletach Android 4 GB i iPadach.
- Po stronie serwera znika wielomegabajtowa alokacja i długie trzymanie blokady `r.mu` podczas dołączania nowych uczestników.
- Obowiązkowa weryfikacja obejmuje testy wyścigowe Go (`go test -race ./...`), testy jednostkowe klienta (`sync.test.ts`), testy e2e oraz ponowny bieg benchmarku `web/bench/memory.mjs` (5 tys. i 20 tys. elementów) porównany z dotychczasową bazą.
