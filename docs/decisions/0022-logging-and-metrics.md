# 0022. Logi i metryki: slog JSON, osobny `/metrics`, błędy z przeglądarek

- Status: accepted
- Data: 2026-11-19

## Kontekst
Wymaganie R-098. Aplikacja miała 11 wywołań `log.Printf` (tekst bez struktury i poziomów), nie łapała panic w goroutinach WebSocketu i pętli zapisu (taka panic zabija cały proces), logi Dockera nie miały rotacji (domyślny sterownik `json-file` rośnie bez końca, więc kiedyś zapcha dysk, zwłaszcza po dodaniu nagrywania, R-094), a o błędach w przeglądarkach uczniów nie wiedzieliśmy nic (np. awaria „Podczas wyświetlania strony wystąpił błąd” na tablecie). Dojdą kolejne usługi (nagrywanie lekcji), więc potrzebna jest jedna konwencja, którą zbiera jeden stos (Etap 2, ADR 0023). Zasoby homelabu pozwalają (100 GB dysku, 8 GB RAM, procesor prawie nieużywany; priorytet „mało CPU” zniknął z `SPEC.md`), ale priorytet 1 (responsywność) zostaje: gorące ścieżki WebSocketu nie mogą zwolnić.

## Rozważane opcje
1. **Zostać przy `log` i `docker compose logs`:** zero pracy, ale bez poziomów, pól i możliwości filtrowania po usłudze; nie da się zbierać z kilku usług.
2. **`log/slog` (standardowa biblioteka) z JSON na stdout:** bez nowych zależności, jedna linia to jeden rekord, każdy zbieracz (Alloy, Vector, Promtail, Docker) czyta stdout kontenera. Wybrane.
3. **Zewnętrzna biblioteka logów (zap, zerolog):** szybsze, ale logi nie są na gorącej ścieżce, a slog wystarcza; zależność bez zysku.
4. **Sentry w kliencie do błędów JS:** dużo gotowych funkcji, ale dodaje kilkadziesiąt KB do paczki (priorytet 1) i wysyła dane na zewnątrz (polityka prywatności). Odrzucone na rzecz własnego małego skryptu.
5. **`prometheus/client_golang`:** standard, ale ciągnie ok. dziesięciu zależności (protobuf i inne) do `go.mod` i alokuje przy etykietach na gorącej ścieżce. Format tekstowy Prometheusa jest prosty, więc napisano własną, małą implementację (`server/internal/metrics`) z licznikami atomowymi, bez blokad i alokacji dla wiadomości WebSocketu.

## Decyzja
**Kontrakt logów** (dla każdej usługi, tego trzyma się Etap 2):
- Jeden rekord JSON na linię, na stdout. Pola: `time` (RFC 3339), `level` (`DEBUG`, `INFO`, `WARN`, `ERROR`), `msg`, `service` (`app`, `client`, później np. `recorder`).
- Żądania HTTP (`msg":"request"`): `request_id`, `method`, `path` (**wzorzec trasy**, np. `/api/boards/{id}`, nigdy surowy adres), `status`, `duration_ms`, `bytes`, a dla wolnych żądań `"slow":true`.
- Poziomy: 5xx `ERROR`; 4xx i żądania wolniejsze niż 1 s `WARN` (poza szumem: 401 na `/api/me`, 404 plików statycznych; sesje WebSocket nie są „wolne”); reszta `DEBUG`. Panic: `ERROR`, `msg":"panic"`, pola `panic`, `stack`, `where` albo `method` i `path`.
- Błędy z przeglądarek: `service":"client"`, `level":"WARN"`, `msg":"client error"`, pola `message`, `source`, `line`, `col`, `stack`, `page`, `screen`, `release`, `ua`, `user`.
- `LOG_LEVEL` (domyślnie `info`), `LOG_FORMAT=text` do pracy lokalnej.
- **Czego nigdy nie logujemy:** treści żądań i odpowiedzi, ciasteczek, nagłówków autoryzacji, adresów e-mail, nazw użytkowników, **adresów IP** (polityka prywatności mówi, że serwer ich nie zapisuje), identyfikatorów tablic (to sekret linku; zamiast tego `board` z krótkim skrótem `logx.Ref`) ani parametrów adresu. Konto to `u:<numer>`, gość `guest`.
- Wspólny pakiet `server/internal/logx` (konfiguracja, identyfikator żądania z `X-Request-Id` albo `Cf-Ray`, middleware, `Recover`, `Panic`, `Ref`); kolejne usługi Go go importują.

