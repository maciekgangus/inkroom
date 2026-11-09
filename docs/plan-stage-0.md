# Plan Etapu 0: szkielet

Stan na 2026-11-09. Źródła: `SPEC.md` (sekcja 5, Etap 0), `docs/decisions/0001-stack.md`, `docs/decisions/0002-deployment.md`.

Stos: własny canvas (Pointer Events + `perfect-freehand`), serwer w Go, SQLite, klient w TypeScript + Vite + Preact. tldraw odrzucony (licencja), powrót nie jest przewidziany.

Gotowe, gdy: działa komenda testowa, `docker compose up` uruchamia pustą aplikację i `claude` czyta CLAUDE.md.

Zasady: najpierw test i potwierdzenie, że pada; potem implementacja. Małe commity po przejściu testów i przeglądzie diffu. Nie ruszać plików `.env`.

## Kroki

1. **Branch** `chore/stage-0-skeleton`.
2. **Spike na iPadzie** (jednorazowy, katalog `spike/`, usuwany po teście). Jeden plik HTML ok. 100 linii serwowany po LAN, z `perfect-freehand`.
   Sprawdza:
   - opóźnienie rysowania z `getCoalescedEvents` (kreska ma się pojawiać natychmiast, bez przełamań),
   - nacisk z Apple Pencil,
   - palm rejection: rysik rysuje, dotyk dłonią nie (`pointerType`),
   - brak konfliktu z gestami Safari (`touch-action`, `pointercancel`),
   - osobna warstwa "żywej" kreski nad warstwą zatwierdzoną.

   Kryteria "zdał/nie zdał" ustalamy z użytkownikiem przed testem. Wynik zapisujemy w ADR 0001. Słaby wynik oznacza poprawianie własnego canvasu, nie zmianę biblioteki.
3. ~~**ADR 0003** (Cloudflare Tunnel)~~ Odłożony na Etap 3.5. Najpierw aplikacja działa lokalnie w sieci Wi-Fi.
4. **Szkielet repo:** `server/` (Go), `web/` (TS), `Dockerfile` (wieloetapowy), `docker-compose.yml`, `.env.example`.
5. **Testy najpierw, potwierdzone jako padające:**
   - serwer: `GET /healthz` zwraca 200,
   - klient: aplikacja montuje pusty element `<canvas>`.
6. **Minimalna implementacja**, tylko tyle, żeby testy przeszły.
7. **`docker compose up`** uruchamia pustą aplikację: `curl /healthz` i otwarcie strony w przeglądarce.
8. **CLAUDE.md, sekcja "Komendy":** potwierdzić planowane komendy (dev, build, test, lint) na działającym szkielecie.
9. **Hooki** (format, lint, testy) przez skill `update-config`.
10. **Sprawdzenie**, że `claude` czyta CLAUDE.md (`/context`).
11. **Commity i PR:** push gałęzi i PR z opisem.

## Poza zakresem Etapu 0
Rysowanie na płótnie (Etap 1), synchronizacja (Etap 2), konta i zapis (Etap 3), `cloudflared` i VPS (Etap 3.5).

## Otwarte
- Kryteria spike'u (krok 2) do ustalenia z użytkownikiem przed testem.
- Etap 3.5: domena jest wykupiona, a Cloudflare Tunnel skonfigurowany. Zostaje podpięcie portów i spisanie ADR 0003.
