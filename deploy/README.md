# Wdrożenie na VPS (obraz z GitHub Container Registry)

Zob. ADR 0014. Aplikację buduje GitHub Actions i publikuje jako `ghcr.io/maciekgangus/inkroom`;
VPS tylko ją pobiera.

## Wydanie nowej wersji

```sh
git tag v0.1.0 && git push --tags     # po zmergowaniu zmian do main
```

Workflow testuje, buduje obraz i nadaje mu tagi `0.1.0`, `0.1` i `latest`. VPS aktualizuje się sam
następnej nocy o 4:00, albo od razu: `sudo systemctl start inkroom-update.service`.
Każdy merge do `main` daje też obraz `:main` i `:sha-<commit>` (do wglądu, VPS ich nie śledzi).

## Pierwsze uruchomienie na VPS (raz)

1. Na GitHubie: repozytorium, Packages, pakiet `inkroom`, Package settings, ustaw **Public**
   (pierwsza publikacja tworzy go jako prywatny). Bez tego trzeba zalogować Dockera na VPS
   tokenem `read:packages`.
2. Skopiuj folder `deploy/` na serwer, np. do `/opt/inkroom`, i utwórz tam `.env` (poza repo,
   nigdy w obrazie):
   ```
   TURNSTILE_SITE_KEY=...
   TURNSTILE_SECRET=...
   ```
   (klucze z panelu Cloudflare, widżet Turnstile dla Twojej domeny, ADR 0013).
3. Pierwsze podniesienie: `cd /opt/inkroom && ./update.sh`.
4. Timer:
   ```sh
   sudo cp inkroom-update.service inkroom-update.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now inkroom-update.timer
   systemctl list-timers inkroom-update.timer
   ```
   Jeśli folder jest gdzie indziej niż `/opt/inkroom`, popraw ścieżki w `inkroom-update.service`.

## Wycofanie i przypięcie wersji

`update.sh` sam wraca do poprzedniego obrazu, gdy nowy nie wstanie w 30 s. Ręcznie:

```sh
INKROOM_TAG=0.0.9 ./update.sh        # konkretne wydanie
INKROOM_TAG=sha-1a2b3c4 ./update.sh  # konkretny commit z main
```

Uwaga: migracje bazy idą tylko do przodu. Przed wydaniem zmieniającym schemat zrób kopię
wolumenu `data`.

## Testy skryptu

`sh deploy/test-update.sh` sprawdza `update.sh` na atrapach `docker` i `curl` (bez Dockera):
bez zmian, udana aktualizacja, nieudana z powrotem do poprzedniej, pierwsza instalacja.
CI uruchamia go przy każdej zmianie.
