# Inkroom: współdzielona tablica i kalendarz zajęć do korepetycji

Własna, tania tablica interaktywna do prowadzenia korepetycji online (zamiennik płatnego IDROO) z kalendarzem zajęć. Jedna aplikacja, jedna baza SQLite, jedno konto.
Źródło prawdy o wymaganiach: @SPEC.md. Decyzje architektoniczne: `docs/decisions/`.

## Stan projektu
Tablica działa na homelabie (https://inkroom.lesniakmaciek.dev, obraz z GHCR, tunel Cloudflare, kopie Litestream do R2). Stan wymagań jest w `SPEC.md` (tylko tam, nie tutaj), decyzje w `docs/decisions/`, wydania w `docs/wydawanie-wersji.md`. W toku: kalendarz zajęć (R-104 do R-109, ADR 0025, backend zmergowany, klient tymczasowy), wydajność dużych tablic (R-043), logowanie Google (R-063, czeka na test).

## Priorytety (w tej kolejności)
1. Responsywność: kreska pojawia się natychmiast lokalnie, u drugiej osoby bez zauważalnego opóźnienia. Wygoda użytkownika ponad wszystko.
2. Działa na iPadach i innych tabletach z rysikiem, nie tylko na PC (korepetytor pracuje na PC, uczniowie często na tabletach).

## Zasady pracy
1. Najpierw myśl: wypisz założenia, a przy niejasności zapytaj zamiast zgadywać.
2. Prostota: najmniej kodu, który rozwiązuje zadanie. Bez abstrakcji "na zapas".
3. Chirurgiczne zmiany: ruszaj tylko to, co potrzebne do zadania. Nie refaktoryzuj przy okazji.
4. Cel i weryfikacja: zadanie kończy się przechodzącymi testami. Najpierw test, potwierdź że pada, potem implementacja (zamieniaj zadania na weryfikowalne cele).
5. Wymagania: przed implementacją sprawdź `SPEC.md`. Nowe lub zmienione wymaganie najpierw jako propozycja zmiany w `SPEC.md`, kod dopiero po mojej akceptacji.
6. Decyzje architektoniczne zapisuj jako ADR w `docs/decisions/` (szablon: `0000-template.md`).
7. **Każde zadanie we własnym worktree, nigdy w katalogu głównym.** Katalog główny (`/home/maciek/.t3/projects/ekorepetycje-inkroom`) zostaje na `main` i nikt w nim nie edytuje plików (także `CLAUDE.md`, `SPEC.md` i dokumentów), nie przełącza gałęzi, nie commituje i nie robi `checkout`, `reset` ani `restore`, bo pracuje w nim kilku agentów naraz i jeden kasuje drugiemu niezacommitowane zmiany. Pierwszy krok zadania: `git worktree add ../ekorepetycje-inkroom-<temat> -b <typ>/<temat> origin/main` (szczegóły w „Git worktrees i graf” niżej), a przed pierwszą edycją sprawdź `git rev-parse --show-toplevel`. Nie używaj `git stash`: stos jest jeden dla wszystkich worktree, więc `pop` może zabrać cudze zmiany. Cudzego worktree nie ruszaj; gdy coś w nim przeszkadza, powiedz mi.

## Komendy
Stos: serwer w Go (`server/`), klient w TypeScript + Vite + Preact (`web/`). Serwer czyta `PORT` (domyślnie 8080) i `STATIC_DIR` (domyślnie `../web/dist`), więc do dev serwera najpierw `cd web && npm run build`.
- Uruchomienie całości: `docker compose up` (ADR 0002)
- Build obrazu: `docker compose build`
- Dev klienta: `cd web && npm run dev`; dev serwera: `cd server && go run ./cmd/server`
- Testowanie lokalne z logami (Loki, Grafana, alerty w atrapie Telegrama): `sh .claude/skills/test-server/server.sh start 8099 --logs`, przewodnik w `docs/testowanie-lokalne.md`
- **Ta maszyna to VM (`192.168.0.51`), a ja testuję z innego komputera lub iPada po LAN.** Każdy serwer, który mam obejrzeć (aplikacja, Grafana, podgląd zrzutów), słucha na wszystkich interfejsach (`BIND_ADDR=0.0.0.0:<port>`, nigdy `127.0.0.1`), a podajesz mi adres `http://192.168.0.51:<port>`, sprawdzony wcześniej `curl -fs http://192.168.0.51:<port>/healthz`. Serwer z kontem testowym bez `BIND_ADDR` odmawia startu; skrypt `test-server` ustawia go sam. Każdy worktree ma własny port (8099 i dalej), żeby agenci nie zatrzymywali sobie serwerów.
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
- Praca przez PR (każdy agent we własnym worktree, korzeń zostaje na `main`): gałąź z `origin/main`, małe commity, PR (`gh pr create`), merge dopiero po zielonym jobie `test`. Joby `image` i `scan` (Trivy) działają tylko na `main` i tagach, więc PR ich nie sprawdza: po merge obejrzyj przebieg (`gh run list -R maciekgangus/inkroom`) i napraw od razu, bo czerwony `scan` zablokuje też wydanie z tagu. Przed `gh pr create` funkcji z interfejsem hook przypomina o ręcznym przejściu przez `/test-server`.
- Na tej maszynie `git push` nie ma poświadczeń HTTPS: `git -c credential.helper='!gh auth git-credential' push -u origin <gałąź>`. Push zmian w `.github/workflows/` wymaga tokena `gh` z zakresem `workflow` (`gh auth refresh -h github.com -s workflow`, robi to użytkownik).
- Sekrety w `.env`, nigdy w obrazach ani w repo. Logi i metryki (Loki, Prometheus, Grafana) działają na osobnej maszynie, przy aplikacji zostaje tylko agent Alloy (ADR 0022 do 0024).
- Hook `.claude/hooks/pr-evidence-gate.sh` blokuje `gh pr create`, gdy zmiana dotyka kodu klienta (`web/src`, poza testami), a w `docs/screenshots/<gałąź>/` nie ma PNG nowszych niż ostatni commit (gałąź z `/` zamieniona na `-`). Przed PR-em: `/test-server`, przejście funkcji w przeglądarce, zrzuty do tego katalogu i w opisie PR.
- Plugin lub serwer MCP dodawaj dopiero pod konkretny problem, a po dodaniu sprawdź `/context`.

## Role agentów i skille
Praca idzie przez subagentów z `.claude/agents/`: `backend` (`server/`), `frontend` (`web/`), `design` (szlif wyglądu), `deploy` (tylko odczyt i raport). Zasady ogólne są tu, procedury w skillach. `skills:` agenta preloaduje tylko skille z `.claude/skills/` (stąd `tdd`); skille z `server/` i `web/` ładują się same po odczycie pliku z tego podkatalogu i nie da się ich wpisać w `skills:`, tak samo ręcznego `deploy`.
- Zawsze w kontekście: `tdd` (`.claude/skills/`, jeden na repo), `test-server`, komendy `/req` i `/status`.
- Tylko przy pracy w podkatalogu: `server/.claude/skills/codebase-design`; `web/.claude/skills/frontend-design`, `web-design-guidelines`, `impeccable` (ręczny, `/impeccable`, bez hooków).
- Ręczne, ryzykowne: `/deploy` (`disable-model-invocation`, niczego nie wdraża bez Twojego „tak”).
- Audyt bezpieczeństwa: wbudowany `/security-review`. Nie instaluj drugiego skilla do tego samego zadania.
- Źródła: `tdd`, `codebase-design` z mattpocock/skills @ d653911; `frontend-design` z anthropics/skills; `web-design-guidelines` z vercel-labs/agent-skills 1.1.0; `impeccable` z pbakaus/impeccable @ b49177d (4.10.0; `disable-model-invocation: true` dopisane lokalnie, po aktualizacji dopisz znowu). Zrzuty responsywności (375, 768, 1440 px): Playwright z `web/`, bez MCP.

## Kalendarz zajęć (R-104 do R-109, ADR 0025)
Kalendarz jest w tej samej bazie SQLite i na tym samym koncie co tablice. Nie ma ról na koncie: prowadzącym jest ten, kto tworzy zajęcie. Moduły są rozdzielone w kodzie, nie w sieci.
- `server/internal/calendar/series.go`: rozwija regułę serii na zajęcia (strefa IANA, godzina trzyma się po zmianie czasu, najwyżej 200).
- `server/internal/store/calendar.go`: tabele `lessons`, `lesson_series`, `unavailability`, `lesson_requests`. Konflikt terminu (`ErrConflict`) sprawdza się w tej samej transakcji co zapis; zajęcia odwołane nie blokują terminu.
- `server/cmd/server/lessons.go`: API (`/api/calendar`, `/api/lessons`, `/api/series`, `/api/unavailability`, `/api/requests`). Zmienia i usuwa tylko prowadzący, prośbę o zmianę terminu składa każda strona.
- Klient: `web/src/calendar-page.tsx` (trasa `/calendar`) to tymczasowa, goła strona, żeby backend dało się obejrzeć. Klient kalendarza będzie pisany od nowa po projekcie graficznym, więc **nie piszemy do niego testów** do tego czasu; testy Go backendu kalendarza są obowiązkowe (zasada 4).
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
