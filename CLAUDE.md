# IDROO: współdzielona tablica do korepetycji (MVP)

Własna, tania tablica interaktywna do prowadzenia korepetycji online, zamiennik płatnego IDROO.
Źródło prawdy o wymaganiach: @SPEC.md. Decyzje architektoniczne: `docs/decisions/`.

## Stan projektu
Wszystkie wymagania z `SPEC.md` są zrobione poza R-005 (Android z rysikiem i tablet graficzny do sprawdzenia na sprzęcie) i R-043 (wydajność dużych tablic, po pomiarach). Stos: własny canvas + Go + SQLite, klient TypeScript + Preact (ADR 0001), synchronizacja ADR 0004. Wdrożenie na homelab: obraz z GHCR i Cloudflare Tunnel (ADR 0003 i 0014, folder `deploy/`). Do zrobienia: kopie zapasowe bazy (Litestream) i pierwsza lekcja (Etap 4).

## Priorytety (w tej kolejności)
1. Responsywność: kreska pojawia się natychmiast lokalnie, u drugiej osoby bez zauważalnego opóźnienia. Wygoda użytkownika ponad wszystko.
2. Działa na iPadach i innych tabletach z rysikiem, nie tylko na PC (korepetytor pracuje na PC, uczniowie często na tabletach).
3. Oszczędność CPU na serwerze. RAMu jest dużo, procesora mało.
4. Jeśli istnieje warta uwagi gotowa biblioteka tablicy, użyj jej zamiast pisać własną.

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
- Testy: `cd server && go test ./...` oraz `cd web && npm test`; testy iPada (układ, rysik, dotyk) w Playwright: `cd web && npx playwright install chromium` (raz) i `npm run test:e2e` (Chromium) oraz `npm run test:e2e:webkit` (WebKit w kontenerze podman, ADR 0012)
- Lint i format: `cd server && gofmt -l . && go vet ./...` oraz `cd web && npx biome check .`

## Konwencje
- Kod, nazwy, komentarze i commit messages po angielsku. Dokumenty (`SPEC.md`, ADR, README) po polsku.
- Małe commity, jeden po każdej działającej części. Commituj po przejściu testów i moim przeglądzie diffu.
- Nie czytaj ani nie ruszaj plików `.env`.
- Lokalnie `docker compose up` ładuje `docker-compose.override.yml`, który tworzy publiczne konto testowe (`test@example.test`, hasło w tym pliku). Na serwerze uruchamiać z jawnym `-f docker-compose.yml`, żeby tego konta tam nie było.
- Rejestracja wymaga captchy Cloudflare Turnstile (ADR 0013): lokalnie `docker-compose.override.yml` ma opublikowane klucze testowe, na serwerze trzeba ustawić `TURNSTILE_SITE_KEY` i `TURNSTILE_SECRET` w `.env` (bez sekretu rejestracja jest zamknięta). Logowanie: e-mail lub nazwa użytkownika; konto testowe `test@example.test` loguje się też jako `test`.
- Obraz i wydania (ADR 0014): GitHub Actions testuje i publikuje `ghcr.io/maciekgangus/inkroom` (`:main` i `:sha-<commit>` z `main`, `:latest` i `:X.Y.Z` z tagu `vX.Y.Z`); VPS (homelab) śledzi `:latest` przez timer z `deploy/`; tunel Cloudflare i instrukcja: `deploy/README.md`, ADR 0003. Wydanie: `git tag vX.Y.Z && git push --tags` po zmergowaniu do `main`. Skrypty VPS testuje `sh deploy/test-update.sh`.
- Wdrożenie: docker compose, najpierw lokalnie, później na domowym VPS (ADR 0002). Sekrety w `.env`, nigdy w obrazach ani w repo.
- Plugin lub serwer MCP dodawaj dopiero pod konkretny problem, a po dodaniu sprawdź `/context`.

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)

### Git worktrees i graf
Każdy agent pracuje we własnym `git worktree` (np. `git worktree add ../inkroom-<temat> -b feature/<temat> origin/main`), a katalog główny zostaje na `main`. `graphify-out/` jest w `.gitignore`, więc nowy worktree dostaje graf przez kopię: `cp -r ../inkroom/graphify-out ./graphify-out`. Po zmergowaniu do `main` graf odbudowuje się w katalogu głównym (`graphify update .`), a worktree kopiują go na nowo. Nowe numery wymagań i ADR rezerwuj po sprawdzeniu `origin/main` i otwartych PR-ów (`gh pr list`), żeby uniknąć kolizji.
