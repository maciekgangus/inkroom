# 0024. Stos logów na osobnej maszynie, na VM aplikacji tylko agent

- Status: proposed (czeka na akceptację właściciela; zastępuje część ADR 0023: miejsce uruchomienia; konfigurację stosu przeniósł do repo homelab-setup ADR 0034)
- Data: 2026-11-23

## Kontekst
ADR 0023 postawił Lokiego, Prometheusa, Grafanę i Alloy w tym samym `docker-compose.yml` co aplikację, na tej samej VM. Dwa problemy z praktyki:

1. **Awaria VM wyłącza też monitoring.** Po nieczystym restarcie noda Proxmoxa (20.11) VM wstała dopiero po ręcznym starcie, a w czasie przestoju nie było ani logów, ani alertu na Telegramie: Loki, Grafana i reguły alertów były na tej samej maszynie, która padła. Alert „Aplikacja nie odpowiada” z definicji nie może się odpalić, gdy nie działa jego własny silnik.
2. **Fałszywe alarmy.** Alert „Błędy w logach” odpalał się od niegroźnych linii `cloudflared` (przeglądarka zamyka żądanie: `stream … canceled by remote with error code 0`, `context canceled`, `Incoming request ended abruptly`; 827 ERROR w 7 dni). To naprawiono osobno (Alloy obniża je do WARN; prawdziwe błędy, jak `Unable to reach the origin`, zostają ERROR). Wpadka z `dial tcp …:3000: connection refused` do Grafany znika z tym ADR-em, bo Grafana nie stoi już za tunelem aplikacji.

Właściciel chce też mieć logowanie „oddelegowane od aplikacji” i nie w jednym zestawie z nią.

## Rozważane opcje
1. **Zostawić jak jest**, tylko wyciszyć szum. Nie rozwiązuje problemu 1.
2. **Stos w chmurze** (np. warstwa darmowa Grafana Cloud). Zero utrzymania i niezależne od homelabu, ale logi (nawet z pseudonimami: numer konta, skrót) wychodzą poza serwer, co ADR 0023 odrzucił ze względu na politykę prywatności (R-096), a darmowa warstwa ma limity retencji i ilości. Zostaje jako opcja awaryjna, jeśli homelab się nie sprawdzi.
3. **Zewnętrzny ping** (UptimeRobot, Healthchecks.io) na `/healthz`. Tani i niezależny, ale mówi tylko „działa / nie działa”, bez logów. Dobry dodatek, nie zamiennik.
4. **Stos na osobnej maszynie w sieci domowej (`rpi-server`), na VM aplikacji tylko agent.** Wybrane.
5. **Stos na drugiej VM na drugim Proxmoxie.** Też niezależne od pierwszego noda, ale cięższe w utrzymaniu niż rpi, które już stoi i nic nie robi.

## Decyzja
**Opcja 4.** Dwa osobne projekty compose, żaden nie należy do `deploy/docker-compose.yml`:

