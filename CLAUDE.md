# IDROO: współdzielona tablica do korepetycji (MVP)

Własna, tania tablica interaktywna do prowadzenia korepetycji online, zamiennik płatnego IDROO.
Źródło prawdy o wymaganiach: @SPEC.md. Decyzje architektoniczne: `docs/decisions/`.

## Stan projektu
Etap 0: stos technologiczny NIE jest wybrany. Do czasu zaakceptowania `docs/decisions/0001-stack.md` nie pisz kodu aplikacji. Zacznij od `/kickoff`.

## Priorytety (w tej kolejności)
1. Responsywność: kreska pojawia się natychmiast lokalnie, u drugiej osoby bez zauważalnego opóźnienia. Wygoda użytkownika ponad wszystko.
2. Działa na iPadach i innych tabletach z rysikiem, nie tylko na PC (korepetytor pracuje na PC, uczniowie często na tabletach).
3. Oszczędność CPU na serwerze. RAMu jest dużo, procesora mało.
4. Jeśli istnieje warta uwagi gotowa biblioteka tablicy, użyj jej zamiast pisać własną.

## Zasady pracy
1. Najpierw myśl: wypisz założenia, a przy niejasności zapytaj zamiast zgadywać.
2. Prostota: najmniej kodu, który rozwiązuje zadanie. Bez abstrakcji "na zapas".
3. Chirurgiczne zmiany: ruszaj tylko to, co potrzebne do zadania. Nie refaktoryzuj przy okazji.
4. Cel i weryfikacja: zadanie kończy się przechodzącymi testami. Najpierw test, potwierdź że pada, potem implementacja.
5. Wymagania: przed implementacją sprawdź `SPEC.md`. Nowe lub zmienione wymaganie najpierw jako propozycja zmiany w `SPEC.md`, kod dopiero po mojej akceptacji.
6. Decyzje architektoniczne zapisuj jako ADR w `docs/decisions/` (szablon: `0000-template.md`).

## Komendy
Do uzupełnienia po wyborze stosu (ADR 0001): dev, build, test, lint.

## Konwencje
- Kod, nazwy, komentarze i commit messages po angielsku. Dokumenty (`SPEC.md`, ADR, README) po polsku.
- Małe commity, jeden po każdej działającej części. Commituj po przejściu testów i moim przeglądzie diffu.
- Nie czytaj ani nie ruszaj plików `.env`.
- Plugin lub serwer MCP dodawaj dopiero pod konkretny problem, a po dodaniu sprawdź `/context`.
