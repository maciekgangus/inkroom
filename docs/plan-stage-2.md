# Plan Etapu 2: współpraca na żywo

Stan na 2026-11-09. Źródła: `SPEC.md` (R-002, R-003, R-006, R-018, N-001, N-005, N-011), `docs/decisions/0004-sync-protocol.md`, `docs/decisions/0001-stack.md`.

Gotowe, gdy: dwie przeglądarki widzą wzajemnie swoje kreski (SPEC, Etap 2). Dodatkowo ręcznie: PC i iPad na jednym linku, kreska drugiej osoby widoczna na żywo, bez zauważalnego opóźnienia.

Zasady: najpierw test i potwierdzenie, że pada; potem implementacja. Małe commity. Bez abstrakcji "na zapas".

## Założenia (do potwierdzenia)
1. Protokół i model konfliktów jak w ADR 0004 (zbiór niezmiennych kresek, operacje `add`/`remove`, kolejność serwera, `live` dla kreski w trakcie rysowania).
2. **Pokoje tylko w pamięci.** Restart serwera kasuje tablice. Zapis na dysk to Etap 3.
3. **Tworzenie tablicy:** strona `/` z przyciskiem "Nowa tablica" (`POST /api/boards`, przekierowanie na `/b/<id>`). Bez kont (R-001 to Etap 3), więc na razie każdy może utworzyć tablicę.
4. **Gość (R-003):** przy wejściu pytanie o imię, zapamiętane w `localStorage`. Identyfikator autora (do cofania) generowany na kliencie, w `sessionStorage`. Imię na razie tylko wysyłane i przechowywane, wyświetlanie to R-013 (Etap 5).
5. **Bez** kursorów (R-013), uprawnień (R-016), stron i zapisu.
6. **Biblioteka WebSocket w Go:** `github.com/coder/websocket`.

## Kroki
1. **Branch** `feature/live-collab` i ADR 0004 (status `accepted` po Twojej akceptacji).
2. **Board: porządek `(z, id)` i operacje zdalne** (testy najpierw). Kreska dostaje `z`. Cofnięcie gumki przywraca na miejsce wg `z`. `applyRemote(add|remove)` jest idempotentne i nie rusza historii cofania. `Board` zgłasza lokalne operacje (add/remove) słuchaczowi.
3. **Serwer: pokój** (testy najpierw): `Room` z kreskami, `add`/`remove` idempotentne, snapshot, rozsyłanie do wszystkich. Wolny klient odłączany.
4. **Serwer: HTTP i WebSocket:** `POST /api/boards`, `GET /ws/<id>` (404 dla nieznanego), fallback SPA dla `/b/*`. Test integracyjny na `httptest`: dwóch klientów, snapshot, relay, `live`, usunięcie, rozłączenie.
5. **Klient: warstwa synchronizacji** (testy z atrapą WebSocket): wysyłanie operacji, stosowanie wiadomości serwera w kolejności, snapshot, ponowne połączenie z ponownym wysłaniem niepotwierdzonych operacji.
6. **Klient: kreski "live" cudzych autorów.** Renderer rysuje wiele żywych kresek. Wysyłanie `live` raz na klatkę.
7. **Klient: trasy i wejście:** strona główna z przyciskiem, `/b/<id>`, pytanie o imię.
8. **docker compose:** sprawdzenie na działającym obrazie (dwie karty).
9. **Test na PC + iPadzie** (jak w Etapie 1). Wynik do SPEC.md (R-006, R-018 na `done`; R-002 i R-003 częściowo, bo pełne po Etapie 3, status `accepted`), aktualizacja CLAUDE.md i PR.

## Otwarte
- Limit liczby kresek i rozmiaru wiadomości na pokój (propozycja: wiadomość do 256 KiB, limit kresek dopiero po pomiarze).
- Czy `z` z zegara klienta wystarcza, czy dać `z` z serwera (propozycja: zegar klienta, prostsze i wystarczy).
