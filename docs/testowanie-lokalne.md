# Testowanie lokalne z logami

Od teraz każdy test funkcji idzie razem z logami: aplikacja działa jako zwykły proces, a obok niej w
kontenerach działa **kopia stosu z serwera** (Loki, Alloy, Prometheus, Grafana) z tymi samymi plikami
konfiguracyjnymi, dashboardem i regułami alertów (`deploy/observability`, ADR 0022 i 0023). Alloy
działa na **nieprzerobionym pliku produkcyjnym** `deploy/agent/config.alloy`, z tymi samymi
montowaniami (gniazdo Dockera, `/`, `/sys`, `/var/lib/docker`) co na VM, więc zbiera też metryki hosta i
kontenerów. Lokalnie dochodzi do niego tylko jeden dodatkowy plik, który czyta log aplikacji (bo
aplikacja nie jest tu kontenerem). Zamiast
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

Maszyna z repozytorium to VM w sieci domowej (`192.168.0.51`), a testuje się z innego komputera
albo iPada. Dlatego aplikacja, Grafana i atrapa Telegrama słuchają na wszystkich interfejsach i
podaje się adres LAN; Loki, Prometheus i metryki aplikacji zostają na `127.0.0.1` (pyta je tylko
`curl` na tej maszynie). Serwer stawiany ręcznie poza skryptem też dostaje `BIND_ADDR=0.0.0.0:<port>`,
bo z kontem testowym bez `BIND_ADDR` odmawia startu, a `127.0.0.1` jest z LAN nieosiągalne.

| Co | Adres |
|---|---|
| Aplikacja | http://192.168.0.51:8099 (konto `test@example.test` / `test-user-1234`, albo samo `test`) |
| Grafana (dashboard „Inkroom” jest stroną główną) | http://192.168.0.51:3100, `admin` / `local-test` |
| Prometheus | http://127.0.0.1:9190 |
| Loki (API, do `curl`) | http://127.0.0.1:3200 |
| Atrapa Telegrama | http://192.168.0.51:9199 (ostatnie 20 wiadomości) i plik `~/.cache/inkroom-test-server-8099/sink/received.jsonl` |
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

Do skryptów i sprawdzeń pytaj Lokiego wprost (`curl -G http://127.0.0.1:3200/loki/api/v1/query_range --data-urlencode 'query={level="ERROR"}'`), a nie przez proxy źródła danych w Grafanie: jej własne błędy uprawnień dla tych zapytań trafiają do logów jako ERROR (`service="grafana"`).

Etykiety (`service`, `level`, `container`) są tylko trzy, a reszta (`path`, `status`, `request_id`) jest
w linii i czytana przez `| json`, więc indeks zostaje mały. Identyfikator żądania widzisz w
nagłówku odpowiedzi (`X-Request-Id`) w narzędziach przeglądarki, zakładka Sieć.

## 4. Dashboard „Inkroom”: co sprawdzić

Z góry: kafelki „ERROR w logach”, „Panic”, „Odpowiedzi 5xx”, „Połączenia WebSocket”, „Aktywne tablice”,
„Aplikacja działa”; potem sekcja „Błędy i logi” (wykresy błędów i woluminu, ostatnie ERROR i WARN,
błędy przeglądarek), „Ruch” (żądania na sekundę i p95 wg ścieżki, 5xx, WebSocket), „Aplikacja”
(pamięć i goroutines Go, panic i błędy przeglądarek). Po wejściu na tablicę i narysowaniu kreski
„Połączenia WebSocket” i „Aktywne tablice” pokazują 1, a „Wiadomości WebSocket na sekundę” rosną.

Panele „Procesor serwera”, „Pamięć serwera”, „Zajętość dysku”, „Pamięć kontenerów” i „Starty
kontenerów” mają dane także lokalnie (metryki hosta z `prometheus.exporter.unix`, kontenerów z
`prometheus.exporter.cadvisor`, oba z produkcyjnej konfiguracji Alloy). Uwaga: cAdvisor widzi
**wszystkie** kontenery Dockera na maszynie, więc lokalnie na wykresach są też obce kontenery z
Twojego komputera (na VM będą tylko te z projektu). Panele, które **lokalnie są puste i to jest
poprawne**: „Odpowiedzi 5xx” i „Odpowiedzi 5xx na sekundę” (dopóki nie ma 5xx) oraz panel błędów
przeglądarek, jeśli w oknie czasu nie było błędu klienta.

## 5. Alerty i atrapa Telegrama

W Grafanie: Alerting, Alert rules (folder „Inkroom”): siedem reguł (błędy w logach, 5xx, panic,
aplikacja nie odpowiada, restart kontenera, dysk, wysyp błędów przeglądarek). Kontakt: „telegram”
(webhook do `/bot<token>/sendMessage`, tu wskazujący na atrapę).

