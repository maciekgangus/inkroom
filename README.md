# Inkroom

Własna współdzielona tablica do korepetycji online (MVP, zamiennik płatnego IDROO): rysowanie na żywo, zapisane tablice pod stałym linkiem, konta, iPad i rysik.

- Wymagania: [SPEC.md](SPEC.md). Decyzje: [docs/decisions/](docs/decisions/). Zasady pracy z Claude Code: [CLAUDE.md](CLAUDE.md).

## Lokalnie

```sh
docker compose up                       # http://localhost:8080, konto testowe z docker-compose.override.yml
```

Albo bez Dockera: serwer `cd server && go run ./cmd/server` (po `cd web && npm run build`) i klient `cd web && npm run dev`.

Testy: `cd server && go test ./...`, `cd web && npm test`, testy iPada w przeglądarce `cd web && npm run test:e2e` (WebKit: `npm run test:e2e:webkit`).

## Na serwerze (homelab)

Nie ten `docker-compose.yml`, tylko [deploy/](deploy/README.md): gotowy obraz z GitHub Container Registry i Cloudflare Tunnel. Obraz powstaje w GitHub Actions z tagu `vX.Y.Z` ([jak wydać](docs/wydawanie-wersji.md)).

## Nowa wersja na serwerze

Merge do `main` niczego nie wdraża. Wydanie to tag: `git tag -a v0.1.1 -m "opis" && git push origin v0.1.1`, a serwer pobierze obraz nocą. Tagi, cofanie wersji i aktualizacja folderu `deploy/`: [docs/wydawanie-wersji.md](docs/wydawanie-wersji.md).

## Struktura

| Folder | Zawartość |
|---|---|
| `server/` | serwer w Go (API, WebSocket, SQLite) |
| `web/` | klient w TypeScript i Preact, testy e2e |
| `deploy/` | konfiguracja homelabu (compose z tunelem, aktualizacje) |
| `brand/` | logo i ikony (źródła; do aplikacji trafiają z `web/public/`) |
| `docs/decisions/` | ADR-y |
