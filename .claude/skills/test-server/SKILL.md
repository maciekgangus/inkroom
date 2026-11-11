---
name: test-server
description: Odpala (albo zatrzymuje) lokalny serwer testowy Inkroom z aktualnego checkoutu: buduje klienta i serwer, startuje w tle na porcie 8099 z kontem testowym i kluczami testowymi captchy, i podaje adresy (PC i LAN dla iPada). Użyj, gdy użytkownik prosi o "odpal serwer", "daj przetestować", "postaw serwer testowy" albo o zatrzymanie go.
---

# Serwer testowy Inkroom

Serwer działa w tle z katalogu, w którym jesteś (worktree), więc dotyczy tej gałęzi. Każdy port
ma własny stan (baza, log, pid) w `~/.cache/inkroom-test-server-<port>`.

## Użycie

Skrypt: `.claude/skills/test-server/server.sh` (z korzenia checkoutu; ścieżka bywa też
`<worktree>/.claude/skills/test-server/server.sh`).

- Start: `sh .claude/skills/test-server/server.sh start [port]` (domyślnie 8099). Najpierw zatrzymuje
  poprzedni serwer na tym porcie, buduje `web/` i `server/`, czeka na `/healthz`.
  `FRESH=1` zaczyna od pustej bazy.
- Stan: `... status [port]`, zatrzymanie: `... stop [port]`.

## Co zrobić

1. Wykonaj `start` w worktree, w którym trwa praca (sprawdź `git rev-parse --show-toplevel`,
   w razie wątpliwości zapytaj, o którą gałąź chodzi). Przy pracy w kilku worktree podaj inny port,
   żeby się nie zatrzymywały nawzajem.
2. Przekaż użytkownikowi adresy z wyniku (localhost i LAN) oraz konto testowe:
   `test@example.test` / `test-user-1234` (logowanie także samą nazwą `test`). To publiczne konto
   deweloperskie z `CLAUDE.md`, więc można je podać.
3. Rejestracja na `/register` działa z testową captchą Cloudflare (widżet wymaga internetu).
4. Na iPadzie po LAN może być potrzebne otwarcie portu: `sudo firewall-cmd --add-port=<port>/tcp`
   (bez `--permanent`); podpowiedz to, ale nie uruchamiaj `sudo` sam.
5. Nie czytaj ani nie zmieniaj plików `.env`; skrypt ich nie używa.
6. Nie zostawiaj serwera włączonego bez wiedzy użytkownika: po teście zapytaj, czy zatrzymać,
   albo zatrzymaj, gdy o to poprosi.
