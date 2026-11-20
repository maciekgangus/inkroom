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

Pakiet jest **prywatny**: pobranie wymaga zalogowania Dockera do `ghcr.io` (krok 3, "Logowanie do rejestru").

| Tag | Co to jest |
|---|---|
| `:main` | najnowszy stan gałęzi `main` (każdy merge); **jest już dostępny** |
| `:sha-1a2b3c4` | konkretny commit z `main` |
| `:0.1.0`, `:0.1` | wydanie (powstaje z tagu git `v0.1.0`) |
| `:latest` | ostatnie wydanie (**to śledzi serwer**) |

Sprawdzenie (po zalogowaniu): `docker pull ghcr.io/maciekgangus/inkroom:main`. Wydanie `v0.1.0` już istnieje, więc `:latest` jest dostępny i `INKROOM_TAG` w `.env` nie jest potrzebny (serwer śledzi `:latest`).

**Nowe wersje** (tagi, kiedy serwer je dostaje, cofanie) opisuje [docs/wydawanie-wersji.md](../docs/wydawanie-wersji.md). W skrócie, na swoim komputerze po zmergowaniu do `main`:

```sh
git tag -a v0.1.1 -m "krótki opis" && git push origin v0.1.1
```

### Ustawienie pakietu jako prywatnego (raz, w przeglądarce)

Pierwsza publikacja z publicznego repozytorium daje pakiet publiczny, a widoczności nie zmienia się
przez API ani z linii poleceń:

1. GitHub, twój profil, zakładka **Packages**, pakiet **inkroom**.
2. **Package settings** (po prawej), na dole **Danger Zone**, **Change visibility**, wybierz
   **Private**, wpisz nazwę pakietu i potwierdź.
3. Sprawdzenie: na komputerze bez logowania `docker manifest inspect ghcr.io/maciekgangus/inkroom:main`
   powinno odpowiedzieć `unauthorized`. Publikowanie z GitHub Actions działa dalej bez zmian
   (pakiet jest powiązany z repozytorium).

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

### Logowanie do rejestru (raz)

Obraz jest prywatny, więc serwer musi mieć token z prawem odczytu:

1. GitHub, Settings, Developer settings, **Personal access tokens, Tokens (classic)**,
   "Generate new token (classic)", nazwa `inkroom-homelab`, zakres **tylko `read:packages`**,
   ważność wg uznania (np. rok, i przypomnienie o odnowieniu). Skopiuj token raz.
2. Na serwerze, **jako root** (timer aktualizacji działa jako root i czyta dane logowania z jego
   katalogu domowego):
   ```sh
   echo 'TWOJ_TOKEN' | sudo docker login ghcr.io -u maciekgangus --password-stdin
   ```
   Komenda zapisze dane w `/root/.docker/config.json`. Jeśli uruchamiasz `docker compose` bez
   `sudo` (użytkownik w grupie `docker`), zaloguj się też jako ten użytkownik.
3. Sprawdzenie: `sudo docker pull ghcr.io/maciekgangus/inkroom:main` pobiera obraz.

Token z `read:packages` daje odczyt wszystkich twoich pakietów; trzymaj go tylko na serwerze i
unieważnij w GitHubie, gdyby wyciekł.

