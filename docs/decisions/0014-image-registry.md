# 0014. Obraz aplikacji w GitHub Container Registry i aktualizacja VPS

- Status: accepted
- Data: 2026-11-11

## Kontekst
Aplikacja ma działać na domowym VPS (ADR 0002, Etap 3.5), a serwer nie ma budować jej ze źródeł: ma pobierać gotowy obraz. Dotąd nie było żadnego CI ani rejestru; `docker-compose.yml` buduje obraz lokalnie (`build: .`). Repozytorium jest publiczne, więc GitHub Actions i GHCR są dla niego bezpłatne.

## Decyzja
- **Rejestr:** `ghcr.io/maciekgangus/inkroom`, publikowany z GitHub Actions (`.github/workflows/image.yml`) kontem `GITHUB_TOKEN` z uprawnieniem `packages: write`, bez własnych sekretów.
- **Co uruchamia workflow:**
  - pull request: tylko testy (gofmt, `go vet`, `go test`, test skryptu aktualizacji, `biome check`, `npm test`, `npm run build`), nic nie jest publikowane;
  - push do `main`: testy, potem obraz `:main` i `:sha-<commit>`;
  - tag git `v*` (np. `v0.1.0`): testy, potem obraz `:0.1.0`, `:0.1` i `:latest`.
  Obraz powstaje dopiero po przejściu testów. Platforma: `linux/amd64` (VPS jest amd64; Dockerfile buduje natywnie, bez emulacji). Cache warstw w GitHub Actions.
- **`:latest` to zawsze ostatnie wydanie**, nigdy `main`. VPS śledzi `:latest`, więc produkcja zmienia się dopiero po oznaczeniu wydania (`git tag v0.1.0 && git push --tags`); każdy commit z `main` jest do wglądu jako `:sha-<commit>` i `:main`.
- **VPS** dostaje folder `deploy/` (compose bez `build`, plik `.env` poza repo, skrypt `update.sh`, jednostki systemd). Aktualizację robi **timer systemd** codziennie o 4:00 (`inkroom-update.timer`, z losowym rozrzutem i `Persistent=true`), który uruchamia `update.sh`: `docker compose pull`, podniesienie kontenera, kontrola `/healthz`. Gdy nowy obraz nie wstaje w 30 s, skrypt wraca do poprzedniego (zapisanego pod tagiem `previous`) i kończy się błędem. Brak Watchtowera, więc nic nie ma dostępu do gniazda Dockera poza `docker compose` uruchamianym przez timer.
- **Ręcznie:** `deploy/update.sh` można uruchomić w dowolnej chwili; wersję przypina się zmienną `INKROOM_TAG` (np. `sha-1a2b3c4` albo `0.1.0`), co jest też sposobem na wycofanie.
- **Widoczność pakietu: prywatny** (decyzja użytkownika 2026-11-11; pierwsza publikacja z publicznego repozytorium dała pakiet publiczny, więc trzeba go przełączyć na "Private" w ustawieniach pakietu na GitHubie, bo przez API się tego nie robi). Workflow publikuje dalej tokenem `GITHUB_TOKEN` (pakiet jest powiązany z repozytorium etykietą obrazu `org.opencontainers.image.source`). VPS pobiera obraz po zalogowaniu: `docker login ghcr.io` z osobistym tokenem klasycznym z zakresem `read:packages` (sposób w `deploy/README.md`); dane logowania Docker zapisuje w katalogu domowym użytkownika, który uruchamia `update.sh` (timer systemd działa jako root, więc logowanie robi się przez `sudo`).

## Rozważane opcje
1. Wdrożenie z Actions przez SSH na VPS: wymaga otwartego SSH, a N-004 mówi, że serwer domowy nie otwiera portów na zewnątrz. Odrzucone.
2. Watchtower: wygodny, ale to kontener z dostępem do Dockera i wersja zmieniająca się bez kontroli o dowolnej porze; użytkownik wybrał własny timer.
3. Obraz dla amd64 i arm64: dłuższy build bez potrzeby, VPS jest amd64. Do dodania, gdyby się to zmieniło (`platforms:` w workflow).

## Konsekwencje
- **Token do pobierania:** klasyczny token osobisty z `read:packages` daje odczyt wszystkich pakietów, do których konto ma dostęp (GitHub nie ma węższych tokenów do GHCR), więc ma go tylko serwer i jest w `~/.docker/config.json` roota; przy wycieku trzeba go unieważnić i wygenerować nowy. Gdyby kont było więcej, lepiej założyć osobne konto techniczne do odczytu.
- **Bez logowania obraz się nie pobierze:** `docker pull` i `docker compose pull` kończą się "unauthorized"; `update.sh` mówi wtedy wprost, że chodzi o logowanie do `ghcr.io`.
- Migracje bazy idą tylko do przodu (`PRAGMA user_version`): wycofanie obrazu po migracji nowszej wersji zostawia bazę w nowym schemacie, który stary kod może zignorować lub odrzucić. Wydania ze zmianą schematu trzeba robić ostrożnie (najpierw kopia wolumenu `data`, ADR 0002).
- Workflow zawiera `biome check`, więc błąd lintera blokuje scalenie. Poprawiłem jedyny istniejący błąd (`properties-panel.tsx`) i wykluczyłem `public/` z lintera (pliki marki są dostarczone gotowe).
- Testy e2e (Playwright) nie są częścią CI: wymagają przeglądarek i kontenera WebKit (ADR 0012); zostają w ręcznej weryfikacji. Można je dodać osobnym zadaniem.
- Akcje są przypięte do wersji głównych (`@v4` itd.), nie do skrótów commitów; to można zaostrzyć, jeśli będzie taka potrzeba.
