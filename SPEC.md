# IDROO MVP: specyfikacja

Status: wersja startowa z 2026-11-09. To jest źródło prawdy o wymaganiach. Zmiana wymagania = edycja wiersza i wpis w sekcji "Historia zmian".

## 1. Cel i zakres
Własna, tania tablica interaktywna do korepetycji online zamiast IDROO. Korepetytor i uczniowie piszą razem na tablicy w czasie rzeczywistym. Rdzeniem produktu są zapisane tablice: na kolejnych lekcjach wraca się do tej samej tablicy i kontynuuje pracę.

- Użytkownicy: zalogowany użytkownik ma panel ze swoimi tablicami. Dwie role: twórca tablicy (jej właściciel) i uczestnik (wchodzi przez link). Typowo twórcą jest korepetytor (PC), a uczestnikami uczniowie (często iPady i inne tablety z rysikiem). Uczestnik wchodzi jako gość przez link albo po zalogowaniu na własne konto. Gość nie widzi panelu i nie ma historii tablic.
- Model: tablice są stałe, każda ma jeden stały link. Nie ma tablic jednorazowych ani osobnych "spotkań". Tablicę można usunąć.
- Skala: kilkunastu do kilkudziesięciu uczniów łącznie. W jednym pokoju zwykle jeden uczeń, czasem więcej osób naraz.
- Poza zakresem MVP: wideo i audio (zostaje zewnętrzny komunikator), płatności, rozbudowane role, import PDF, aplikacje natywne, nagrywanie lekcji.

## 2. Priorytety projektowe
1. Responsywność i brak opóźnień, wygoda ponad wszystko.
2. Pełna obsługa iPada i innych tabletów z rysikiem.
3. Oszczędność CPU na serwerze (RAM w nadmiarze).
4. Gotowa biblioteka tablicy zamiast własnej, jeśli jest tego warta.

## 3. Wymagania funkcjonalne
Priorytety: P1 do pierwszej lekcji, P2 zaraz po niej, P3 później. Statusy: proposed, accepted, done, dropped.

| ID | Wymaganie | Priorytet | Status |
| --- | --- | --- | --- |
| R-001 | Rejestracja i logowanie użytkownika (e-mail i hasło); konto może założyć każdy i każdy zalogowany może tworzyć tablice | P1 | done |
| R-002 | Twórca tworzy tablicę w panelu; tablica ma stały, trudny do odgadnięcia link, który działa na każdej sesji i zawsze otwiera ostatni zapisany stan | P1 | done |
| R-003 | Wejście uczestnika przez link jako gość (podaje imię) albo po zalogowaniu na własne konto | P1 | done |
| R-004 | Rysowanie na płótnie: pióro, gumka, kolor, grubość linii; gumka kasuje elementy dowolnego autora (każdy uczestnik z prawem rysowania, R-016, może skasować każdy element) | P1 | done |
| R-005 | Obsługa myszy, dotyku i rysika (Pointer Events, nacisk rysika) na: iPad + Apple Pencil (Safari), tablet z Androidem + rysik (Chrome), tablet graficzny przy PC (Wacom itp.) | P1 | accepted |
| R-006 | Współpraca na żywo: wszyscy w pokoju widzą zmiany w czasie rzeczywistym | P1 | done |
| R-007 | Automatyczny zapis stanu tablicy; powrót przez ten sam link i kontynuacja pracy na kolejnych lekcjach, bez logowania gościa | P1 | done |
| R-008 | Cofnij i ponów działają per użytkownik: każdy cofa tylko własne ruchy (osobny stos w obrębie sesji) | P1 | done |
| R-009 | Panel twórcy z listą jego tablic (nazwa, data ostatniej zmiany, kopiowanie linku, otwarcie, usunięcie) | P1 | done |
| R-010 | Nieskończone lub przewijane płótno, przesuwanie i powiększanie | P2 | done |
| R-011 | Kilka stron (kart) w jednej tablicy | P2 | proposed |
| R-012 | Narzędzia: linia, prostokąt, okrąg, tekst | P2 | done |
| R-013 | Wskaźniki kursorów pozostałych osób na tablicy | P2 | done |
| R-014 | Eksport tablicy do PNG lub PDF | P2 | proposed |
| R-015 | Wstawianie obrazu (np. zadanie ze zdjęcia) | P3 | done |
| R-016 | Twórca może ustawić tablicę jako "uczestnicy tylko oglądają" albo "uczestnicy rysują" | P3 | proposed |
| R-017 | Uczestnik z kontem widzi w panelu osobną listę "tablice, do których mam dostęp" | P2 | done |
| R-018 | Kilku uczestników jednocześnie na jednej tablicy | P2 | done |
| R-019 | Usunięcie tablicy tylko przez twórcę, z potwierdzeniem; usunięcie jest trwałe, a link przestaje działać | P1 | done |
| R-020 | Przywracanie wcześniejszej wersji tablicy (historia/snapshoty), np. po przypadkowym skasowaniu cudzej pracy | P3 | proposed |
| R-021 | Każdy rysowany element (kreska, linia, prostokąt, okrąg, tekst, obraz) jest obiektem: kreska odręczna to jeden obiekt (zbiór punktów) zaznaczany, przesuwany i kasowany w całości. Narzędzie "Zaznacz" łapie obiekt (klik) lub kilka (ramka, Shift) i pozwala je przesuwać, skalować i obracać; każdy uczestnik z prawem rysowania może edytować cudze obiekty (jak R-004) | P2 | accepted |
| R-022 | Edycja właściwości zaznaczonych obiektów: kolor, grubość linii (rozmiar czcionki dla tekstu), styl linii (ciągła, kreskowana, kropkowana), wypełnienie kształtów, przezroczystość, treść tekstu (dwuklik); zmiana jest cofalna (R-008) i widoczna dla wszystkich (R-006) | P2 | accepted |
| R-023 | Operacje na zaznaczeniu: usuń, duplikuj, kopiuj i wklej, na wierzch i na spód (kolejność warstw), grupowanie obiektów w stałą grupę | P3 | proposed |

