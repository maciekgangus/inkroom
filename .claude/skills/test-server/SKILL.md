---
name: test-server
description: Odpala (albo zatrzymuje) lokalny serwer testowy Inkroom z aktualnego checkoutu: buduje klienta i serwer, startuje w tle na porcie 8099 z kontem testowym i kluczami testowymi captchy, i podaje adresy (PC i LAN dla iPada). Z opcją --logs uruchamia obok lokalny stos logów w kontenerach (Loki, Alloy, Prometheus, Grafana, atrapa Telegrama). Użyj, gdy użytkownik prosi o "odpal serwer", "daj przetestować", "postaw serwer testowy", "z logami" albo o zatrzymanie go.
---

# Serwer testowy Inkroom

Serwer działa w tle z katalogu, w którym jesteś (worktree), więc dotyczy tej gałęzi. Każdy port
ma własny stan (baza, log, pid) w `~/.cache/inkroom-test-server-<port>`.

## Użycie

Skrypt: `.claude/skills/test-server/server.sh` (z korzenia checkoutu; ścieżka bywa też
`<worktree>/.claude/skills/test-server/server.sh`).

- Start: `sh .claude/skills/test-server/server.sh start [port] [--logs]` (domyślnie 8099). Najpierw
  zatrzymuje poprzedni serwer na tym porcie, buduje `web/` i `server/`, czeka na `/healthz`.
  `FRESH=1` zaczyna od pustej bazy (i od pustego stosu logów).
- Z `--logs` startuje też lokalny stos logów w kontenerach (patrz niżej). Samo `logs start [port]`
  robi to samo, `logs stop [port]` zatrzymuje tylko stos, `logs status [port]` go sprawdza.
- Stan: `... status [port]`, zatrzymanie serwera i stosu: `... stop [port]`.

## Stos logów (`--logs`)

Lokalna kopia tego, co działa na VM (ADR 0022 i 0023): **Loki, Alloy, Prometheus i Grafana to te same
obrazy, pliki konfiguracyjne, dashboard i reguły alertów z `deploy/observability`**, więc test sprawdza
to, co pójdzie na serwer. Alloy działa na **nieprzerobionym pliku produkcyjnym** `config.alloy`, z tymi
samymi montowaniami (gniazdo Dockera, `/`, `/sys`), więc zbiera logi kontenerów oraz metryki hosta i
kontenerów (panele procesora, pamięci, dysku i kontenerów mają dane). Różnice: aplikacja jest procesem
natywnym, więc dochodzi jeden plik czytający jej **log** (`local.alloy`, generowany przez skrypt) i
Prometheus pobiera jej metryki z hosta; zamiast Telegrama alerty trafiają do **atrapy**
(`logs/sink.py`), która zapisuje je do pliku. Jest też kontener `canary` do ćwiczenia alertu o
restartach (`docker restart inkroom-logs-<port>-canary-1`). Nic nie wymaga sekretów.
Wymaga działającego Dockera (a gdy go nie ma, rootless Podmana). Pliki: `logs/docker-compose.yml`,
`logs/sink.py`; konfiguracje wynikowe powstają w `~/.cache/inkroom-test-server-<port>/logs/`.

Adresy dla portu 8099 (dla innego portu przesunięte o różnicę względem 8099, więc dwa checkouty nie
wchodzą sobie w drogę):

| Co | Adres |
|---|---|
| Grafana (dashboard „Inkroom” jako strona główna) | http://192.168.0.51:3100 (z LAN), login `admin` / `local-test` |
| Prometheus | http://127.0.0.1:9190 |
| Loki (API, do `curl`) | http://127.0.0.1:3200 |
| Atrapa Telegrama (alerty) | http://192.168.0.51:9199 (z LAN), plik `~/.cache/inkroom-test-server-8099/sink/received.jsonl` |
| Metryki aplikacji | http://127.0.0.1:9099/metrics (w trybie `--logs` nasłuchują na wszystkich interfejsach, żeby Prometheus w kontenerze je widział; to dane techniczne bez danych osobowych) |

Przy `--logs` podaj użytkownikowi także te adresy. Przewodnik testów krok po kroku:
`docs/testowanie-lokalne.md`.

## Co zrobić

