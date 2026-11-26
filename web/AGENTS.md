# Praca w `web/` (Preact, TypeScript)

Uzupełnia główny `AGENTS.md` i `CLAUDE.md`, nie zastępuje ich.

- Role: `.claude/agents/frontend.md` (logika i testy) oraz `.claude/agents/design.md` (wygląd).
- Skille: `.claude/skills/tdd/SKILL.md` (najpierw test, który pada), `web/.claude/skills/frontend-design/SKILL.md` i `web/.claude/skills/web-design-guidelines/SKILL.md` (przed każdą zmianą wyglądu). `impeccable` uruchamia tylko użytkownik.
- Priorytety: kreska pojawia się natychmiast lokalnie i u drugiej osoby, wszystko działa na iPadzie z rysikiem i dotykiem.
- Tymczasowy klient kalendarza `web/src/calendar-page.tsx` nie dostaje testów.
- Kontrole po każdej zmianie: `cd web && npx biome check . && npx tsc --noEmit && npm test`; przy zmianie zachowania na iPadzie także `npm run test:e2e`.
- Zmiana interfejsu wymaga przejścia w przeglądarce i zrzutów 375, 768 i 1440 px przed PR-em (szczegóły w głównym `AGENTS.md`).