```sh
sudo mkdir -p /opt/inkroom && sudo chown "$USER" /opt/inkroom
# skopiuj do /opt/inkroom zawartość folderu deploy/ z repozytorium, np.:
scp -r deploy/* uzytkownik@homelab:/opt/inkroom/
cd /opt/inkroom
cp env.template .env
nano .env          # TUNNEL_TOKEN, TURNSTILE_*, GOOGLE_* (punkt 8), R2_* (klucze kopii, punkt 5); INKROOM_TAG tylko do przypięcia wersji
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

Z poziomu folderu `deploy/` na serwerze. Plik usługi trzeba dopasować: ścieżkę folderu (w pliku jest
`/opt/inkroom`) i **użytkownika** (w pliku `CHANGE_ME`), który ma grupę `docker` i jest zalogowany do
`ghcr.io`, bo inaczej `update.sh` nie pobierze prywatnego obrazu. Dwie podmiany robi `sed`:

```sh
sudo cp inkroom-update.service inkroom-update.timer /etc/systemd/system/
sudo sed -i "s|/opt/inkroom|$PWD|g; s|CHANGE_ME|$USER|" /etc/systemd/system/inkroom-update.service
systemctl cat inkroom-update.service       # sprawdź User= i ścieżki
sudo systemctl daemon-reload
sudo systemctl enable --now inkroom-update.timer
systemctl list-timers inkroom-update.timer
```

Sprawdzenie od razu, bez czekania do nocy:

```sh
sudo systemctl start inkroom-update.service
journalctl -u inkroom-update.service -n 30 --no-pager   # "already up to date (…:latest)"
```

Timer co noc o 4:00 (czas serwera, z losowym opóźnieniem do 10 minut) uruchamia `update.sh`: pobiera
nowsze obrazy (aplikacji i `cloudflared`), podnosi kontener, sprawdza `/healthz` i **sam wraca do
poprzedniego obrazu**, gdy nowy nie wstanie w 30 s. Przypięcie albo cofnięcie wersji:
`INKROOM_TAG=0.1.0 ./update.sh` (lub wpis w `.env`), opis w
[docs/wydawanie-wersji.md](../docs/wydawanie-wersji.md).
Migracje bazy idą tylko do przodu, więc przed wydaniem zmieniającym schemat upewnij się, że kopie R2
działają (punkt 5).

## 5. Kopie zapasowe bazy (Litestream i Cloudflare R2)

ADR 0016. Kontener `litestream` co minutę (jeśli baza się zmieniła) kopiuje bazę do Cloudflare R2
i trzyma kopie z ostatniego tygodnia. **Bez kluczy R2 aplikacja się nie uruchomi** (celowo).

**Jednorazowo w Cloudflare:**
1. R2 (Storage), **Create bucket**, nazwa np. `inkroom-backups`. **Account ID** jest w panelu R2 po prawej.
2. R2, **Manage API tokens**, "Create API token": uprawnienie **Object Read & Write**, zakres **tylko ten
   bucket**. Skopiuj **Access Key ID** i **Secret Access Key** (secret widać tylko raz).
3. Wpisz do `.env`: `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

**Sprawdzenie, że działa:**
```sh
docker compose up -d
docker compose logs litestream | tail     # "replicating to" i brak linii z ERROR
```
Po chwili w bucketcie w panelu R2 pojawią się pliki w katalogu `inkroom/`.

**Serwer z SELinux (Fedora, RHEL; `getenforce` pokazuje Enforcing):** dopisz do `.env`
`COMPOSE_FILE=docker-compose.yml:docker-compose.selinux.yml`, bo bez tego kontenery nie dzielą wolumenu.
Plik `litestream.yml` musi być czytelny dla wszystkich (`chmod 644`, katalog `755`).

**Po awarii serwera (nowa maszyna):** zainstaluj Dockera, skopiuj folder `deploy/` i `.env`, zaloguj Dockera do
`ghcr.io` i `docker compose up -d`. Przed startem aplikacji kontener `litestream-restore` sam sprowadzi
bazę z R2 (gdy na wolumenie jej nie ma).

**Cofnięcie bazy do wybranej chwili** (np. skasowano tablicę z lekcji):
```sh
./restore.sh                         # najnowsza kopia
./restore.sh 2026-11-12T09:30:00Z    # baza z tej chwili (czas UTC), do tygodnia wstecz
```
Skrypt zatrzymuje aplikację, **odkłada obecną bazę** do `/data/before-restore/<data>` (nic nie jest
kasowane), odtwarza bazę i uruchamia wszystko. Wejście do odłożonej bazy: `docker compose run --rm shell ls /data/before-restore`.

**Raz przećwicz odtworzenie na prawdziwym R2** (np. na tymczasowym katalogu z `.env` i innym wolumenem):
kopia, której się nie sprawdziło, nie jest kopią. Lokalnie cały scenariusz sprawdza `sh scripts/test-backup.sh`
(z lokalnym S3 zamiast R2, kilka minut). Plik `.env` (tokeny i klucze) nie jest kopiowany: trzymaj go osobno.

### Uwagi z przycisku „!” (R-062)
Najwygodniej na stronie administratora (sekcja 7). Uwagi użytkowników trafiają do tabeli `feedback` w bazie. Obraz aplikacji nie ma `sqlite3`, więc z konsoli czytaj je
tymczasowym kontenerem na tym samym wolumenie (tylko do odczytu; nazwę wolumenu wyszukuje `docker volume ls`, zwykle `<folder>_data`):

```sh
docker run --rm -v "$(docker volume ls -q | grep _data$ | head -1):/data:ro" alpine sh -c \
  'apk add -q sqlite && sqlite3 -readonly -header -column /data/inkroom.db \
   "SELECT datetime(created,\"unixepoch\") AS kiedy, name, page, screen, message FROM feedback ORDER BY created DESC LIMIT 30"'
```

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

## 7. Strona administratora `/admin` (Cloudflare Access, R-064, ADR 0017)

Strona z listą uwag jest ukryta za logowaniem Cloudflare. Bez poniższej konfiguracji jest wyłączona (adres daje 404).

