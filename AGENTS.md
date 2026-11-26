# Inkroom: zasady dla agentów spoza Claude Code (Mistral Vibe, Codex, Gemini CLI)

Zasady projektu są napisane dla Claude Code i obowiązują Ciebie tak samo: gdzie piszą „Claude”, chodzi o Ciebie. Źródłem prawdy są `CLAUDE.md` (zasady pracy, komendy, konwencje) i `SPEC.md` (wymagania). **Przeczytaj oba w całości, zanim cokolwiek zmienisz.** Ten plik nie powtarza zasad, tylko mówi, jak wykonać ręcznie to, co Claude Code robi sam. Gdy zasady się wykluczają albo czegoś nie wiesz, zapytaj użytkownika zamiast zgadywać.

## Najważniejsze, zanim zaczniesz
- Każde zadanie robisz we własnym worktree (`CLAUDE.md`, zasada 7). Sprawdź `git rev-parse --show-toplevel`. W katalogu głównym `/home/maciek/.t3/projects/ekorepetycje-inkroom` nikt nic nie edytuje, nie zmienia gałęzi i nie commituje. Nigdy nie używasz `git stash`.
- Najpierw test, który pada, potem kod (skill `tdd`). Nowe albo zmienione wymaganie: najpierw propozycja zmiany `SPEC.md`, kod dopiero po akceptacji użytkownika.
- Nie merguj, nie zakładaj tagów i niczego nie wdrażaj bez wyraźnego „tak” od użytkownika. Nie czytaj plików `.env`.

## Co Claude Code robi sam, a Ty ręcznie

| W Claude Code | U Ciebie |
|---|---|
| Role subagentów w `.claude/agents/` | Przed zmianą przeczytaj rolę obszaru: `server/` to `backend.md`, logika w `web/` to `frontend.md`, wygląd to `design.md`, CI i wdrożenie to `deploy.md` (tylko odczyt). Ich „Wolno” i „Nie ruszaj” obowiązują Ciebie. |
| Skille ładowane same | Vibe (i inne narzędzia czytające `.agents/skills/`) widzi je jako skille. W innym przypadku czytasz `SKILL.md` ręcznie: zawsze `.claude/skills/tdd/` (z `tests.md` i `mocking.md`); przy zmianach w `server/` `server/.claude/skills/codebase-design/`; w `web/` `web/.claude/skills/frontend-design/` i `web/.claude/skills/web-design-guidelines/`. `impeccable` i `deploy` uruchamia tylko użytkownik. |
| Komendy `/req`, `/status`, `/test-server` | Procedury do wykonania krok po kroku: `.claude/commands/req.md`, `.claude/commands/status.md`, `.claude/skills/test-server/SKILL.md`. |
| `/security-review` | Przegląd ręczny przed PR-em: autoryzacja i sprawdzenie właściciela na każdym nowym endpoincie, walidacja wejścia, SQL tylko z parametrami, brak XSS, żadnych sekretów w repo. |
| Hooki z `.claude/hooks/` | Vibe puszcza te same skrypty przez `.vibe/hooks.toml`. W innych narzędziach robisz to sam: kontrole po każdej edycji (sekcja niżej), a przed `gh pr create` ze zmianą interfejsu sprawdzasz zrzuty ekranu. |
| graphify przez hooki | Pytania o kod: najpierw `graphify query "..."`, `graphify explain "..."`, `graphify path "A" "B"`. Po zmianach w kodzie: `graphify update .`. Nowy worktree dostaje graf przez `cp -r <katalog główny>/graphify-out ./graphify-out`. |

## Kontrole (wszystkie działają na tej maszynie, puść je przed pushem)
- Go: `cd server && gofmt -l . && go vet ./... && go test ./...`
- Klient: `cd web && npx biome check . && npx tsc --noEmit && npm test`
- iPad (układ, rysik, dotyk): `cd web && npm run test:e2e` (Chromium) i `npm run test:e2e:webkit` (WebKit w kontenerze)
Wyniki wklejasz do opisu PR-a. O merge decyduje zielony job `test` w CI (`gh pr checks <nr>`).

## Zmiany w interfejsie (`web/src/**/*.{ts,tsx,css}` poza testami)
- Wygląd według `frontend-design` i `web-design-guidelines`, w zakresie z `.claude/agents/design.md` (przy poprawkach wyglądu nie ruszasz `web/src/board` ani `web/src/sync`).
- Dopisujesz albo poprawiasz testy e2e iPada w `web/e2e/` dla zmienionego zachowania.
- Serwer testowy według `.claude/skills/test-server/SKILL.md`, na własnym porcie od 8099 w górę. Użytkownikowi podajesz adres `http://192.168.0.51:<port>` po sprawdzeniu `curl -fs http://192.168.0.51:<port>/healthz`.
- Funkcję przechodzisz w przeglądarce: Playwright z `web/` z pełnym Chromium (`channel: "chromium"`, headless; okna nie ma, bo VM nie ma ekranu). Sprawdzasz konsolę i logi według listy kontrolnej ze skilla.
- Zrzuty w 375, 768 i 1440 px jako PNG w `docs/screenshots/<gałąź, w której "/" zamieniasz na "-">/`. Muszą być nowsze niż ostatni commit i trafić do opisu PR-a. Bez nich PR ze zmianą interfejsu nie powstaje (`.claude/hooks/pr-evidence-gate.sh`).

## Mistral Vibe: zaufanie do folderu
Vibe wczytuje `AGENTS.md`, `.agents/skills/` i `.vibe/hooks.toml` tylko z zaufanego folderu. Przy pierwszym uruchomieniu w worktree wybierz „Trust full repo” (albo uruchom z `--trust`). Bez tego nie widzisz tych zasad, skilli ani hooków.
