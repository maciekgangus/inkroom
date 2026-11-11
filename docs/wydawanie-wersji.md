# Wydawanie nowej wersji aplikacji (obraz i tagi)

Krótko: **merge do `main` niczego nie wdraża.** Serwer dostaje nową wersję dopiero wtedy, gdy założysz **tag** `vX.Y.Z`. GitHub Actions zbuduje wtedy obraz, a homelab pobierze go nocą (ADR 0014).

## 1. Wybierz numer

Numeracja `vGŁÓWNA.POBOCZNA.POPRAWKA` (semver):

| Co się zmieniło | Numer | Przykład |
|---|---|---|
| poprawka błędu | zwiększ ostatnią cyfrę | `v0.1.0` → `v0.1.1` |
| nowa funkcja, nic się nie psuje | zwiększ środkową, ostatnią zeruj | `v0.1.1` → `v0.2.0` |
| zmiana niezgodna wstecz, albo uznajesz aplikację za dojrzałą | zwiększ pierwszą | `v0.9.0` → `v1.0.0` |

Ostatnie wydania: `git tag -l 'v*' --sort=-v:refname | head -3`.

## 2. Załóż i wypchnij tag

Na swoim komputerze, na `main`, po zmergowaniu zmian:

```sh
git checkout main && git pull
git tag -a v0.1.1 -m "krótki opis, co się zmieniło"
git push origin v0.1.1
```

Wypychaj **jeden konkretny tag** (`git push origin vX.Y.Z`), nie `git push --tags`, które wysyła wszystkie.

## 3. Co robi GitHub Actions

Tag uruchamia workflow `image` (`.github/workflows/image.yml`): najpierw testy (serwer, klient, skrypty wdrożenia), potem budowa i wysłanie obrazu `ghcr.io/maciekgangus/inkroom`. Obraz dostaje tagi:

| Tag obrazu | Znaczenie | Zmienia się? |
|---|---|---|
| `0.1.1` | dokładnie to wydanie | nie |
| `0.1` | najnowsze `0.1.x` | tak, przesuwa się na każde `0.1.y` |
| `latest` | ostatnie wydanie, **to śledzi serwer** | tak |
| `sha-1a2b3c4` | konkretny commit | nie |

Zwykły merge do `main` daje tylko `main` i `sha-…`, nigdy `latest`.

Obserwuj budowę: `gh run list --workflow image --limit 3` i `gh run watch`, albo zakładka **Actions** na GitHubie. Awaria po stronie GitHuba (np. "No server is currently available") bywa chwilowa: `gh run rerun <id> --failed`.

Sprawdzenie, że obraz jest w rejestrze (pakiet jest prywatny, więc po `docker login ghcr.io`): `docker manifest inspect ghcr.io/maciekgangus/inkroom:0.1.1`.

## 4. Kiedy serwer to dostanie

- **Automatycznie** tej nocy o 4:00 (timer `inkroom-update.timer`, losowe opóźnienie do 10 minut).
- **Od razu:** na homelabie `sudo systemctl start inkroom-update.service`.
- **Sprawdzenie:** `journalctl -u inkroom-update.service -n 20 --no-pager` (ma być `updated to … inkroom:latest`) i `docker compose ps`.

Skrypt `update.sh` sam wraca do poprzedniej wersji, gdy nowa nie wstanie w 30 s, i kończy się błędem widocznym w `journalctl`.

## 5. Cofnięcie wersji

Nie kasuj tagów ani obrazów. Wskaż serwerowi starszą wersję, a potem wydaj poprawkę (`v0.1.2`):

```sh
cd ~/workdir
INKROOM_TAG=0.1.0 ./update.sh        # jednorazowo
# albo na stałe: dopisz INKROOM_TAG=0.1.0 do .env; usuń tę linię, żeby wrócić do :latest
```

## 6. Czego to nie dotyczy

- **Zmiany w folderze `deploy/`** (plik compose, `litestream.yml`, skrypty, jednostki systemd) **nie aktualizują się same**, bo na serwerze jest tylko kopia folderu. Po zmianie skopiuj go (plik `.env` jest bezpieczny, bo nie jest w repozytorium) i podnieś usługi:
  ```sh
  git clone --depth 1 https://github.com/maciekgangus/inkroom.git /tmp/inkroom-src
  cp -r /tmp/inkroom-src/deploy/. ~/workdir/ && rm -rf /tmp/inkroom-src
  cd ~/workdir && docker compose up -d
  ```
  Jeśli zmieniły się pliki `inkroom-update.*`, skopiuj je też do `/etc/systemd/system/` i zrób `sudo systemctl daemon-reload`.
- **Zmiana schematu bazy** (nowa migracja) idzie tylko do przodu: starsza wersja aplikacji może jej nie obsłużyć. Przed takim wydaniem upewnij się, że kopie w R2 działają (`docker compose logs litestream | tail`).
- **Zmiany w Cloudflare** (trasa tunelu, klucze) robi się w panelu i w `.env`, nie tagiem.
