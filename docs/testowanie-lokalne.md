# Testowanie lokalne z logami

Od teraz każdy test funkcji idzie razem z logami: aplikacja działa jako zwykły proces, a obok niej w
kontenerach działa **kopia stosu z serwera** (Loki, Alloy, Prometheus, Grafana) z tymi samymi plikami
konfiguracyjnymi, dashboardem i regułami alertów (`deploy/observability`, ADR 0022 i 0023). Zamiast
Telegrama alerty trafiają do **atrapy**, która zapisuje je do pliku, więc nic nie wymaga bota ani
sekretów. Skrypt i skill: `.claude/skills/test-server/`.

Wymagania: działający Docker (albo rootless Podman), dostęp do internetu przy pierwszym starcie
(pobranie obrazów, ok. 1 GB). Adresy poniżej dotyczą portu 8099; dla innego portu są przesunięte o
różnicę względem 8099 (np. port 8100 to Grafana 3101).

## 1. Start

```sh
sh .claude/skills/test-server/server.sh start 8099 --logs        # serwer + stos
FRESH=1 sh .claude/skills/test-server/server.sh start 8099 --logs   # od pustej bazy i pustego stosu
sh .claude/skills/test-server/server.sh status 8099
```

| Co | Adres |
|---|---|
| Aplikacja | http://localhost:8099 (konto `test@example.test` / `test-user-1234`, albo samo `test`) |
| Grafana (dashboard „Inkroom” jest stroną główną) | http://127.0.0.1:3100, `admin` / `local-test` |
| Prometheus | http://127.0.0.1:9190 |
| Atrapa Telegrama | http://127.0.0.1:9199 (ostatnie 20 wiadomości) i plik `~/.cache/inkroom-test-server-8099/sink/received.jsonl` |
| Metryki aplikacji | http://127.0.0.1:9099/metrics |
| Log aplikacji (plik) | `~/.cache/inkroom-test-server-8099/log` (jedna linia JSON na zdarzenie) |

Sprawdzenie, że wszystko działa: w Prometheusie (Status, Targets) cele `app`, `loki`, `alloy`, `grafana`
i `prometheus` mają stan UP; w Grafanie dashboard pokazuje „Aplikacja działa: 1”.

## 2. Co kliknąć w aplikacji, żeby powstał dany rodzaj logu

| Rodzaj | Co zrobić | Jak wygląda w logu |
|---|---|---|
| zwykłe żądanie (DEBUG, domyślnie niewidoczne) | wejdź na panel tablic, otwórz tablicę | brak linii przy poziomie INFO; metryki rosną |
| 4xx (WARN) | wpisz złe hasło na `/login`; wejdź na `/b/nie-ma-takiej` | `msg:"request"`, `level:"WARN"`, `status:401` albo `404`, `path` jako wzorzec (`/api/boards/{id}`) |
| wolne żądanie (WARN) | żądanie powyżej 1 s (np. duży PDF, import) | `"slow":true` |
| błąd przeglądarki (WARN) | w konsoli strony: `setTimeout(() => { throw new Error("test") }, 10)` oraz `Promise.reject(new Error("test"))` | `service:"client"`, `msg:"client error"`, `page:"/b/:id"` (identyfikator tablicy jest zamaskowany) |
| ERROR | wpisz do logu ręcznie (patrz sekcja 6); prawdziwy ERROR daje np. błąd zapisu bazy | `level:"ERROR"` |
| panic (ERROR) | tylko w testach Go (`go test ./...`); lokalnie nie ma bezpiecznego sposobu | `msg:"panic"`, `stack` |

Każdy wiersz powinien pojawić się w Grafanie po kilku sekundach (Alloy czyta plik na bieżąco).

## 3. Jak oglądać logi w Grafanie

Menu, Explore, źródło **Loki**, tryb Code. Zapytania (LogQL):

