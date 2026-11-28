# 0034. Stos obserwowalności przeniesiony do repo homelab-setup

- Status: accepted
- Data: 2026-11-28

## Kontekst
ADR 0024 przeniósł Lokiego, Prometheusa i Grafanę na `rpi-server` (192.168.0.12), ale ich konfiguracja dalej żyła w tym repo (`deploy/observability/`) i patrzyła wyłącznie na aplikację.

27–28.11 node Proxmoxa `pve-01`, na którym stoją VM-ki `inkroom` i `claude-sandbox`, dwa razy stracił sieć. Karta Intel I219-LM (sterownik `e1000e`) zgłaszała w kółko `Detected Hardware Unit Hang`: najpierw przez 20 minut, potem przez ok. 7,5 godziny. Host działał, ale był głuchy, więc WoL nic nie dawał i za każdym razem trzeba było wcisnąć przycisk. Stos niczego z tego nie zarejestrował:
- nie zbierał logów ani metryk nodów, tylko VM-ki aplikacji;
- jedyny sygnał, alert „Aplikacja nie odpowiada”, nie mówił, że przyczyną jest node, a nie aplikacja;
- w `.env` stosu na rpi nie ma `TELEGRAM_BOT_TOKEN` ani `TELEGRAM_CHAT_ID`, więc alerty i tak nigdzie nie szły.

Właściciel chce jedną Grafanę dla całego homelaba (nody, VM-ki, aplikacje) z podziałem na foldery, a nie osobny stos na każdą warstwę.

## Rozważane opcje
1. **Zostawić stos tutaj i dopisać nody.** Repo aplikacji zaczęłoby opisywać infrastrukturę Proxmoxa: agentów na hostach, pingi i alerty o kartach sieciowych. To nie jest sprawa aplikacji.
2. **Dwa stosy:** obecny dla aplikacji i nowy dla nodów. Podwójny RAM na rpi, podwójne alerty i kontakty, a przede wszystkim brak korelacji. „Aplikacja nie odpowiada” i „karta na `pve-01` się zawiesiła” to jedno zdarzenie, które powinno być widać na jednym wykresie.
3. **Jeden stos w repo infrastruktury (`maciekgangus/homelab-setup`, katalog `monitoring/`).** Wybrane.

## Decyzja
**Opcja 3.** Źródłem prawdy dla stosu działającego na `rpi-server` jest od teraz `homelab-setup/monitoring/`, a nie `deploy/observability/`.

- **Na rpi** stos działa w `~/homelab-monitoring` (projekt compose `homelab-monitoring`, wcześniej `inkroom-observability` w `~/inkroom-observability`). Wolumeny mają stałe nazwy `inkroom-observability_*`, więc 30 dni historii przetrwało. Stary katalog `~/inkroom-observability` na rpi nie jest już używany.
- **Grafana ma dwa foldery:** *Inkroom* (dotychczasowy dashboard i alerty aplikacji, bez zmian w treści) oraz *Infrastruktura* (dashboard „Homelab”: pingi, zasoby i sieć nodów, journal; alerty nodów). Dashboardem startowym jest teraz „Homelab”.
- **Doszły blackbox exporter** (ping nodów i VM-ek, port 8006 Proxmoxa) oraz **Alloy na każdym nodzie** (`pve-01`, `pve-02`): journal idzie do Lokiego (`job="node-journal"`), metryki hosta do Prometheusa (`job="proxmox-node"`). Etykieta `layer="node"|"vm"` oddziela warstwy.
- **Zapytania o hosta w folderze Inkroom zawężono do `job="integrations/unix"`** (CPU, pamięć, dysk na dashboardzie i alert „Dysk prawie pełny”). Bez tego metryki nodów, które też mają `node_*`, mieszałyby się z metrykami VM aplikacji. Polityka powiadomień grupuje teraz po `[alertname, service, host]`.
- **Agent aplikacji (`deploy/agent/`) zostaje w tym repo bez zmian.** Dalej wypycha logi i metryki na `192.168.0.12:3100` i `:9090`, a etykiety i joby się nie zmieniły.

## Konsekwencje
- **Zmiany dashboardu `inkroom.json` i alertów z grupy `inkroom`, które mają trafić na produkcję, robi się w `homelab-setup/monitoring/grafana/`** (dashboard: `dashboards/inkroom/inkroom.json`, alerty: `provisioning/alerting/alerting.yml`, grupa `inkroom`). Zmiana tylko w `deploy/observability/` nie dotrze już na rpi.
- **`deploy/observability/` zostaje na razie w tym repo**, bo korzysta z niego test lokalny (`server.sh start --logs`, `docs/testowanie-lokalne.md`) i `scripts/test-split.sh`. Kopia tutaj i kopia w `homelab-setup` mogą się rozjechać, dlatego **do zrobienia przez agenta tego repo**:
  1. przenieść do `deploy/observability/` filtr `job="integrations/unix"` z dashboardu i alertu o dysku, żeby obie kopie zapytań były zgodne;
  2. zaktualizować `deploy/README.md` (sekcja 11, „Maszyna stosu”) i nagłówek `deploy/observability/docker-compose.yml`: wdrożenie stosu opisuje `homelab-setup/monitoring/README.md`, a ten folder służy już tylko do testu lokalnego;
  3. w przyszłości rozważyć, czy test lokalny może brać konfigurację z `homelab-setup` (np. submoduł albo pobranie przy starcie), żeby kopia tutaj w ogóle zniknęła. To osobna decyzja, nie ten ADR.
- **Do zrobienia przez właściciela:** wpisać `TELEGRAM_BOT_TOKEN` i `TELEGRAM_CHAT_ID` do `.env` stosu na rpi (`~/homelab-monitoring/.env`). Bez tego żaden alert, ani aplikacji, ani nodów, nie dochodzi.
- Zawieszenia karty `e1000e` na nodach są tematem infrastruktury (offload TSO/GSO/GRO, watchdog sieci) i są śledzone w `homelab-setup`, nie tutaj. Dla aplikacji oznaczają tyle, że alert „Aplikacja nie odpowiada” razem z „Node nie odpowiada” z folderu *Infrastruktura* wskazuje na host, a nie na kod.
