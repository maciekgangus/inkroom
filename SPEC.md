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
| R-021 | Każdy rysowany element (kreska, linia, prostokąt, okrąg, tekst, obraz) jest obiektem: kreska odręczna to jeden obiekt (zbiór punktów) zaznaczany, przesuwany i kasowany w całości. Narzędzie "Zaznacz" łapie obiekt (klik) lub kilka (ramka, Shift) i pozwala je przesuwać, skalować i obracać; każdy uczestnik z prawem rysowania może edytować cudze obiekty (jak R-004) | P2 | done |
| R-022 | Edycja właściwości zaznaczonych obiektów: kolor, grubość linii (rozmiar czcionki dla tekstu), styl linii (ciągła, kreskowana, kropkowana), wypełnienie kształtów, przezroczystość, treść tekstu (dwuklik); zmiana jest cofalna (R-008) i widoczna dla wszystkich (R-006) | P2 | done |
| R-023 | Operacje na zaznaczeniu: usuń, duplikuj, kopiuj i wklej, na wierzch i na spód (kolejność warstw), grupowanie obiektów w stałą grupę | P3 | proposed |
| R-025 | Rozszerzona paleta kolorów: 5 szybkich kolorów zostaje w pasku narzędzi, a obok wysuwany panel z ok. 12 dodatkowymi kolorami i dowolnym kolorem z próbnika; wybrany kolor działa dla pióra, kształtów i tekstu | P2 | done |
| R-026 | Tryb ciemny całej aplikacji, łącznie z tablicą: domyślnie według ustawienia systemu, ręczny przełącznik zapamiętywany na urządzeniu; to ustawienie osobiste, niewspółdzielone. Domyślny czarny tusz jest w trybie ciemnym wyświetlany jako biały (a biały jako czarny), pozostałe kolory bez zmian, więc ta sama tablica jest czytelna w obu trybach | P2 | done |
| R-027 | Tło tablicy do wyboru: gładkie, kropki, kratka, linie; wspólne dla wszystkich na tablicy, ustawia je twórca, zapisuje się razem z tablicą i zmienia u wszystkich na żywo; tło przesuwa się i skaluje razem z płótnem | P2 | done |
| R-028 | Menu kontekstowe i kontrolki obrazu zależne od urządzenia. Rozróżnienie po głównym wskaźniku wejścia (`(hover: hover) and (pointer: fine)` to PC, inaczej tablet), nie po User-Agent. PC: w głównym pasku jedna ikona wstawienia obrazu z pliku; prawy przycisk myszy na obiekcie otwiera menu (kopiuj, wklej, duplikuj, usuń, na wierzch, na spód), na pustym miejscu menu (wklej obiekt lub obraz ze schowka w miejscu kliknięcia, wstaw obraz z pliku). Tablet: w głównym pasku ikony wstawienia i wklejenia obrazu, bez menu kontekstowego (menu na długie przytrzymanie dopiero po teście na iPadzie). Operacje cofalne (R-008) i widoczne dla wszystkich (R-006); realizuje z R-023 kopiuj, wklej, duplikuj, usuń i kolejność warstw, grupowanie zostaje w R-023 | P2 | proposed |
| R-029 | Prawy przycisk myszy nigdy nie rysuje ani nie zaznacza przeciąganiem. Przeciągnięcie nim przesuwa widok, tak jak narzędzie Ręka, ale tylko chwilowo (wybrane narzędzie się nie zmienia), do szybkiego poruszania się po tablicy. Menu kontekstowe z R-028 otwiera się dopiero po puszczeniu przycisku bez przesunięcia (próg kilku pikseli). Poprawia i uzupełnia R-028 | P2 | done |
| R-030 | Skróty klawiszowe narzędzi, podane w podpowiedzi przycisku: F pióro, T tekst, M łapka (przesuwanie tablicy), Esc narzędzie Zaznacz (łapka do obiektów), E gumka, L linia, K kształty (R-033). Do tego dotychczasowe Ctrl+Z, Ctrl+Shift+Z, Ctrl+C, Ctrl+V, Ctrl+D i Delete. Skróty nie działają podczas pisania tekstu. Kursor myszy pokazuje włączone narzędzie (ołówek, kółko gumki o jej rozmiarze, celownik, tekst, otwarta i zamknięta dłoń, strzałka). Otwarte: skróty dla obrazu, kolorów i grubości | P2 | done |
| R-031 | Grubość i przezroczystość jako suwaki w panelu właściwości zamiast trzech przycisków: grubość w pikselach (dla tekstu to rozmiar czcionki), przezroczystość w procentach, przy suwaku widoczna wartość liczbowa. Zmiana podczas przeciągania jest podglądem, a jedno puszczenie suwaka to jeden krok cofania (R-008). Zmienia R-022 | P2 | proposed |
| R-032 | Siatka tła dopasowana do przybliżenia, jak w IDROO: rysowana na tym samym płótnie i w tym samym przebiegu co elementy, więc zawsze leży dokładnie na współrzędnych tablicy i nie dryfuje względem obiektów przy przesuwaniu ani zoomie. Odstęp linii (kropek) trzyma się na ekranie w stałym przedziale: przy oddalaniu co drugie linie znikają, przy przybliżaniu pojawiają się gęstsze (zawsze podzielniki tego samego rastra), a przejście jest płynne (zanikanie, bez skoków). Zawsze widać jakiś poziom odniesienia. Zmienia sposób rysowania z R-027 (wybór i wspólność tła bez zmian) | P2 | proposed |
| R-033 | Kształty jako jedna kategoria narzędzi w jednym przycisku paska z rozwijaną listą rodzajów: na początek prostokąt, okrąg i owal, trapez, romb, równoległobok (kolejne dopisywane bez zmiany układu paska). Rodzaj wybiera użytkownik klikając go na liście; skrót K włącza narzędzie kształtu z ostatnio wybranym rodzajem (domyślnie prostokąt) i niczego nie przełącza ani nie zmienia. Wybrany rodzaj zostaje aktywny, więc można narysować wiele kształtów pod rząd. Każdy rodzaj zaznacza się, skaluje, obraca i stylizuje jak dotychczasowe kształty (R-021, R-022) i ma wspólne ułatwienia rysowania z R-024 | P2 | proposed |
| R-034 | Zaznaczanie, które nie zasłania treści: trafienie w obiekt jest hojne (10 px, łatwo złapać cienką linię czy napis), a zaznaczony element świeci wzdłuż samego kształtu (poświata jak neon). Sterowanie jest takie samo jak wcześniej dla każdego elementu: uchwyty skali w rogach i uchwyt obrotu działają także dla pojedynczej kreski, linii i napisu. Różni się tylko wygląd: obrys prostokątnej ramki jest rysowany dla obrazów, kształtów i zaznaczenia wielu obiektów, a pojedyncza kreska, linia i napis pokazują samą poświatę i uchwyty, bez obrysu. Zmienia wygląd zaznaczenia z R-021 | P2 | proposed |
| R-035 | Przenośny schowek tablicy: kopiowanie zaznaczenia wkłada do schowka systemowego tekst w jawnym, wersjonowanym formacie JSON (znacznik `inkroom`, numer wersji, elementy w układzie tablicy), więc wklejenie działa na tej samej tablicy, na innej tablicy, w innej karcie i innej przeglądarce, a format jest łatwy do odczytania i zamiany przez inne narzędzia. Wklejenie nadaje nowe identyfikatory i autora oraz kładzie elementy w miejscu kliknięcia lub kursora. Obrazy wklejane między tablicami muszą zostać przesłane na docelową tablicę. Zastępuje wewnętrzny schowek z R-028 | P2 | proposed |
| R-036 | Zmiana rozmiaru uchwytem narożnym jest swobodna: szerokość i wysokość zmieniają się niezależnie, wzdłuż osi ramki (także obróconej), bez odwracania i zapadania się; z Shiftem proporcje zostają. Okrąg i tekst nie mają postaci rozciągniętej, więc rosną równomiernie (średnia geometryczna obu czynników). Obrót grupy obraca też jej ramkę i nie zmienia jej rozmiaru (ramka nie puchnie na rogach obróconych elementów); ramka grupy wraca do pionowej po zmianie zaznaczenia lub cofnięciu. Zmienia skalowanie z R-021 | P2 | proposed |

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
- 2026-11-10: R-021 i R-022 `done` po teście ręcznym: zaznaczanie, przesuwanie, skalowanie i obracanie wszystkich elementów, panel właściwości (kolor, grubość, styl, wypełnienie, przezroczystość), edycja tekstu dwuklikiem; ADR 0008, plan w `docs/plan-object-model.md`. R-023 zostaje `proposed`.
- 2026-11-09: dodano R-025 (rozszerzona paleta kolorów), R-026 (tryb ciemny z tablicą) i R-027 (wspólne tło tablicy ustawiane przez twórcę).
- 2026-11-10: dodano R-028 (menu kontekstowe pod prawym przyciskiem i kontrolki obrazu zależne od urządzenia: ikona w głównym pasku zamiast pływających przycisków; bez menu na dotyk).
- 2026-11-10: dodano po teście R-028 (grupa wymagań ergonomii tablicy, `proposed`): R-029 (prawy przycisk przesuwa widok i nie rysuje), R-030 (skróty klawiszowe przycisków), R-031 (suwaki grubości w pikselach i przezroczystości w procentach, zmienia R-022), R-032 (siatka tła rysowana na płótnie, poziomy zależne od zoomu, zmienia R-027).
- 2026-11-10: skróty ustalone (F, M, Esc, E, L, K, zmiana R-030); dodano R-033 (kategoria kształtów z rozwijaną listą: trapez, romb, równoległobok), R-034 (zaznaczenie jako neonowe podświetlenie zamiast ramki), R-035 (przenośny schowek JSON między tablicami).
- 2026-11-10: doprecyzowano skróty (F to pióro, T to tekst, K włącza ostatnio wybrany kształt; rodzaj wybiera się klikiem na liście): zmiana R-030 i R-033.
- 2026-11-10: R-029 (prawy przycisk przesuwa widok) i R-030 (skróty narzędzi) `done` po teście ręcznym; dodano kursor zależny od narzędzia.
- 2026-11-10: dodano R-036 (swobodne skalowanie z Shiftem na proporcje, ramka grupy obraca się razem z nią i zachowuje rozmiar).