| Cel | Zapytanie |
|---|---|
| wszystko z aplikacji | `{service="app"} \| json` |
| tylko błędy | `{service="app",level="ERROR"}` |
| błędy i ostrzeżenia ze wszystkich usług | `{level=~"WARN\|ERROR"}` |
| błędy z przeglądarek | `{service="client"} \| json` |
| jedno żądanie po ID (z nagłówka `X-Request-Id` odpowiedzi) | `{service="app"} \| json \| request_id="abc123"` |
| wolne lub błędne żądania | `{service="app"} \| json \| msg="request" \| status>=500 or slow="true"` |
| żądania danej trasy | `{service="app"} \| json \| path="/api/boards/{id}"` |
| liczba błędów na minutę | `sum by (service) (count_over_time({level="ERROR"}[1m]))` |

Etykiety (`service`, `level`, `container`) są tylko trzy, a reszta (`path`, `status`, `request_id`) jest
w linii i czytana przez `| json`, więc indeks zostaje mały. Identyfikator żądania widzisz w
nagłówku odpowiedzi (`X-Request-Id`) w narzędziach przeglądarki, zakładka Sieć.

## 4. Dashboard „Inkroom”: co sprawdzić

Z góry: kafelki „ERROR w logach”, „Panic”, „Odpowiedzi 5xx”, „Połączenia WebSocket”, „Aktywne tablice”,
„Aplikacja działa”; potem sekcja „Błędy i logi” (wykresy błędów i woluminu, ostatnie ERROR i WARN,
błędy przeglądarek), „Ruch” (żądania na sekundę i p95 wg ścieżki, 5xx, WebSocket), „Aplikacja”
(pamięć i goroutines Go, panic i błędy przeglądarek). Po wejściu na tablicę i narysowaniu kreski
„Połączenia WebSocket” i „Aktywne tablice” pokazują 1, a „Wiadomości WebSocket na sekundę” rosną.

Panele, które **lokalnie są puste i to jest poprawne**: „Odpowiedzi 5xx” (dopóki nie ma 5xx) oraz
procesor, pamięć i dysk serwera i pamięć oraz starty kontenerów (te metryki zbiera Alloy z
Dockera na VM; lokalnie aplikacja nie jest kontenerem). Na VM mają być wypełnione.

## 5. Alerty i atrapa Telegrama

W Grafanie: Alerting, Alert rules (folder „Inkroom”): siedem reguł (błędy w logach, 5xx, panic,
aplikacja nie odpowiada, restart kontenera, dysk, wysyp błędów przeglądarek). Kontakt: „telegram”
(webhook do `/bot<token>/sendMessage`, tu wskazujący na atrapę).

