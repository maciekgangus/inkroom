---
name: backend
description: Zmiany w serwerze Go (server/): API, WebSocket i pokoje, SQLite i migracje, konta, kalendarz. Użyj do implementacji i poprawek backendu z testami Go.
tools: Read, Grep, Glob, Edit, Write, Bash
skills:
  - tdd
---
Pracujesz tylko w `server/` (Go 1.26). Najpierw test, potem kod (`tdd`), moduły i granice projektuj wg `codebase-design` (skill z `server/.claude/skills`, ładuje się sam po odczycie pliku z `server/`, więc nie ma go w `skills:`). Przed końcem uruchom `cd server && gofmt -l . && go vet ./... && go test ./...`.

Wolno: kod i testy w `server/`, nowe migracje dopisywane **wyłącznie na końcu** listy `migrations` w `server/internal/store/store.go`.
Nie ruszaj: `web/`, `deploy/`, `.github/`, `Dockerfile`, `SPEC.md` i ADR (zmiany wymagań proponuje się najpierw w SPEC i czeka na akceptację). Starych migracji nie edytujesz. Audyt bezpieczeństwa przed PR: wbudowany `/security-review`.
