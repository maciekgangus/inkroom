# 0010. Tło tablicy i tryb ciemny

- Status: accepted
- Data: 2026-11-09

## Kontekst
R-027: tło tablicy (gładkie, kropki, kratka, linie) wspólne dla wszystkich, ustawiane przez twórcę, zapisywane z tablicą, zmieniane na żywo, przesuwane i skalowane z płótnem. R-026: tryb ciemny łącznie z tablicą jako ustawienie osobiste. Ograniczenia: niskie CPU serwera (N-008), płynność rysowania (N-002), protokół z ADR 0004 (pokój zna tylko kreski i nie wie, kto jest twórcą), konta i zapis z ADR 0005.

## Rozważane opcje
Zmiana tła:
1. **Wiadomość WebSocket od klienta.** Pokój musiałby znać tożsamość i uprawnienia każdego połączenia; dziś ich nie zna.
2. **Żądanie HTTP twórcy, a serwer rozsyła zmianę do pokoju.** Sprawdzanie właściciela już istnieje w API tablic (ciasteczko sesji). Wybrane.

Rysowanie tła:
1. **Na canvasie**, przy każdym odświeżeniu. Dodatkowa praca w każdej klatce przesuwania.
2. **Tło CSS (gradienty) na warstwie pod canvasem**, z rozmiarem i pozycją liczonymi z widoku. Przeglądarka kafelkuje je sama, canvas z kreskami się nie zmienia. Wybrane.

Tryb ciemny a kolory kresek:
1. **Zapisywać kolor zależny od trybu autora.** Tablica wyglądałaby inaczej zależnie od tego, kto rysował.
2. **Zapisany kolor bez zmian, zamiana tylko przy wyświetlaniu.** Wybrane.

## Decyzja
- Tablica ma pole `background`: `plain` (domyślne), `dots`, `grid`, `lines`. Kolumna w tabeli `boards` (migracja 2).
- `PUT /api/boards/{id}/background` z `{"background": "..."}`: tylko właściciel, wartość spoza listy daje 400. Serwer zapisuje do bazy, a potem ustawia tło w pokoju (jeśli jest w pamięci) i rozsyła `background {value}` do wszystkich.
- Pokój wczytuje tło razem z kreskami przy pierwszym wejściu i dołącza je do `snapshot` (`background`), więc klient po wejściu i po ponownym połączeniu zawsze ma aktualną wartość. Klient nie może zmienić tła przez WebSocket.
- `GET /api/boards/{id}` zwraca dodatkowo `owner` (czy pytający jest twórcą), żeby klient pokazał wybór tła tylko twórcy.
- Klient rysuje tło jako gradienty CSS na elemencie pod canvasami. Odstęp wzoru to 24 jednostki tablicy; przy oddaleniu odstęp jest podwajany, aż na ekranie ma co najmniej 12 px.
- Tryb ciemny: atrybut `data-theme` na `<html>` i zmienne CSS. Wybór (`light`/`dark`) w `localStorage`; bez wyboru decyduje `prefers-color-scheme`. Nic nie trafia na serwer.
- W trybie ciemnym kolor `#111111` (domyślny czarny) jest rysowany jako biały, a `#ffffff` jako `#111111`. Zamiana dzieje się tylko przy wyświetlaniu (canvas, próbki w pasku, pole tekstu); zapisane kreski się nie zmieniają.

## Konsekwencje
- Interfejs `Persister` huba dostaje wczytywanie tła; `Hub` dostaje `SetBackground`.
- Inne ciemne kolory z palety (R-025), np. granat, pozostają ciemne na ciemnej tablicy. Świadomie: pełne przeliczanie kolorów zmieniałoby wygląd tablicy między trybami.
- Eksport (R-014) będzie musiał zdecydować, czy rysuje tło i w którym trybie.
- Gdy wejdzie R-016 (uprawnienia), ten sam wzorzec (HTTP od twórcy, rozsyłka do pokoju) nadaje się do przełącznika "tylko oglądają".
