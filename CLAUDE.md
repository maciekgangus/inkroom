# IDROO: współdzielona tablica do korepetycji (MVP)

Własna, tania tablica interaktywna do prowadzenia korepetycji online, zamiennik płatnego IDROO.
Źródło prawdy o wymaganiach: @SPEC.md. Decyzje architektoniczne: `docs/decisions/`.

## Stan projektu
Etapy 0 do 3 zakończone (szkielet, tablica lokalna, współpraca na żywo, konta i zapis): stos w `docs/decisions/0001-stack.md` (własny canvas + Go + SQLite), protokół w `docs/decisions/0004-sync-protocol.md`, konta i zapis w `docs/decisions/0005-accounts-and-persistence.md`, plany w `docs/plan-stage-*.md`. Zrobione też R-010 (nieskończone płótno, plan w `docs/plan-infinite-canvas.md`) R-012 (kształty i tekst, ADR 0006, plan w `docs/plan-shapes-and-text.md`), R-013 (kursory, plan w `docs/plan-cursors.md`) R-015 (obrazy, ADR 0007, plan w `docs/plan-images.md`) oraz R-021 i R-022 (model obiektów: zaznaczanie, przekształcenia i style, ADR 0008, plan w `docs/plan-object-model.md`). Przebudowa interfejsu (ikony, zaokrąglone powierzchnie) oraz R-025 (rozszerzona paleta), R-026 (tryb ciemny) i R-027 (wspólne tło tablicy), ADR 0010. Kolejne wymagania P2/P3 według `SPEC.md`; wdrożenie (Etap 3.5, ADR 0003) i pierwsza lekcja (Etap 4) na koniec.

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
