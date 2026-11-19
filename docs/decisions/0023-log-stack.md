# 0023. Stos do logów, metryk i alertów (Loki, Alloy, Prometheus, Grafana, Telegram)

- Status: accepted
- Data: 2026-11-19

## Kontekst
R-098 (obserwowalność) i ADR 0022 ustalają, jak aplikacja loguje (jedna linia JSON na stdout z polami `time`, `level`, `msg`, `service`, `request_id`; błędy przeglądarek jako `service=client`) i że wystawia metryki Prometheusa na osobnym wewnętrznym porcie `app:9100`. Ten ADR dotyczy drugiej strony: gdzie to zbierać, jak czytać i skąd dostać wiadomość, gdy coś się psuje.

Powody są dwa. Po pierwsze dziś `docker compose logs` jest jedynym wglądem, a przy nagrywaniu lekcji (R-094) dojdą kolejne mikroserwisy. Po drugie właściciel chce „zobaczyć, gdzie są errory” bez zaglądania na serwer. Maszyna (Debian, VM na homelabie) ma ok. 100 GB dysku i 8 GB RAM (do 16 GB), a procesor jest prawie nieużywany, bo obliczenia są po stronie klienta; z priorytetu „oszczędność CPU na serwerze” zrezygnowano 2026-11-19 (N-008), więc pełniejszy stos jest dozwolony.

## Rozważane opcje
1. **`docker compose logs` i `jq`.** Zero nowych usług, ale bez historii poza rotacją, bez wyszukiwania po usługach, bez alertów. Zostaje jako awaryjny wgląd.
2. **Dozzle** (podgląd logów Dockera na żywo). Malutki, ale nic nie przechowuje, nie ma metryk ani alertów.
3. **Loki + Alloy + Prometheus + Grafana.** Jedno miejsce na logi, metryki, wykresy i alerty, dobrze znane, dojrzałe; do ok. 1,5 GB RAM. Do utrzymania cztery kontenery, ale to konfiguracja, nie kod.
4. **VictoriaLogs** (lżejszy, jeden plik). Dobry wybór przy ciasnych zasobach, ale metryki i alerty i tak wymagałyby osobnych narzędzi, a tu zasobów nie brakuje.
5. **GlitchTip/Sentry** (grupowanie wyjątków). Przydatne, ale wymaga Postgresa i pakietu w kliencie (kosztuje responsywność, priorytet 1). Błędy przeglądarek trafiają zamiast tego do logów jako `service=client`.
6. **Usługa w chmurze** (Grafana Cloud, Better Stack...). Najmniej pracy, ale logi z danymi użytkowników wychodzą poza serwer, co przeczy polityce prywatności (R-096).

## Decyzja
**Opcja 3**, w tym samym `docker-compose.yml`, za profilem `observability`.

