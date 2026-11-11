# Wdrożenie na homelab (obraz z GHCR i Cloudflare Tunnel)

ADR 0014 (obraz i aktualizacje) i ADR 0003 (tunel). Aplikację buduje GitHub Actions i publikuje
jako obraz; na serwerze działają dwa kontenery z jednego `docker-compose.yml`: `app` (aplikacja) i
`cloudflared` (tunel do Cloudflare). Router i serwer nie otwierają żadnych portów.

```
uczeń (iPad)  ->  https://lekcje.twojadomena.pl  ->  Cloudflare  ->  tunel  ->  cloudflared  ->  app:8080
```

## 1. Skąd wziąć obraz

```
ghcr.io/maciekgangus/inkroom
```

Pakiet jest publiczny, więc `docker pull` działa bez logowania.

| Tag | Co to jest |
|---|---|
| `:main` | najnowszy stan gałęzi `main` (każdy merge); **jest już dostępny** |
| `:sha-1a2b3c4` | konkretny commit z `main` |
| `:0.1.0`, `:0.1` | wydanie (powstaje z tagu git `v0.1.0`) |
| `:latest` | ostatnie wydanie; **pojawi się dopiero po pierwszym tagu `v...`** |

Sprawdzenie: `docker pull ghcr.io/maciekgangus/inkroom:main`. Do czasu pierwszego wydania ustaw w
`.env` `INKROOM_TAG=main`; po wydaniu usuń tę linię, a serwer będzie śledził `:latest`.

Wydanie (na swoim komputerze, po zmergowaniu do `main`):

```sh
git tag v0.1.0 && git push --tags
```

## 2. Jednorazowo w Cloudflare

Domena musi być w Cloudflare (jej serwery nazw wskazują na Cloudflare). Nazwy w panelu mogą się
nieco różnić; szukaj Zero Trust (czasem "Cloudflare One") i Turnstile.

1. **Tunel:** Zero Trust, Networks, Tunnels, "Create a tunnel", typ **Cloudflared**, nazwa np.
   `inkroom-homelab`. Na ekranie z komendami skopiuj **token** (długi ciąg po `--token`), nie
   uruchamiaj tamtej komendy.
2. **Trasa:** w tym samym kreatorze (albo zakładka Public Hostname tunelu): subdomena np. `lekcje`,
   domena twoja, **Service: HTTP, URL `app:8080`** (`app` to nazwa usługi w compose, nie adres IP).
3. **Turnstile:** Turnstile, "Add widget", nazwa `inkroom`, hostname `lekcje.twojadomena.pl`, tryb
   Managed. Zapisz **site key** i **secret key**.

## 3. Na homelabie

Potrzebny jest Docker z wtyczką Compose (`docker compose version`) i `curl`.

```sh
sudo mkdir -p /opt/inkroom && sudo chown "$USER" /opt/inkroom
# skopiuj do /opt/inkroom zawartość folderu deploy/ z repozytorium, np.:
scp -r deploy/* uzytkownik@homelab:/opt/inkroom/
cd /opt/inkroom
cp env.template .env
nano .env          # wpisz TUNNEL_TOKEN, TURNSTILE_SITE_KEY, TURNSTILE_SECRET (i INKROOM_TAG=main przed pierwszym wydaniem)
chmod 600 .env
docker compose up -d
```

Sprawdzenie:

```sh
docker compose ps                         # app i cloudflared: running
curl -s http://127.0.0.1:8080/healthz     # ok
docker compose logs cloudflared | tail    # szukaj "Registered tunnel connection"
```

Potem otwórz `https://lekcje.twojadomena.pl`: powinna być strona logowania. Sprawdź kolejno:
rejestrację (`/register`, widżet Turnstile), logowanie, utworzenie tablicy i rysowanie na dwóch
urządzeniach (WebSocket przez tunel).

## 4. Automatyczne aktualizacje (raz)

```sh
sudo cp inkroom-update.service inkroom-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now inkroom-update.timer
systemctl list-timers inkroom-update.timer
```

Jeśli folder jest gdzie indziej niż `/opt/inkroom`, popraw ścieżki w `inkroom-update.service`.
Timer co noc o 4:00 uruchamia `update.sh`: pobiera nowsze obrazy (aplikacji i `cloudflared`),
podnosi kontener, sprawdza `/healthz` i **sam wraca do poprzedniego obrazu**, gdy nowy nie wstanie
w 30 s. Od razu: `sudo systemctl start inkroom-update.service`.

Przypięcie albo wycofanie wersji: `INKROOM_TAG=0.0.9 ./update.sh` (lub wpis w `.env`).
Migracje bazy idą tylko do przodu, więc przed wydaniem zmieniającym schemat zrób kopię (niżej).

## 5. Kopia zapasowa (na razie ręczna)

Dane (baza SQLite z tablicami i obrazami) są w wolumenie `data`. Do czasu automatycznych kopii
(Litestream, osobne zadanie) rób co jakiś czas kopię przy zatrzymanej aplikacji (kopiowanie bazy,
która pisze, może dać uszkodzony plik):

```sh
docker volume ls | grep data              # nazwa wolumenu, np. inkroom_data
docker compose stop app
docker run --rm -v inkroom_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/inkroom-data-$(date +%F).tgz -C /data .
docker compose start app
```

Skopiuj plik `.tgz` poza serwer. Przywrócenie to ten sam `tar` w drugą stronę do pustego wolumenu.

## 6. Sprawdzenie tunelu bez domeny

Do szybkiego testu (adres znika po zamknięciu): aplikacja musi działać na hoście
(`docker compose up -d app`), a potem

```sh
docker run --rm --network host cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://localhost:8080
```

wypisze adres `https://....trycloudflare.com`. Rejestracja wymaga kluczy Turnstile dla tego
adresu, więc do takiego testu wpisz w `.env` opublikowane klucze testowe Cloudflare (zawsze
przechodzą): site key `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.
Na produkcji używaj własnych kluczy.

## Gdy coś nie działa

| Objaw | Co sprawdzić |
|---|---|
| `docker compose` mówi "required variable TUNNEL_TOKEN is missing" | brak `TUNNEL_TOKEN` w `.env` (plik musi leżeć obok `docker-compose.yml`) |
| Cloudflare pokazuje 502 | trasa w tunelu ma zły adres usługi; musi być `http://app:8080`; `docker compose ps` czy `app` działa |
| `cloudflared` w logach: "Unauthorized" albo "failed to connect" | zły lub unieważniony token; wygeneruj nowy w panelu tunelu |
| Strona się otwiera, ale rejestracja nie działa | brak `TURNSTILE_SECRET` (rejestracja jest wtedy zamknięta) albo klucze dla innej domeny |
| Rysowanie nie synchronizuje się | WebSocket: sprawdź w konsoli przeglądarki `/ws/...`; tunel wspiera WebSocket, więc zwykle to zła trasa |
| `update.sh` kończy się błędem | `docker compose logs app`; skrypt sam wraca do poprzedniego obrazu, a log mówi, który nie wstał |

## Testy skryptów

`sh deploy/test-update.sh` sprawdza `update.sh` na atrapach `docker` i `curl` (bez Dockera); CI
uruchamia go przy każdej zmianie, a także sprawdza, że `docker-compose.yml` czyta się z tokenem
i odmawia startu bez niego.
