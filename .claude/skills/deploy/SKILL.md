---
name: deploy
description: Wydanie Inkroom na homelab (tag vX.Y.Z, obraz GHCR, aktualizacja serwera). Uruchamiany tylko ręcznie przez /deploy.
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(git status*), Bash(git log*), Bash(git tag -l*), Bash(git fetch*), Bash(gh run list*), Bash(gh pr list*)
---

# Wydanie na homelab

Źródło prawdy: `docs/wydawanie-wersji.md` (tag, obraz, cofanie), `deploy/README.md` (serwer), ADR 0014, 0003, 0016. Merge do `main` niczego nie wdraża: wdraża dopiero tag `vX.Y.Z`. **Nie wykonuj kroków oznaczonych WYMAGA ZGODY bez wyraźnego „tak” w tej rozmowie.** Tag raz wypchnięty uruchamia publikację obrazu `:latest`, który serwer pobiera nocą.

## 1. Przed tagiem (tylko odczyt)
- [ ] `git fetch origin && git status`: jesteś na `main`, bez zmian, równo z `origin/main`.
- [ ] `gh pr list -R maciekgangus/inkroom`: brak otwartych PR-ów, które mają wejść do wydania.
- [ ] `gh run list -R maciekgangus/inkroom --branch main --limit 3`: ostatni przebieg `image` zielony (`test`, `image`, `scan`). Czerwony `scan` blokuje też wydanie z tagu.
- [ ] `git tag -l 'v*' --sort=-v:refname | head -3`: ostatni numer; zaproponuj następny wg tabeli semver z `docs/wydawanie-wersji.md`.
- [ ] Czy w wydaniu jest **nowa migracja** (`server/internal/store/store.go`, lista `migrations`)? Idzie tylko do przodu, starsza wersja jej nie obsłuży. Wtedy sprawdź kopie R2: `docker compose logs litestream | tail` na serwerze (patrz TODO).
- [ ] Czy zmieniał się folder `deploy/`? Wtedy `docker-compose.yml`, `litestream.yml`, skrypty i jednostki systemd trzeba skopiować na serwer ręcznie (sekcja 6 `docs/wydawanie-wersji.md`), tag ich nie zaktualizuje.
- [ ] Czy zmieniały się sekrety lub zmienne (`deploy/env.template`)? `.env` na serwerze edytuje się ręcznie.

## 2. Tag i obraz (WYMAGA ZGODY)
Pokaż użytkownikowi numer i opis, poczekaj na „tak”, dopiero potem:
```sh
git tag -a vX.Y.Z -m "krótki opis" && git push origin vX.Y.Z
```
Wypychaj **jeden tag**, nigdy `git push --tags`. Push na tej maszynie: `git -c credential.helper='!gh auth git-credential' push origin vX.Y.Z`.

## 3. Po tagu (tylko odczyt)
- [ ] `gh run list --workflow image --limit 3`: przebieg tagu (`test`, `image`, `scan`) kończy się sukcesem. Przy awarii po stronie GitHuba: `gh run rerun <id> --failed` (WYMAGA ZGODY).
- [ ] Serwer dostaje wersję o 4:00 (timer `inkroom-update.timer`) albo od razu: `sudo systemctl start inkroom-update.service` na homelabie (WYMAGA ZGODY, to robi użytkownik).
- [ ] Weryfikacja na serwerze: `journalctl -u inkroom-update.service -n 20 --no-pager` ma pokazać `updated to … inkroom:latest`, a `docker compose ps` zdrowe usługi. `update.sh` sam wraca do poprzedniej wersji, gdy nowa nie wstanie w 30 s.

## 4. Cofnięcie
Nie kasuj tagów ani obrazów. `INKROOM_TAG=<poprzednia> ./update.sh` na serwerze, potem wydaj poprawkę. Szczegóły: sekcja 5 `docs/wydawanie-wersji.md`.

## TODO do uzupełnienia z użytkownikiem
- Nazwa hosta / sposób wejścia na homelab (SSH?) i katalog roboczy (`~/workdir`?): w repo jest tylko ścieżka z dokumentacji, nie wiadomo, czy jest aktualna.
- Czy po wydaniu sprawdzamy coś jeszcze (np. alert „Aplikacja nie odpowiada” w Grafanie na maszynie `rpi-server`, ADR 0024).
- Czy wydanie ma wymagać ręcznego przejścia przez `/test-server` (hook przypomina o tym przed `gh pr create`).