- **`deploy/agent/`** (na maszynie aplikacji): jeden kontener Alloy (`name: inkroom-agent`). Czyta logi kontenerów projektu aplikacji (`LOG_PROJECT_FILTER=com.docker.compose.project=<projekt aplikacji>`, na serwerze `workdir`), zbiera metryki hosta i kontenerów oraz **sam scrapuje `app:9100`** (job `app`, więc `up{job="app"}` zostaje) i wypycha wszystko przez LAN: logi na `LOKI_URL`, metryki na `PROMETHEUS_URL` (remote write). Do `app:9100` dochodzi przez dołączenie do sieci projektu aplikacji (`workdir_default`, `external`); aplikacja nie publikuje przez to żadnego portu. Gniazdo Dockera zostaje tylko tu (Alloy musi czytać tego hosta), z tymi samymi zastrzeżeniami co w ADR 0023.
- **`deploy/observability/`** (na maszynie stosu): Loki, Prometheus, Grafana i własny `cloudflared` dla Grafany. Konfiguracja, dashboard i alerty bez zmian poza tym, że Prometheus nie scrapuje już aplikacji ani Alloy (robi to agent).
- **Porty 3100 (Loki) i 9090 (Prometheus) nie mają logowania**, więc są publikowane wyłącznie na adresie LAN maszyny stosu (`LAN_IP`), nie na wszystkich interfejsach, i nie wolno ich przekierowywać z routera. Ryzyko: ktoś w LAN może wpisać fałszywe logi lub metryki. Przy sieci domowej akceptowalne; mocniejsze wersje (przez tunel, uwierzytelnienie) są możliwe później.
- **Tunel Grafany jest własny, z własnym tokenem** (`logs.<domena>` w osobnym tunelu maszyny stosu). Tego samego tokenu co tunel aplikacji nie wolno użyć: dwie maszyny stają się wtedy replikami jednego tunelu i Cloudflare rozdzielałby ruch strony także na maszynę stosu. Aplikacja Access dla `logs.<domena>` zostaje bez zmian.
- **Alert „Aplikacja nie odpowiada” ma teraz sens**: `up{job="app"}` wysyła agent z VM, więc gdy aplikacja, agent albo cała VM znikają, dane przestają przychodzić (`noDataState: Alerting`, już ustawione) i alert odpala Grafana z innej maszyny. Cena: agent, który stoi, wygląda jak aplikacja, która nie działa (opis alertu to mówi). Alert „ERROR w logach” zostaje; usługi stosu (Loki, Grafana, Prometheus) nie są już w tych logach, bo nie ma tam Alloy.
- **Nic się nie buduje.** Wszystkie obrazy stosu to oficjalne obrazy przypięte do wersji i wieloplatformowe (`linux/amd64` i `linux/arm64`, sprawdzone); `rpi-server` (`aarch64`) uruchamia je natywnie. Własny obraz aplikacji nadal buduje GitHub Actions dla `linux/amd64`, bo działa na VM `x86_64`; `linux/arm64` trzeba by dopisać do `platforms`, dopiero gdyby własna usługa miała działać na rpi.
- **Kolejność wdrożenia** (szczegóły w `deploy/README.md`, sekcja 11): stos na rpi, agent na VM, dopiero potem nowy `deploy/` na VM. Pierwsze `up --remove-orphans` usunie z projektu aplikacji stare kontenery stosu i ich wolumeny zostaną do ręcznego usunięcia. **Historia z VM (30 dni) nie jest przenoszona**: zaczynamy od zera.
- **Profil `observability` znika** z `deploy/docker-compose.yml` (i `COMPOSE_PROFILES` z `.env` aplikacji). Aplikacja i nocna aktualizacja nie mają już nic wspólnego ze stosem.

## Konsekwencje
- Gdy VM lub jej nod pada, Telegram dostaje alert (o ile rpi i router żyją). Jeśli pada prąd w całym domu, nie dostanie nikt: to zakres zewnętrznego pingu (opcja 3), który warto dodać osobno.
- Dwa foldery do skopiowania i dwa `.env`, ale każdy jest mały. `scripts/test-split.sh` sprawdza podział lokalnie (stos i agent jako osobne projekty, atrapa aplikacji, logi i `up` dochodzą przez adres LAN, po zatrzymaniu aplikacji `up` spada do 0); `scripts/test-log-levels.sh` sprawdza poziomy `cloudflared`.
- Dysk i pamięć maszyny stosu nie są objęte alertem o dysku (ten patrzy na metryki agenta, czyli VM). Prometheus stosu zbiera tylko swoje i Grafany; node exporter dla rpi można dopisać później.
- Test lokalny (`server.sh start --logs`) dalej stawia całość w jednym projekcie, z tym samym `config.alloy` agenta i tym samym Lokim, Prometheusem i Grafaną; przepis na osobne projekty weryfikuje `test-split.sh`.
- **Do zrobienia przez właściciela:** nowy tunel w Cloudflare dla maszyny stosu (token), usunięcie nazwy `logs` z tunelu aplikacji, wolne porty 3100, 9090, 3000 na rpi (albo zmienne `*_PORT`), `LAN_IP` rpi.