1. Wykonaj `start` w worktree, w którym trwa praca (sprawdź `git rev-parse --show-toplevel`,
   w razie wątpliwości zapytaj, o którą gałąź chodzi). Przy pracy w kilku worktree podaj inny port,
   żeby się nie zatrzymywały nawzajem. **Od teraz testowanie funkcji idzie z logami: uruchamiaj
   z `--logs`** (poza zmianami czysto wizualnymi, gdzie wystarczy sam serwer).
2. **Użytkownik nie siedzi na tej maszynie:** to VM (adres w LAN `192.168.0.51`), a on wchodzi z
   innego komputera albo iPada. Podawaj mu zawsze adres LAN z wyniku (`http://192.168.0.51:<port>`),
   nigdy `localhost` ani `127.0.0.1`. Skrypt sam ustawia `BIND_ADDR=0.0.0.0:<port>`. Jeśli wyjątkowo
   stawiasz serwer aplikacji ręcznie (inny build, zrzuty, e2e, które ma oglądać użytkownik), też ustaw
   `BIND_ADDR=0.0.0.0:<port>`: serwer z kontem testowym bez `BIND_ADDR` odmawia startu, a
   `127.0.0.1` jest dla użytkownika nieosiągalne. Przed podaniem adresu sprawdź go z tej maszyny:
   `curl -fs http://192.168.0.51:<port>/healthz`. Metryki zostają na `127.0.0.1`.
3. Przekaż użytkownikowi ten adres oraz konto testowe:
   `test@example.test` / `test-user-1234` (logowanie także samą nazwą `test`). To publiczne konto
   deweloperskie z `CLAUDE.md`, więc można je podać.
4. Rejestracja na `/register` działa z testową captchą Cloudflare (widżet wymaga internetu).
5. Na tej VM procesor nie ma AVX, więc `npm run build` (vite, rolldown) kończy się „Illegal instruction” i skrypt staje na budowaniu klienta. Naprawa jest po stronie Proxmoxa (typ procesora `host`); do tego czasu powiedz o tym użytkownikowi zamiast udawać, że serwer działa.
6. Na iPadzie po LAN może być potrzebne otwarcie portu: `sudo firewall-cmd --add-port=<port>/tcp`
   (bez `--permanent`); podpowiedz to, ale nie uruchamiaj `sudo` sam.
7. Nie czytaj ani nie zmieniaj plików `.env`; skrypt ich nie używa.
8. Nie zostawiaj serwera ani stosu włączonych bez wiedzy użytkownika: po teście zapytaj, czy
   zatrzymać (`stop` zatrzymuje oba i kasuje dane stosu), albo zatrzymaj, gdy o to poprosi.

## Lista kontrolna logów przy każdym teście funkcji

Po ręcznym przejściu przez funkcję (w Claude in Chrome albo przez użytkownika) sprawdź w Grafanie
(Explore, źródło Loki) lub przez API Lokiego (`curl -G http://127.0.0.1:3200/loki/api/v1/query_range --data-urlencode 'query={service="app"}'`; nie używaj do tego proxy Grafany, bo jej własne błędy RBAC trafiają potem do logów jako ERROR i fałszują sprawdzenie):

1. **Zdarzenia funkcji są w logu:** `{service="app"} | json` pokazuje żądania funkcji (`path` to wzorzec
   trasy, np. `/api/boards/{id}`), z poprawnym `status` i rozsądnym `duration_ms`.
2. **Brak nowych ERROR i panic:** `{service="app",level="ERROR"}` jest puste, a panel „Panic” na
   dashboardzie pokazuje 0. Każdy ERROR z testu to błąd do naprawienia przed zgłoszeniem.
3. **Brak nowych WARN-ów, których nie tłumaczy test** (np. 4xx z celowego błędnego logowania są w
   porządku; nieoczekiwane 4xx i wolne żądania `slow=true` nie).
4. **Błędy przeglądarki:** `{service="client"}` jest puste (konsola Chrome też), albo każdy wpis ma
   wyjaśnienie.
5. **Metryki:** w Prometheusie `up{job="app"}` równe 1, a liczniki dotyczące funkcji (np.
   `inkroom_ws_messages_total`) rosną.
6. **Prywatność:** w logach nie ma e-maili, haseł, tokenów ani pełnych adresów tablic (`/b/<id>`).
7. Jeśli funkcja dodaje nowy rodzaj zdarzenia lub błędu, który ma być widoczny na produkcji,
   dopisz go do dashboardu lub reguły alertu w `deploy/observability`.