- **Loki** (jeden proces, pliki na wolumenie `loki_data`): retencja 30 dni przez kompaktor, limity przyjmowania (`ingestion_rate_mb`) chronią dysk przed zapętloną usługą.
- **Alloy** czyta logi kontenerów tego samego projektu compose przez gniazdo Dockera (tylko do odczytu) i zbiera metryki hosta (`prometheus.exporter.unix`) i kontenerów (`prometheus.exporter.cadvisor`). Etykiety są cztery: `service`, `container`, `compose_project`, `level`. Pola o dużej liczbie wartości (`request_id`, `path`) zostają w linii i czyta się je przez `| json`, żeby indeks Lokiego był mały. `service` z linii JSON zastępuje nazwę usługi compose (tak aplikacja oznacza błędy przeglądarek jako `client`). Poziom jest wyciągany także z logfmt (Litestream) i z formatu cloudflared (`ERR`, `WRN`) i zapisywany jednakowo (`ERROR`, `WARN`, `INFO`, `DEBUG`).
- **Prometheus**: zbiera `app:9100` co 15 s, a metryki Alloy dostaje przez remote write; 30 dni i najwyżej 10 GB.
- **Grafana**: źródła danych, dashboard „Inkroom” i alerty są **zapisane w repozytorium** (`deploy/observability/`, provisioning), więc odtwarzają się z folderem `deploy/`. Logowanie: konto `admin` z hasłem z `.env` (`GF_SECURITY_ADMIN_PASSWORD`; kontener odmawia startu bez niego, zamiast startować z domyślnym), rejestracja i dostęp anonimowy wyłączone.
- **Dostęp:** żaden z czterech kontenerów nie ma portu otwartego na świat. Grafana jest dostępna przez istniejący tunel Cloudflare pod osobną nazwą (`logs.<domena>`, usługa `grafana:3000`) **za Cloudflare Access** z regułą na e-mail właściciela, tak jak strona administratora (ADR 0017), oraz na `127.0.0.1:3000` dla tunelu SSH. Weryfikacja tokenu Access po stronie Grafany (`auth.jwt`) byłaby kolejną warstwą, ale wymaga trzech dodatkowych zmiennych i nie jest konieczna, bo hasło `admin` jest drugą, niezależną.
- **Alerty** (Grafana, plik `alerting.yml`): ERROR w logach dowolnej usługi (5 minut), 5xx (powyżej 5% i co najmniej 5 w 5 minut), panic, aplikacja nie odpowiada (brak metryk 2 minuty), restart kontenera (więcej niż 2 starty w 15 minut), dysk powyżej 80%, wysyp błędów przeglądarek. Grupowanie po `alertname` i `service`, pierwsza wiadomość po 30 s, kolejne co 5 minut, powtórzenia co 12 godzin.
- **Telegram jako webhook, nie wbudowany kontakt „Telegram”.** Wbudowany odczytuje `chatid` jako tekst, ale Grafana przy provisioningu zamienia zmienną środowiskową złożoną z cyfr (a każdy chat id jest liczbą) na liczbę i odmawia startu (`cannot unmarshal number into Config.chatid of type string`; sprawdzone na wersji 12.4). Zmienna wstawiona wewnątrz szablonu JSON zostaje tekstem, więc kontakt jest webhookiem do `sendMessage` Bot API z własnym szablonem wiadomości (`inkroom.telegram`). Adres API jest zmienną `TELEGRAM_API_URL` (domyślnie `https://api.telegram.org`), co pozwala sprawdzić całą drogę z lokalnym serwerem zamiast Telegrama.
- **Profil, a nie włączone domyślnie.** Samo `docker compose config` i `docker compose up` bez `COMPOSE_PROFILES=observability` nie zmieniają nic w dotychczasowym wdrożeniu (`update.sh` i `test-update.sh` bez zmian). Aplikacja nie ma `depends_on` do stosu. Błąd w konfiguracji obserwowalności nie może więc zepsuć nocnej aktualizacji ani aplikacji; włączenie jest świadomym krokiem właściciela (jedna linia w `.env`). Kontenery spoza aktywnego profilu nie są usuwane przez `up --remove-orphans`.
- **Zasoby:** limity pamięci (`mem_limit`): po 384 MB na Loki, Prometheus, Grafanę i Alloy, razem ok. 1,5 GB (Alloy z cAdvisorem zajmuje już ok. 190 MB w spoczynku, więc 256 MB było za ciasne); aplikacja i Litestream nie mają limitów i mają pierwszeństwo. Rotacja logów Dockera (`json-file`, 10 MB x 3) dla nowych kontenerów.
- **Wersje obrazów są przypięte** (Loki 3.6.22, Alloy v1.21.3, Prometheus v3.15.1, Grafana 12.4.15), żeby nocna aktualizacja nie zmieniła stosu bez wiedzy właściciela; podnosi się je świadomie.

## Konsekwencje
- **Konfiguracja jednorazowa:** bot Telegram (BotFather), aplikacja Cloudflare Access dla drugiej nazwy, pięć zmiennych w `.env` (kroki w `deploy/README.md`, sekcja 10).
- **Nowy mikroserwis** wystarczy, że loguje JSON na stdout z polem `service`; metryki dopisuje się jedną linią w `prometheus.yml`. Reguła „ERROR w logach” obejmuje go od razu.
- **Gniazdo Dockera w Alloy:** kto przejmie ten kontener, ma uprawnienia roota na hoście (zamontowanie „tylko do odczytu” nie ogranicza API). Ryzyko ograniczone: obraz oficjalny i przypięty, brak publikowanego portu, sieć wewnętrzna. Można je zmniejszyć pośrednikiem gniazda (`docker-socket-proxy`), jeśli kiedyś zajdzie potrzeba.
- **Alloy filtruje kontenery po projekcie compose** (`com.docker.compose.project=${COMPOSE_PROJECT_NAME}`), więc nie czyta innych projektów na tej maszynie (np. tunelu `Quiz`).
- **Logi nie są kopiowane do R2** (są jednorazowe), a dashboard i alerty wracają z repozytorium. Konto `admin` i ustawienia zrobione w interfejsie są w wolumenie `grafana_data`.
- **Szum:** reguła „ERROR w logach” zgłosi także błędy samego stosu (np. Grafana z `level=error`). Jeśli któryś powtarzalny błąd będzie niegroźny, wycisza się go zawężając zapytanie w `alerting.yml`.
- **Sprawdzone lokalnie** z kontenerem udającym aplikację (JSON, `/metrics` na 9100) oraz kontenerem z logfmt i formatem cloudflared: Alloy etykietuje usługi i poziomy, Prometheus zbiera metryki hosta i kontenerów, Grafana ładuje źródła, dashboard (25 paneli, wszystkie zapytania zwracają dane) i 7 reguł, a alert o błędach w logach dochodzi jako JSON `sendMessage` z `chat_id` jako tekstem. Nie sprawdzono prawdziwego bota Telegram ani Cloudflare Access (wymagają kont właściciela).
