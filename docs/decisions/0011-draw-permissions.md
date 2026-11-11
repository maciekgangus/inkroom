# 0011. Prawo rysowania per uczestnik (R-016)

- Status: proposed
- Data: 2026-11-11

## Kontekst
R-016: twórca tablicy zabiera lub przywraca uczestnikowi możliwość rysowania, z menu pod jego awatarem (R-046). Bez prawa rysowania uczestnik ogląda, przesuwa i przybliża widok oraz widzi kursory. Dziś każdy na tablicy może wszystko (ADR 0004), a serwer nie wie, kto jest właścicielem połączenia; tożsamość uczestnika (`id`, `name` w adresie gniazda) podaje klient i nie jest uwierzytelniona.

## Decyzja
- **Osoba (person) zamiast identyfikatora z przeglądarki.** Prawa przypisujemy osobie rozpoznawanej przez serwer, a nie `id` podanemu przez klienta (to `authorId` z `sessionStorage`, osobny w każdej karcie i niezmieniony w tej decyzji; służy dalej do kresek, kursorów i listy osób).
  - Zalogowany: `u:<id konta>`; prawa idą więc za kontem, na każdym urządzeniu.
  - Gość: serwer wydaje ciasteczko `inkroom_guest` (losowy sekret, 32 bajty hex, HttpOnly, SameSite=Lax, rok; Secure za HTTPS), ustawiane przy `GET /api/boards/{id}`. Osoba to `g:` plus skrót SHA-256 sekretu, więc sekret nie wycieka do innych przez listę osób. Brak ciasteczka (klient spoza przeglądarki): `a:<authorId>`.
- **Właściciel na gnieździe.** `serveWS` ustala osobę i to, czy ona jest właścicielem tablicy (sesja konta = `OwnerID`). Właściciel zawsze może rysować i nie da się mu odebrać prawa.
- **Lista odebranych praw** to zbiór osób przy tablicy, zapisany w bazie (nowa tabela `board_revoked(board_id, person)`), więc przeżywa restart i kolejne lekcje. Domyślnie wszyscy rysują.
- **Protokół.**
  - Klient (tylko właściciel) -> serwer: `{"t":"perm","id":"<authorId osoby z listy>","draw":false|true}`. Serwer zamienia `authorId` na osobę połączenia i zmienia jej prawo; od innych klientów ignoruje.
  - Wiadomość `peers` dostaje przy osobie pole `"muted":true`, gdy nie może rysować; po zmianie prawa idzie do wszystkich. Nowy klient ma je od razu z listą osób, a każdy zna swój stan po własnym `authorId`.
- **Egzekwowanie na serwerze.** Operacje `add`, `update`, `remove` i `live` od osoby bez prawa są odrzucane (bez błędu i bez rozsyłania), a ona dostaje wtedy świeżą migawkę, żeby jej lokalny, optymistyczny stan wrócił do prawdy. Kursory nadal działają.
- **Klient.** Osoba bez prawa ma wyłączone rysowanie, zaznaczanie i cofanie; Ręka, zoom i mapa działają, a widać komunikat "Nie możesz rysować na tej tablicy". Właściciel klika awatar innej osoby i w małym menu wybiera "Zabierz możliwość rysowania" albo "Pozwól rysować"; awatar osoby bez prawa ma znak przekreślonego pióra.

## Rozważane opcje
1. Jeden przełącznik "uczestnicy tylko oglądają" dla całej tablicy (pierwotne R-016). Odrzucone na prośbę użytkownika: ma być per osoba z awatara.
2. Prawa per `authorId` od klienta. Odrzucone: wystarczy otworzyć kartę lub wyczyścić dane strony, żeby dostać nowy `authorId`.
3. Ciasteczko serwera dla gości plus konta (wybrane).

## Konsekwencje
- Gość, który usunie ciasteczka albo wejdzie z okna prywatnego, jest dla serwera nową osobą z prawem rysowania. To już nie jest sprawa jednego kliknięcia, ale pełnej pewności dają tylko konta; przy korepetycjach to wystarcza.
- Dwie karty tej samej przeglądarki to jedna osoba (jedno prawo), choć dwa `authorId`.
- Zmiana protokołu jest wstecznie zgodna: nowe pole i nowa wiadomość.