## 4. Wymagania niefunkcjonalne
Miary to propozycje startowe, do potwierdzenia po pierwszych testach na prawdziwej lekcji.

| ID | Wymaganie | Miara |
| --- | --- | --- |
| N-001 | Opóźnienie pojawienia się kreski u drugiej osoby | do ok. 150 ms w typowej sieci |
| N-002 | Płynność rysowania własnej kreski | natychmiastowa lokalnie, bez widocznych przełamań, także na tablecie z rysikiem |
| N-003 | Przeglądarki | aktualny Chrome, Edge, Safari (w tym iPadOS) i Firefox; priorytet testów ręcznych: Safari na iPadOS; Android i tablet graficzny sprawdzane na dostępnym sprzęcie, bez gwarancji przed Etapem 4 |
| N-004 | Bezpieczeństwo kont | hasła haszowane, HTTPS, linki tablic trudne do odgadnięcia; ruch publiczny wyłącznie przez tunel, serwer domowy nie otwiera portów na zewnątrz |
| N-005 | Utrata połączenia | ponowne połączenie bez utraty narysowanych elementów |
| N-006 | Koszt hostingu | docelowo własny serwer domowy (VPS), bez miesięcznych opłat za hosting |
| N-007 | Dane uczniów | minimum danych (imię), brak śledzenia, możliwość usunięcia tablicy |
| N-008 | Obciążenie CPU serwera | niskie; stos dobrany pod oszczędność procesora |
| N-009 | Uruchamianie i wdrożenie | całość startuje jedną komendą `docker compose up`; ta sama konfiguracja lokalnie i na serwerze; sekrety w `.env` poza repo; dane (baza, zapisane tablice) w wolumenach z kopią zapasową (ADR 0002) |
| N-010 | Palm rejection | oparcie dłoni na ekranie nie zostawia śladów podczas rysowania rysikiem; rysik ma pierwszeństwo przed dotykiem |
| N-011 | Konflikty przy współpracy | jednoczesna edycja przez kilka osób nie gubi elementów; gdy dwie osoby zmieniają ten sam element, wygrywa ostatnia zmiana, bez błędu i bez blokowania |

## 5. Etapy
1. Etap 0, szkielet: wybór stosu (ADR 0001), repo, pusta aplikacja z testem. Gotowe, gdy działa komenda testowa, `docker compose up` uruchamia pustą aplikację i `claude` czyta CLAUDE.md.
2. Etap 1, tablica lokalna: płótno, pióro, gumka, mysz/dotyk/rysik, cofnij (R-004, R-005, R-008). Gotowe, gdy rysowanie rysikiem jest płynne na iPadzie z Apple Pencil (Android i tablet graficzny w testach Etapu 4).
3. Etap 2, współpraca na żywo: pokój z linkiem, synchronizacja klientów (R-002, R-003, R-006). Gotowe, gdy dwie przeglądarki widzą wzajemnie swoje kreski.
4. Etap 3, konta i zapis: logowanie, zapis i odtworzenie stanu, lista tablic (R-001, R-007, R-009, R-017, R-019). Gotowe, gdy po zamknięciu karty tablica wraca w tym samym stanie.
5. Etap 3.5, wdrożenie: ten sam docker compose na domowym VPS, HTTPS, dostęp z internetu dla uczniów przez Cloudflare Tunnel, kopie zapasowe bazy (N-004, N-006, N-009). Gotowe, gdy iPad na danych komórkowych otwiera tablicę, a opóźnienie rysowania przez tunel mieści się w N-001.
6. Etap 4, pierwsza prawdziwa lekcja: test z jednym uczniem, lista poprawek. Gotowe, gdy lekcja przeszła bez powrotu do IDROO.
7. Etap 5: pozostałe P2 i P3 według tego, czego zabrakło na lekcji.

