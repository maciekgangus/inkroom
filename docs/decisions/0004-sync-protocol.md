# 0004. Protokół synchronizacji i model konfliktów

- Status: accepted
- Data: 2026-11-09

## Kontekst
Etap 2 (R-006, R-018): kilka osób rysuje na jednej tablicy na żywo. Wymagania: opóźnienie do ok. 150 ms (N-001), brak gubienia elementów przy jednoczesnej edycji i wygrywa ostatnia zmiana (N-011), powrót po utracie połączenia bez utraty kresek (N-005), niskie CPU serwera (N-008), cofanie per użytkownik (R-008). Stos: Go i JSON po WebSocket (ADR 0001). Zapis na dysk to Etap 3, więc w Etapie 2 stan pokoju jest tylko w pamięci serwera.

## Rozważane opcje
1. **CRDT (np. Yjs, Automerge).** Gotowa zbieżność, ale po stronie Go brak dojrzałej biblioteki, a model jest cięższy niż potrzebny: kreski są niezmienne.
2. **Operacje po stronie serwera jako źródła prawdy, bez optymizmu u klienta.** Proste, ale kreska pojawiałaby się lokalnie po RTT. Odrzucone (priorytet 1).
3. **Zbiór niezmiennych kresek, operacje idempotentne, kolejność ustala serwer.** Wybrane.

## Decyzja
- Tablica to zbiór kresek. Kreska jest niezmienna po dodaniu i ma `id`, `authorId`, `z` (znacznik czasu klienta w ms; porządek rysowania to `(z, id)`).
- Są dwie operacje: `add {stroke}` i `remove {id}`. Obie są idempotentne. Cofnięcie `add` to `remove`, cofnięcie gumki to ponowne `add` tej samej kreski (ze starym `z`, więc wraca na swoje miejsce u wszystkich).
- Serwer przyjmuje operacje w kolejności nadejścia i rozsyła je **do wszystkich klientów, razem z nadawcą**. Klient stosuje lokalnie od razu (optymistycznie), a potem stosuje także wszystko, co przyjdzie z serwera, w kolejności serwera. Efekt: dla jednej kreski wygrywa ostatnia operacja w kolejności serwera, wszyscy zbiegają do tego samego stanu, nic się nie gubi (N-011).
- Kreska w trakcie rysowania jest wysyłana jako `live {id, authorId, color, size, points}` (nowe punkty, najwyżej raz na klatkę). Serwer tylko przekazuje ją pozostałym i nie przechowuje. Po puszczeniu kreski klient wysyła pełne `add`, które zastępuje wersję "live". Rozłączenie autora usuwa jego niedokończone kreski "live".
- Wejście do pokoju: serwer wysyła `snapshot {strokes}`. Klient po ponownym połączeniu dostaje nowy snapshot i ponownie wysyła swoje operacje, których nie zobaczył z powrotem z serwera (idempotentne, więc bezpieczne). Ponawianie z rosnącym odstępem.
- Pokój tworzy `POST /api/boards`, który zwraca 128-bitowy losowy identyfikator (hex). Link to `/b/<id>`. Nieznany identyfikator daje 404. Pokoje żyją w pamięci do Etapu 3.
- Serwer (Go, `coder/websocket`): jeden `Room` na tablicę z mutexem, na klienta jedna goroutine zapisująca i bufor wiadomości. Klient, który nie nadąża (pełny bufor), jest rozłączany, żeby nie zużywać RAM i CPU. Limit rozmiaru wiadomości.

## Konsekwencje
- `Board` w kliencie przechodzi z indeksów na porządek `(z, id)` i dostaje operacje zdalne, które nie wchodzą do historii cofania.
- Zegary klientów wpływają tylko na kolejność nakładania się kresek rysowanych jednocześnie. Dopuszczalne.
- Serwer nie weryfikuje, kto kasuje czyją kreskę (R-004: każdy może skasować każdą). Uprawnienia (R-016) w Etapie 5.
- Restart serwera kasuje tablice do czasu Etapu 3.
- Kursory innych osób (R-013) wejdą jako kolejny typ wiadomości, bez zmiany tego modelu.

## Uzupełnienie (2026-11-10): obecni uczestnicy i nazwa tablicy

Dwie wiadomości od serwera do klientów, obie bez zapisu w bazie, i dwa parametry adresu gniazda.

- Adres `/ws/{id}` przyjmuje `?id=<identyfikator autora>&name=<imię>`. Serwer przycina imię do 40 znaków; klient bez imienia lub z identyfikatorem pustym albo dłuższym niż 64 znaki jest anonimowy i nie jest nigdzie wymieniany.
- `{"t":"peers","peers":[{"id","name"}]}`: lista przedstawionych klientów (raz na identyfikator, posortowana po imieniu). Serwer rozsyła ją do wszystkich przy dołączeniu i wyjściu przedstawionego klienta, a nowy klient dostaje ją zaraz po migawce. Anonimowe połączenia nie wywołują wysyłki. Po zerwaniu połączenia klient czyści listę do czasu nowej wiadomości.
- `{"t":"name","value":"..."}`: nowa nazwa tablicy po `PATCH /api/boards/{id}` (tylko właściciel); dostają ją wszyscy na tablicy, razem z właścicielem. Nazwę początkową klient bierze z `GET /api/boards/{id}`.