- **Test samej drogi wysyłki:** Alerting, Contact points, „telegram”, przycisk „Test”. W atrapie
  (http://127.0.0.1:9199) pojawia się wiadomość z `chat_id` jako **tekstem** (`"123456789"`).
- **Prawdziwa reguła:** sekcja 6. Wiadomość ma postać `🔥 ALERT: <nazwa>` i opis. Alert, który
  wraca do normy, wysyła `✅ OK` (po kilku minutach, bo interwał grupy to 5 minut).
- **Podgląd:** `tail -f ~/.cache/inkroom-test-server-8099/sink/received.jsonl` albo
  `curl -s http://127.0.0.1:9199`.
- **Czas reakcji (zmierzony lokalnie):** błąd ERROR w logu daje wiadomość po około minucie
  (ewaluacja co minutę plus 30 s oczekiwania na grupowanie), a „Aplikacja nie odpowiada” po około
  3 minutach (2 minuty `for` plus ewaluacja).

## 6. Jak wywołać awarie i sprawdzić alerty

1. **ERROR w logach** (reguła „Błędy w logach”): dopisz linię do logu aplikacji
   ```sh
   echo '{"time":"'$(date -Iseconds)'","level":"ERROR","msg":"test alertu","service":"app","request_id":"test"}' >> ~/.cache/inkroom-test-server-8099/log
   ```
   Po około minucie w atrapie jest alert „Błędy w logach”, a na dashboardzie kafelek „ERROR w logach” ma 1.
2. **Aplikacja nie odpowiada:** `kill -9 $(cat ~/.cache/inkroom-test-server-8099/pid)`. Po około 3 minutach
   alert „Aplikacja nie odpowiada”. Lokalnie nic nie restartuje procesu (na VM Docker restartuje
   kontener); uruchom ponownie `server.sh start 8099 --logs`, a po kilku minutach przyjdzie
   `✅ OK`.
3. **Spokojne zatrzymanie:** `kill $(cat ~/.cache/inkroom-test-server-8099/pid)` (albo `server.sh stop`
   bez zatrzymywania stosu: `logs stop` zatrzymuje stos, `stop` oba) kończy proces bez wpisu w logu,
   a po 2 minutach przychodzi ten sam alert „Aplikacja nie odpowiada”.
4. **5xx:** żądania z błędem serwera da się wywołać tylko prawdziwą usterką (np. brak miejsca na
   dysku danych); lokalnie sprawdzaj regułę testami Go i zapytaniem w Prometheusie
   `sum(rate(inkroom_http_requests_total{status=~"5.."}[5m]))`.
5. **Wysyp błędów przeglądarek:** ponad 20 w 10 minut, np. pętla w konsoli
   `for (let i=0;i<30;i++) setTimeout(()=>{throw new Error("x"+i)},i*50)` (uwaga: serwer ogranicza
   liczbę zgłoszeń na osobę do 20 na godzinę, więc wystarczy wtedy zalogować się na dwa konta albo
   sprawdzić regułę zapytaniem w Prometheusie `sum(increase(inkroom_client_errors_total[10m]))`).
6. **Restart kontenera, dysk:** te metryki lokalnie nie istnieją (reguły mają `noData = OK`);
   sprawdzasz je dopiero na VM.

## 7. Zatrzymanie i sprzątanie

```sh
sh .claude/skills/test-server/server.sh stop 8099         # serwer i stos (kasuje wolumeny stosu)
sh .claude/skills/test-server/server.sh logs stop 8099    # tylko stos
docker ps --filter name=inkroom-logs                      # nic nie powinno zostać
rm -rf ~/.cache/inkroom-test-server-8099                  # baza testowa, log i atrapa (opcjonalnie)
```

Konflikt portów: skrypt używa 3100 (Grafana), 9190 (Prometheus), 9199 (atrapa) i 9099 (metryki), dla
portu 8099. Gdy któryś jest zajęty, uruchom na innym porcie aplikacji (przesuwa je wszystkie).

## 8. Co porównać po wdrożeniu na VM

Na VM stos działa w profilu `observability` (`deploy/README.md`, sekcja 11), a różnice wobec testu
lokalnego to:

| Lokalnie | Na VM |
|---|---|
| aplikacja jako proces, Alloy czyta plik logu | aplikacja jako kontener, Alloy czyta logi przez gniazdo Dockera, etykiety `container`, `compose_project` z Docker Compose |
| Prometheus pobiera metryki z `host.docker.internal:9099` | z `app:9100` w sieci Dockera |
| atrapa zamiast Telegrama | prawdziwy bot, wiadomość z tą samą treścią i `chat_id` jako tekstem |
| brak metryk hosta i kontenerów (panele puste) | procesor, pamięć, dysk i starty kontenerów wypełnione |
| Grafana na `127.0.0.1:3100` bez Cloudflare Access | Grafana za Cloudflare Access pod `logs.<domena>` (tunel) |
| hasło `local-test` | `GF_SECURITY_ADMIN_PASSWORD` z `.env` |
| log z nowego startu zaczyna się od zera | log kontenera rotowany przez Dockera (10 MB x 5), Loki trzyma 30 dni |

Lista do odhaczenia po wdrożeniu: (1) dashboard ma dane we wszystkich panelach, (2) `{service="app"}`
w Explore zwraca logi, (3) „Test” kontaktu daje wiadomość w Telegramie, (4) `up{job="app"}` równe 1,
(5) wejście na `logs.<domena>` bez zalogowania w Cloudflare Access jest zablokowane, (6)
`docker stats` pokazuje, że stos mieści się w ok. 1,5 GB, (7) po wywołaniu błędu przeglądarki
(sekcja 2) pojawia się wpis `service="client"`.
