# Inkroom: współdzielona tablica i kalendarz zajęć do korepetycji

Własna, tania tablica interaktywna do prowadzenia korepetycji online (zamiennik płatnego IDROO) z kalendarzem zajęć. Jedna aplikacja, jedna baza SQLite, jedno konto.
Źródło prawdy o wymaganiach: @SPEC.md. Decyzje architektoniczne: `docs/decisions/`.

## Stan projektu
Tablica działa na homelabie (https://inkroom.lesniakmaciek.dev, obraz z GHCR, tunel Cloudflare, kopie Litestream do R2). Stan wymagań jest w `SPEC.md` (tylko tam, nie tutaj), decyzje w `docs/decisions/`, wydania w `docs/wydawanie-wersji.md`. W toku: kalendarz zajęć (R-104 do R-109, ADR 0025) na gałęzi `feature/calendar`, wydajność dużych tablic (R-043), logowanie Google (R-063, czeka na test).

## Priorytety (w tej kolejności)
1. Responsywność: kreska pojawia się natychmiast lokalnie, u drugiej osoby bez zauważalnego opóźnienia. Wygoda użytkownika ponad wszystko.
2. Działa na iPadach i innych tabletach z rysikiem, nie tylko na PC (korepetytor pracuje na PC, uczniowie często na tabletach).
3. Jeśli istnieje warta uwagi gotowa biblioteka tablicy, użyj jej zamiast pisać własną.

Serwer prawie nie zużywa CPU (obliczenia są po stronie klienta), a maszyna ma 100 GB dysku i 8 GB RAM (do 16 GB), więc zasoby serwera nie ograniczają wyboru narzędzi (logi, metryki, mikroserwisy).

## Zasady pracy
1. Najpierw myśl: wypisz założenia, a przy niejasności zapytaj zamiast zgadywać.
2. Prostota: najmniej kodu, który rozwiązuje zadanie. Bez abstrakcji "na zapas".
3. Chirurgiczne zmiany: ruszaj tylko to, co potrzebne do zadania. Nie refaktoryzuj przy okazji.
4. Cel i weryfikacja: zadanie kończy się przechodzącymi testami. Najpierw test, potwierdź że pada, potem implementacja.
5. Wymagania: przed implementacją sprawdź `SPEC.md`. Nowe lub zmienione wymaganie najpierw jako propozycja zmiany w `SPEC.md`, kod dopiero po mojej akceptacji.
6. Decyzje architektoniczne zapisuj jako ADR w `docs/decisions/` (szablon: `0000-template.md`).

## Komendy
Stos: serwer w Go (`server/`), klient w TypeScript + Vite + Preact (`web/`). Komendy poniżej sprawdzone na szkielecie z Etapu 0 (poza `npm run dev`). Serwer czyta `PORT` (domyślnie 8080) i `STATIC_DIR` (domyślnie `../web/dist`), więc do dev serwera najpierw `cd web && npm run build`.
- Uruchomienie całości: `docker compose up` (ADR 0002)
- Build obrazu: `docker compose build`
- Dev klienta: `cd web && npm run dev`; dev serwera: `cd server && go run ./cmd/server`
- Testowanie lokalne z logami (Loki, Grafana, alerty w atrapie Telegrama): `sh .claude/skills/test-server/server.sh start 8099 --logs`, przewodnik w `docs/testowanie-lokalne.md`
- Testy: `cd server && go test ./...` oraz `cd web && npm test`; testy iPada (układ, rysik, dotyk) w Playwright: `cd web && npx playwright install chromium` (raz) i `npm run test:e2e` (Chromium) oraz `npm run test:e2e:webkit` (WebKit w kontenerze podman, ADR 0012)
- Środowisko tej maszyny: Go 1.26 w `~/.local/go` i `gopls` w `~/go/bin` (dodane do `PATH` w `~/.bashrc`), `graphify` z `uv tool` (`graphifyy`). CPU maszyny (QEMU) nie ma AVX, więc `vite` i `vitest` (rolldown) kończą się „Illegal instruction”: lokalnie działają `go test`, `npx tsc --noEmit` i `npx biome check`, a testy i build klienta trzeba puszczać w CI albo na maszynie z AVX. Hook `post-edit.sh` puszcza `npm test` i tu milczy zamiast zgłosić błąd, więc nie traktuj jego ciszy jako zielonego wyniku.
- Lint i format: `cd server && gofmt -l . && go vet ./...` oraz `cd web && npx biome check .`

## Konwencje
- Kod, nazwy, komentarze i commit messages po angielsku. Dokumenty (`SPEC.md`, ADR, README) po polsku.
- Małe commity, jeden po każdej działającej części. Commituj po przejściu testów i moim przeglądzie diffu.
- Nie czytaj ani nie ruszaj plików `.env`.
- Lokalnie `docker compose up` ładuje `docker-compose.override.yml`, który tworzy publiczne konto testowe (`test@example.test`, hasło w tym pliku). Na serwerze uruchamiać z jawnym `-f docker-compose.yml`, żeby tego konta tam nie było.
- Rejestracja wymaga captchy Cloudflare Turnstile (ADR 0013): lokalnie `docker-compose.override.yml` ma opublikowane klucze testowe, na serwerze trzeba ustawić `TURNSTILE_SITE_KEY` i `TURNSTILE_SECRET` w `.env` (bez sekretu rejestracja jest zamknięta). Logowanie: e-mail lub nazwa użytkownika; konto testowe `test@example.test` loguje się też jako `test`.
- Obraz i wydania (ADR 0014): GitHub Actions testuje i publikuje `ghcr.io/maciekgangus/inkroom` (`:main` i `:sha-<commit>` z `main`, `:latest` i `:X.Y.Z` z tagu `vX.Y.Z`); serwer śledzi `:latest`. **Merge do `main` niczego nie wdraża**: wydanie to `git tag -a vX.Y.Z -m "opis" && git push origin vX.Y.Z` (dokładny opis, cofanie i kopiowanie folderu `deploy/`: `docs/wydawanie-wersji.md`). Homelab: `deploy/README.md`, ADR 0003 i 0016; skrypty testują `sh deploy/test-update.sh` i `sh scripts/test-backup.sh`.
- Wdrożenie: docker compose, najpierw lokalnie, później na domowym VPS (ADR 0002). Sekrety w `.env`, nigdy w obrazach ani w repo.
- Plugin lub serwer MCP dodawaj dopiero pod konkretny problem, a po dodaniu sprawdź `/context`.

## Kalendarz zajęć (R-104 do R-109, ADR 0025)
Kalendarz jest w tej samej bazie SQLite i na tym samym koncie co tablice. Nie ma ról na koncie: prowadzącym jest ten, kto tworzy zajęcie. Moduły są rozdzielone w kodzie, nie w sieci.
- `server/internal/calendar/series.go`: rozwija regułę serii na zajęcia (strefa IANA, godzina trzyma się po zmianie czasu, najwyżej 200).
- `server/internal/store/calendar.go`: tabele `lessons`, `lesson_series`, `unavailability`, `lesson_requests`. Konflikt terminu (`ErrConflict`) sprawdza się w tej samej transakcji co zapis; zajęcia odwołane nie blokują terminu.
- `server/cmd/server/lessons.go`: API (`/api/calendar`, `/api/lessons`, `/api/series`, `/api/unavailability`, `/api/requests`). Zmienia i usuwa tylko prowadzący, prośbę o zmianę terminu składa każda strona.
- Klient: `web/src/calendar-page.tsx` (trasa `/calendar`), na razie bez projektu graficznego.
- Migracje dopisuje się wyłącznie na końcu listy `migrations` w `store.go`.
- Ekorepetycje (stary projekt w Pythonie) są poza repozytorium, w `~/ekorepetycje-wzor`, tylko jako wzór funkcji. Strona główna, kontakt, czat AI, AWS i Terraform są poza zakresem (R-109).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. When the answer is under a Markdown heading, `graphify section "<heading>"` prints that section's text, so the .md need not be opened. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.

### Git worktrees i graf
Każdy agent pracuje we własnym `git worktree` (np. `git worktree add ../<repo>-<temat> -b feature/<temat> origin/main`), a katalog główny zostaje na `main`. `graphify-out/` jest w `.gitignore`, więc nowy worktree dostaje graf przez kopię: `cp -r <główny katalog>/graphify-out ./graphify-out`. Po zmergowaniu do `main` graf odbudowuje się w katalogu głównym (`graphify update .`), a worktree kopiują go na nowo. Nowe numery wymagań i ADR rezerwuj po sprawdzeniu `origin/main` i otwartych PR-ów (`gh pr list`), żeby uniknąć kolizji.