**Przechwytywanie panic:** middleware HTTP (z przekazaniem `http.ErrAbortHandler`), goroutina zapisu WebSocketu, pętla okresowego zapisu tablic oraz sam zapis (`Hub.apply`): panic w zapisie jest zamieniana na błąd, więc paczka zmian wraca do kolejki i jest ponawiana zamiast zginąć razem z panic. Licznik `inkroom_panics_total`.

**Metryki:** `/metrics` (format Prometheus 0.0.4) na **osobnym porcie** `METRICS_ADDR` (domyślnie `:9100`, pusty wyłącza). Port nie jest publikowany w `docker-compose.yml` ani kierowany tunelem, więc jest dostępny tylko w sieci Dockera i na maszynie. Nazwy (część kontraktu): `inkroom_http_requests_total{route,method,status}`, `inkroom_http_request_duration_seconds{route}` (histogram; bez sesji WebSocket), `inkroom_ws_connections`, `inkroom_rooms_active`, `inkroom_ws_messages_total{type,direction}` (typ odczytywany bez parsowania JSON z pierwszych lub ostatnich bajtów, nieznane to `other`, więc klient nie zwiększy liczby serii), `inkroom_panics_total`, `inkroom_client_errors_total`, oraz `go_*` i `process_*` (goroutiny, pamięć, GC, CPU, otwarte pliki).

**Błędy przeglądarek:** `POST /api/client-error`, tylko JSON, do 4 KB, limit 20 na godzinę na konto i 60 na adres (limity w pamięci, ograniczona liczba kluczy), jedna linia logu, bez zapisu w bazie. Adres strony jest redukowany do ścieżki z ukrytym identyfikatorem tablicy (`/b/:id`), adres skryptu do ścieżki. Klient (`web/src/error-report.ts`) nie ma zależności, zgłasza ten sam błąd raz na sesję i najwyżej 10 różnych, pomija szum przeglądarek (`ResizeObserver`, `Script error.`), wysyła przez `sendBeacon` z zapasowym `fetch` z `keepalive` i nigdy nie rzuca.

**Rotacja logów Dockera:** `json-file`, `max-size: 10m`, `max-file: 5` dla każdej usługi w `deploy/docker-compose.yml`.

## Konsekwencje
- Etap 2 (ADR 0023) zbiera stdout kontenerów i `/metrics` bez zmian w aplikacji; kontrakt wyżej jest jego umową, więc nazw pól i metryk się nie zmienia bez nowego ADR.
- Zgłoszenia z przeglądarki mogą zgubić się przy zerwanym połączeniu albo pożarze błędów (limit); to wystarcza do wykrywania trendów, nie do pełnego śledzenia sesji.
- Awarie, po których strona w ogóle nie działa (zabicie karty z braku pamięci), nie zostawiają zgłoszenia, bo JavaScript nie ma szansy ich złapać; widać je tylko pośrednio (nagły koniec połączenia WebSocket, ostatnie zdarzenia przed nim).
- `process_*` i `go_*` czytają `runtime.ReadMemStats` przy każdym zapytaniu (krótka pauza), co przy skrobaniu co kilkanaście sekund jest bez znaczenia.
- Własna implementacja metryk wymaga utrzymania; zakres jest mały (licznik, miernik, histogram, etykiety). Jeśli zajdzie potrzeba czegoś więcej (summary, exemplary), można przejść na `client_golang` bez zmiany nazw.
- Polityka prywatności opisuje dziennik działania i jego retencję (do 30 dni).
