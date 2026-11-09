# 0001. Wybór stosu technologicznego

- Status: proposed
- Data: 2026-11-09

## Kontekst
Stos nie jest jeszcze wybrany. Kryteria wynikają z SPEC.md, w kolejności ważności:

1. Responsywność i brak opóźnień przy rysowaniu (N-001, N-002).
2. Pełna obsługa iPada i innych tabletów z rysikiem, w tym Safari na iPadOS (N-003, R-005).
3. Niskie zużycie CPU na serwerze, RAM nie jest ograniczeniem (N-008).
4. Gotowa biblioteka tablicy zamiast własnej, jeśli jest warta uwagi i działa.
5. Własny serwer synchronizacji możliwy do uruchomienia u siebie (N-006), konta i zapis stanu (R-001, R-007).
6. Licencja pozwalająca na użycie w prowadzeniu płatnych korepetycji.

Język jest dowolny.

## Rozważane opcje (do zbadania, nic nie jest rozstrzygnięte)
- Gotowa biblioteka tablicy (np. tldraw, Excalidraw) z własnym serwerem synchronizacji.
- Własny canvas z Pointer Events i własną synchronizacją.
- Backend w języku oszczędnym procesorowo (np. Go, Rust) albo Node.js, zależnie od tego, czego wymaga wybrana biblioteka synchronizacji.

## Jak podjąć decyzję
W pierwszej sesji (`/kickoff`, plan mode):
1. Sprawdź aktualny stan i licencje kandydatów (źródła w sieci, nie z pamięci).
2. Oceń każdego kandydata względem kryteriów powyżej, w tabeli.
3. Zrób minimalny prototyp rysowania i sprawdź go na iPadzie z rysikiem.
4. Zapisz wynik poniżej i zmień status na accepted po mojej akceptacji.

## Decyzja
Do podjęcia.

## Konsekwencje
Po akceptacji uzupełnij sekcję "Komendy" w CLAUDE.md oraz dodaj hooki (format, lint, testy).