- **Test samej drogi wysyłki:** Alerting, Contact points, „telegram”, przycisk „Test”. W atrapie
  (http://127.0.0.1:9199) pojawia się wiadomość z `chat_id` jako **tekstem** (`"123456789"`).
- **Które ERROR-y wysyłają alert:** reguła „Błędy w logach” liczy ERROR-y wszystkich usług **poza kontenerami samego stosu** (`loki`, `alloy`, `prometheus`, `grafana`): przy każdym starcie Loki zapisuje jeden niegroźny ERROR (`error getting ingester clients`), więc nie ma wiadomości przy każdym wdrożeniu. Te ERROR-y są nadal w Explore i na dashboardzie; padnięty stos wykrywa alert o restartach kontenera.
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
6. **Restart kontenera** (reguła „Kontener restartuje się”, próg: ponad 2 starty w 15 minut): lokalny
   stos ma kontener `canary`, który istnieje tylko po to, żeby go restartować:
   ```sh
   for i in 1 2 3; do docker restart inkroom-logs-8099-canary-1; sleep 35; done
   ```
   Po kilkunastu sekundach w atrapie jest „Kontener inkroom-logs-8099-canary-1 wystartował 3 razy w ciągu
   15 minut”, a panel „Starty kontenerów” pokazuje 3 dla tego kontenera.
7. **Dysk powyżej 80%:** zapytanie reguły zwraca liczbę (zajętość `/`), ale 80% nie da się
   bezpiecznie przekroczyć lokalnie. Sprawdzono tymczasową kopią reguły z progiem 1% (utworzoną
   przez API Grafany i usuniętą), która wysłała wiadomość „Dysk serwera zajęty w 33%”. Zapytanie w
   Prometheusie: `100 * (1 - node_filesystem_avail_bytes{mountpoint="/",fstype!="rootfs"} / node_filesystem_size_bytes{mountpoint="/",fstype!="rootfs"})`.

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
| metryki hosta i kontenerów z komputera deweloperskiego (cAdvisor widzi wszystkie kontenery Dockera) | te same panele, ale tylko dla VM i jej kontenerów |
| Grafana na `127.0.0.1:3100` bez Cloudflare Access | Grafana za Cloudflare Access pod `logs.<domena>` (tunel) |
| hasło `local-test` | `GF_SECURITY_ADMIN_PASSWORD` z `.env` |
| log z nowego startu zaczyna się od zera | log kontenera rotowany przez Dockera (10 MB x 5), Loki trzyma 30 dni |

Lista do odhaczenia po wdrożeniu: (1) dashboard ma dane we wszystkich panelach, (2) `{service="app"}`
w Explore zwraca logi, (3) „Test” kontaktu daje wiadomość w Telegramie, (4) `up{job="app"}` równe 1,
(5) wejście na `logs.<domena>` bez zalogowania w Cloudflare Access jest zablokowane, (6)
`docker stats` pokazuje, że stos mieści się w ok. 1,5 GB, (7) po wywołaniu błędu przeglądarki
(sekcja 2) pojawia się wpis `service="client"`.

## 9. Czego lokalnie nie da się sprawdzić (i nie sprawdzono)

- **Alert 5xx i panic:** wymagają prawdziwej usterki serwera; reguły sprawdzaj zapytaniami w
  Prometheusie, a sam panic testami Go (`go test ./...`).
- **Dysk powyżej 80%:** sprawdzone tylko tymczasową regułą z progiem 1% (sekcja 6, punkt 7).
- **Podman bez Dockera:** skrypt przełącza się na `podman compose`, ale produkcyjny Alloy montuje
  `/var/run/docker.sock`; pod rootless Podmanem trzeba udostępnić gniazdo zgodne z Dockerem
  (`systemctl --user enable --now podman.socket`) i podmienić ścieżkę. Ta ścieżka nie była testowana,
  bo na tej maszynie działa Docker.
- **Inny system hosta:** VM to Debian z innym układem katalogów Dockera i wersją jądra niż Fedora tutaj;
  po wdrożeniu sprawdź, że panele hosta i kontenerów mają dane (lista w sekcji 8).
- **Telegram, Cloudflare Access i `logs.<domena>`:** wymagają Twoich kont, sprawdzasz po wdrożeniu.

## Nagrywanie lekcji z lokalnym bucketem S3 (R-094)

Bez ustawień `RECORDINGS_S3_*` nagrania idą na dysk serwera. Żeby sprawdzić drogę przez bucket (części
podpisanymi adresami prosto z przeglądarki), postaw lokalny S3, np. SeaweedFS:
```sh
cat > /tmp/s3.json <<'JSON'
{"identities":[{"name":"inkroom","credentials":[{"accessKey":"testkey","secretKey":"testsecret1234"}],"actions":["Admin","Read","Write","List","Tagging"]}]}
JSON
docker run -d --name inkroom-s3 -p 8333:8333 -v /tmp/s3.json:/etc/seaweedfs/s3.json \
  chrislusf/seaweedfs server -s3 -s3.config=/etc/seaweedfs/s3.json -dir=/data
curl -X PUT --aws-sigv4 "aws:amz:auto:s3" --user testkey:testsecret1234 http://localhost:8333/inkroom   # bucket
RECORDINGS_S3_ENDPOINT=http://192.168.0.51:8333 RECORDINGS_S3_BUCKET=inkroom \
RECORDINGS_S3_ACCESS_KEY=testkey RECORDINGS_S3_SECRET_KEY=testsecret1234 \
  FRESH=1 sh .claude/skills/test-server/server.sh start 8099
```
Adres bucketu musi być osiągalny z przeglądarki (stąd adres LAN, nie `localhost`, jeśli testujesz z innego
komputera). Test pakietu na prawdziwym S3:
`RECSTORE_TEST_S3="http://localhost:8333,inkroom,testkey,testsecret1234" go test ./internal/recstore -run TestS3 -v`.

Mikrofon (a więc nagrywanie) działa tylko na https albo `localhost`. Z innego komputera po
`http://192.168.0.51:8099` kliknięcie „Nagrywaj” powie, że strona jest po http, dopóki w Chrome nie dodasz
tego adresu (i adresu bucketu) w `chrome://flags/#unsafely-treat-insecure-origin-as-secure`.