## 6. Otwarte pytania
- Gotowa biblioteka tablicy czy własny canvas (licencja, obsługa iPada, możliwość własnego serwera synchronizacji). Rozstrzyga ADR 0001.
- Hosting rozstrzygnięty w ADR 0002: docker compose lokalnie, później domowy VPS. Wystawienie na internet: Cloudflare Tunnel (kontener `cloudflared` w tym samym `docker compose`), HTTPS terminowany u Cloudflare (do zapisania jako ADR 0003). Otwarte: zakup domeny i przeniesienie jej do Cloudflare.

## 7. Historia zmian
- 2026-11-09: wersja startowa, uczeń jako gość lub z kontem, zapisane tablice jako rdzeń, dodane R-017 i R-018, N-008.
- 2026-11-09: model panel + stałe tablice ze stałym linkiem, role twórca/uczestnik, bez tablic jednorazowych; zmieniono R-001, R-002, R-003, R-007, R-009 (P2 na P1), R-016, R-017, R-018; dodano R-019.
- 2026-11-09: urządzenia: iPad/Apple Pencil, Android + rysik, tablet graficzny; test Etapu 1 tylko na iPadzie; zmieniono R-005, N-003, dodano N-010 (palm rejection).
- 2026-11-09: cofanie per użytkownik (R-008), gumka kasuje cudze elementy (R-004), zasada konfliktów N-011, dodano R-020 (przywracanie wersji, P3).
- 2026-11-09: wystawienie przez Cloudflare Tunnel: zmieniono sekcję 6, Etap 3.5, N-004.
- 2026-11-09: wdrożenie przez docker compose (lokalnie, potem domowy VPS): zmieniono N-006, dodano N-009 i Etap 3.5, hosting rozstrzygnięty w ADR 0002.
- 2026-11-09: Etap 1 zakończony testem na iPadzie z Apple Pencil: R-004 i R-008 `done`; R-005 `accepted` (iPad zdany, Android i tablet graficzny w Etapie 4).
- 2026-11-09: Etap 2 zakończony testem PC + iPad: R-006 i R-018 `done`; R-002 i R-003 `accepted` (link i wejście gościa działają, tworzenie w panelu i konta w Etapie 3); protokół w ADR 0004.
- 2026-11-09: Etap 3 zakończony testem PC + iPad: R-001, R-002, R-003, R-007, R-009, R-017, R-019 `done`; konta, sesje i zapis w ADR 0005.
- 2026-11-09: R-010 (nieskończone płótno) `done` po teście na iPadzie: widok lokalny (przesuwanie, zoom 10–500%), przyciski zoomu w rogu, dwa palce, Ctrl + kółko, narzędzie Ręka; plan w `docs/plan-infinite-canvas.md`.
- 2026-11-09: R-012 (linia, prostokąt, okrąg, tekst) `done` po teście ręcznym; elementy z polem `kind` w ADR 0006, plan w `docs/plan-shapes-and-text.md`.
- 2026-11-09: R-013 (kursory pozostałych osób) `done` po teście ręcznym; wiadomości `cursor` i `cursor_drop` bez zapisu, plan w `docs/plan-cursors.md`.
- 2026-11-10: R-015 (obrazy) `done` po teście ręcznym: wklejanie, wybór pliku, upuszczanie, zmiana rozmiaru i przesuwanie (operacja `update`), zdjęcia w SQLite; ADR 0007, plan w `docs/plan-images.md`.
- 2026-11-10: model obiektów: dodano R-021 (zaznaczanie, przesuwanie, skalowanie i obracanie wszystkich elementów), R-022 (edycja właściwości: kolor, grubość, styl, wypełnienie, przezroczystość, tekst), R-023 (usuń, duplikuj, kopiuj, kolejność, grupy); R-004 bez zmian (gumka dalej kasuje cały obiekt, nie obraz).