**Jednorazowo w Cloudflare** (Zero Trust, https://one.dash.cloudflare.com):
1. *Settings, Authentication*: sprawdź metody logowania; wystarczy „One-time PIN” (kod na e-mail), opcjonalnie Google.
2. *Access, Applications, Add an application, Self-hosted*. Nazwa np. „Inkroom admin”. Sesja np. 24 godziny.
3. *Public hostname*: domena `inkroom.lesniakmaciek.dev` i **dwie ścieżki**: `admin` oraz `api/admin` (dodaj drugi hostname z drugą ścieżką; wpisy bez gwiazdki obejmują też to, co pod nimi).
4. *Policy*: akcja **Allow**, reguła *Include, Emails* = Twój adres e-mail. Nic więcej.
5. Zapisz. Na ekranie aplikacji skopiuj **Application Audience (AUD) Tag** (długi ciąg szesnastkowy). Nazwę zespołu znajdziesz w *Settings, Custom Pages* lub w adresie logowania: `<zespół>.cloudflareaccess.com`.

**Na serwerze** dopisz do `.env` (obok `docker-compose.yml`) i uruchom ponownie aplikację (`docker compose up -d`):

```
CF_ACCESS_TEAM_DOMAIN=<zespół>.cloudflareaccess.com
CF_ACCESS_AUD=<AUD Tag>
```

**Sprawdzenie:** wejdź na `https://inkroom.lesniakmaciek.dev/admin`: najpierw strona logowania Cloudflare, po kodzie z e-maila lista uwag. W oknie prywatnym bez logowania nie ma dostępu. Nie działa? W logu aplikacji (`docker compose logs app`) przy starcie powinno nie być wiersza „the admin page is off”; zły AUD albo zespół daje 404 mimo zalogowania.

## 8. Logowanie przez Google (R-063, ADR 0018)

Raz, w przeglądarce (konto Google, które ma być właścicielem aplikacji):

1. <https://console.cloud.google.com/> → utwórz projekt (np. „Inkroom”).
2. **APIs & Services → OAuth consent screen** (w nowym panelu: **Google Auth Platform → Branding / Audience**): typ **External**, nazwa aplikacji „Inkroom”, e-mail pomocy i kontaktowy, domena `lesniakmaciek.dev` jako autoryzowana. Zakresy tylko podstawowe (`openid`, `email`, `profile`), nie wymagają weryfikacji. **Publish app** (z „Testing” na „In production”); w trybie Testing mogą się logować tylko wpisani testerzy.
3. **Clients → Create client** (albo **Credentials → Create credentials → OAuth client ID**): typ **Web application**, nazwa „Inkroom”.
   - Authorized JavaScript origins: nic (przepływ idzie przez serwer).
   - **Authorized redirect URIs:** `https://inkroom.lesniakmaciek.dev/api/auth/google/callback`
   - Do testów lokalnych można dodać też `http://localhost:8099/api/auth/google/callback`.
4. Skopiuj **Client ID** i **Client secret** do `.env` na homelabie (`chmod 600`, nigdy do repo ani czatu):

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
PUBLIC_URL=https://inkroom.lesniakmaciek.dev
```

5. `docker compose up -d` (albo następna aktualizacja z punktu 4). W logach znika „signing in with Google is off”, a na stronach logowania i rejestracji pojawia się „Kontynuuj z Google”.

Konto Google z e-mailem, który ma już konto z hasłem, **przejmuje** to konto: hasło jest wtedy kasowane, a wszystkie sesje kończone (powód w ADR 0018). Nowe konto z Google dostaje nazwę z początku e-maila i nie ma hasła.

## 9. Strony prawne `/privacy` i `/terms` (R-096)

Google wymaga na ekranie zgody OAuth adresów polityki prywatności i regulaminu. Aplikacja ma je od razu: `https://inkroom.lesniakmaciek.dev/privacy` i `https://inkroom.lesniakmaciek.dev/terms` (publiczne, bez logowania i bez JavaScriptu). Dopisz do `.env`, kto prowadzi usługę (nazwa albo firma i e-mail, na który ludzie mogą pisać w sprawie swoich danych):

```
OPERATOR_NAME=Imię i nazwisko albo nazwa firmy
CONTACT_EMAIL=adres@do-kontaktu.pl
```

Potem `docker compose up -d` (albo następna aktualizacja). Bez tych dwóch zmiennych strony działają, ale zamiast operatora pokazują „Dane operatora nie zostały jeszcze uzupełnione”, a w logu jest ostrzeżenie; Google takiej strony nie przyjmie, więc uzupełnij przed publikacją aplikacji (punkt 8.2). Pola ekranu zgody: *Application home page* `https://inkroom.lesniakmaciek.dev/`, *Privacy policy link* `https://inkroom.lesniakmaciek.dev/privacy`, *Terms of service link* `https://inkroom.lesniakmaciek.dev/terms`, a domena `lesniakmaciek.dev` jako autoryzowana. Teksty są w `server/cmd/server/legal/`; po zmianie podbij `legalUpdated` w `legal.go`.

## 10. Logi i metryki aplikacji (R-098, ADR 0022)

Aplikacja pisze logi JSON na stdout (pola `time`, `level`, `msg`, `service`, `request_id`, dla żądań
`method`, `path`, `status`, `duration_ms`). Każda usługa w `docker-compose.yml` ma rotację logów
Dockera (10 MB × 5), więc dysk się nie zapełni.

```sh
docker compose logs -f app                                          # na żywo
docker compose logs app | jq 'select(.level=="ERROR")'             # same błędy
docker compose logs app | jq 'select(.service=="client")'          # błędy z przeglądarek
docker compose logs app --since 1h | jq -r 'select(.level!="DEBUG") | [.time,.level,.msg,.path,.status] | @tsv'
```

- `LOG_LEVEL` w `.env` (`debug`, `info`, `warn`, `error`; domyślnie `info`). Na `debug` widać każde
  żądanie, nie tylko błędy i wolne.
- `/metrics` (Prometheus) jest na porcie `METRICS_ADDR` (domyślnie `:9100` wewnątrz kontenera). Port
  **nie jest publikowany** i nie idzie przez tunel; widzą go tylko kontenery w tej samej sieci
  compose. Podgląd z maszyny: `docker compose exec app wget -qO- http://127.0.0.1:9100/metrics`
  (obraz aplikacji nie ma powłoki, więc jeśli to nie działa, użyj kontenera `busybox` z tej samej sieci:
  `docker run --rm --network workdir_default busybox wget -qO- http://app:9100/metrics`).
  `METRICS_ADDR=` (pusty) wyłącza endpoint.
- Błędy z przeglądarek uczniów trafiają do tego samego logu jako `"service":"client"` (strona bez
  numeru tablicy, rozmiar okna, przeglądarka). Adresów IP, e-maili ani nazw użytkowników w logach nie ma.

Zbieranie logów i metryk w jednym miejscu z alertami na Telegram to Etap 2 (ADR 0023).

## Gdy coś nie działa

| Objaw | Co sprawdzić |
|---|---|
| `docker compose` mówi "required variable TUNNEL_TOKEN is missing" | brak `TUNNEL_TOKEN` w `.env` (plik musi leżeć obok `docker-compose.yml`) |
| Cloudflare pokazuje 502 | trasa w tunelu ma zły adres usługi; musi być `http://app:8080`; `docker compose ps` czy `app` działa |
| `cloudflared` w logach: "Unauthorized" albo "failed to connect" | zły lub unieważniony token; wygeneruj nowy w panelu tunelu |
| Strona się otwiera, ale rejestracja nie działa | brak `TURNSTILE_SECRET` (rejestracja jest wtedy zamknięta) albo klucze dla innej domeny |
| Google: „Błąd 400: redirect_uri_mismatch” | adres w konsoli Google musi być dokładnie `PUBLIC_URL` + `/api/auth/google/callback` (https, bez ukośnika na końcu) |
| Google: „Access blocked” albo logują się tylko testerzy | ekran zgody nadal w trybie „Testing”; opublikuj aplikację (punkt 8.2) |
| Przycisk Google się nie pojawia | brak `GOOGLE_CLIENT_ID` lub `GOOGLE_CLIENT_SECRET` w `.env` (sprawdź `docker compose logs app`) |
| Rysowanie nie synchronizuje się | WebSocket: sprawdź w konsoli przeglądarki `/ws/...`; tunel wspiera WebSocket, więc zwykle to zła trasa |
| `unauthorized` albo `denied` przy pobieraniu obrazu | Docker nie jest zalogowany do `ghcr.io` (dla użytkownika, który to uruchamia, a timer to root) albo token wygasł lub nie ma `read:packages`; powtórz "Logowanie do rejestru" |
| `update.sh` kończy się błędem | `docker compose logs app`; skrypt sam wraca do poprzedniego obrazu, a log mówi, który nie wstał |

## Testy skryptów

`sh deploy/test-update.sh` sprawdza `update.sh` na atrapach `docker` i `curl` (bez Dockera); CI
uruchamia go przy każdej zmianie, a także sprawdza, że `docker-compose.yml` czyta się z tokenem
i odmawia startu bez niego.
