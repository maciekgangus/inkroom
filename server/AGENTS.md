# Praca w `server/` (Go)

Uzupełnia główny `AGENTS.md` i `CLAUDE.md`, nie zastępuje ich.
- Rola: `.claude/agents/backend.md` (co wolno, czego nie ruszać).
- Skille: `.claude/skills/tdd/SKILL.md` (najpierw test, który pada) i `server/.claude/skills/codebase-design/SKILL.md` (moduły, granice, seams).
- Migracje dopisujesz wyłącznie na końcu listy `migrations` w `server/internal/store/store.go`. Starych nie edytujesz.
- Kontrole po każdej zmianie: `cd server && gofmt -l . && go vet ./... && go test ./...`.
