# IDROO MVP: specyfikacja

Status: wersja startowa z 2026-11-09. To jest źródło prawdy o wymaganiach. Zmiana wymagania = edycja wiersza i wpis w sekcji "Historia zmian".

## 1. Cel i zakres
Własna, tania tablica interaktywna do korepetycji online zamiast IDROO. Korepetytor i uczniowie piszą razem na tablicy w czasie rzeczywistym. Rdzeniem produktu są zapisane tablice: na kolejnych lekcjach wraca się do tej samej tablicy i kontynuuje pracę.

- Użytkownicy: korepetytor (właściciel tablic, pracuje na PC) i uczniowie (często iPady i inne tablety z rysikiem). Uczeń wchodzi jako gość przez link albo przez własne konto, obie opcje są dozwolone.
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
| R-001 | Rejestracja i logowanie korepetytora (e-mail i hasło) | P1 | proposed |
| R-002 | Tworzenie pokoju z unikalnym linkiem do udostępnienia | P1 | proposed |
| R-003 | Wejście ucznia przez link jako gość (podaje imię) albo po zalogowaniu na własne konto | P1 | proposed |
| R-004 | Rysowanie na płótnie: pióro, gumka, kolor, grubość linii | P1 | proposed |
| R-005 | Obsługa myszy, dotyku i rysika (Pointer Events, nacisk rysika) | P1 | proposed |
| R-006 | Współpraca na żywo: wszyscy w pokoju widzą zmiany w czasie rzeczywistym | P1 | proposed |
| R-007 | Automatyczny zapis stanu tablicy; powrót do tej samej tablicy i kontynuacja pracy na kolejnych lekcjach | P1 | proposed |
| R-008 | Cofnij i ponów | P1 | proposed |
| R-009 | Lista zapisanych tablic korepetytora (nazwa, data ostatniej zmiany, otwarcie, usunięcie) | P2 | proposed |
| R-010 | Nieskończone lub przewijane płótno, przesuwanie i powiększanie | P2 | proposed |
| R-011 | Kilka stron (kart) w jednej tablicy | P2 | proposed |
| R-012 | Narzędzia: linia, prostokąt, okrąg, tekst | P2 | proposed |
| R-013 | Wskaźniki kursorów pozostałych osób na tablicy | P2 | proposed |
| R-014 | Eksport tablicy do PNG lub PDF | P2 | proposed |
| R-015 | Wstawianie obrazu (np. zadanie ze zdjęcia) | P3 | proposed |
| R-016 | Uprawnienia ucznia: tylko podgląd lub rysowanie, włączane przez korepetytora | P3 | proposed |
| R-017 | Konto ucznia: logowanie i dostęp do własnych zapisanych tablic | P2 | proposed |
| R-018 | Kilku uczniów jednocześnie w jednym pokoju | P2 | proposed |

## 4. Wymagania niefunkcjonalne
Miary to propozycje startowe, do potwierdzenia po pierwszych testach na prawdziwej lekcji.

| ID | Wymaganie | Miara |
| --- | --- | --- |
| N-001 | Opóźnienie pojawienia się kreski u drugiej osoby | do ok. 150 ms w typowej sieci |
| N-002 | Płynność rysowania własnej kreski | natychmiastowa lokalnie, bez widocznych przełamań, także na tablecie z rysikiem |
| N-003 | Przeglądarki | aktualny Chrome, Edge, Safari (w tym iPadOS) i Firefox |
| N-004 | Bezpieczeństwo kont | hasła haszowane, HTTPS, linki pokoi trudne do odgadnięcia |
| N-005 | Utrata połączenia | ponowne połączenie bez utraty narysowanych elementów |
| N-006 | Koszt hostingu | docelowo własny serwer domowy (VPS), bez miesięcznych opłat za hosting |
| N-007 | Dane uczniów | minimum danych (imię), brak śledzenia, możliwość usunięcia tablicy |
| N-008 | Obciążenie CPU serwera | niskie; stos dobrany pod oszczędność procesora |
| N-009 | Uruchamianie i wdrożenie | całość startuje jedną komendą `docker compose up`; ta sama konfiguracja lokalnie i na serwerze; sekrety w `.env` poza repo; dane (baza, zapisane tablice) w wolumenach z kopią zapasową (ADR 0002) |

## 5. Etapy
1. Etap 0, szkielet: wybór stosu (ADR 0001), repo, pusta aplikacja z testem. Gotowe, gdy działa komenda testowa, `docker compose up` uruchamia pustą aplikację i `claude` czyta CLAUDE.md.
2. Etap 1, tablica lokalna: płótno, pióro, gumka, mysz/dotyk/rysik, cofnij (R-004, R-005, R-008). Gotowe, gdy rysowanie rysikiem jest płynne na twoim tablecie i na iPadzie.
3. Etap 2, współpraca na żywo: pokój z linkiem, synchronizacja klientów (R-002, R-003, R-006). Gotowe, gdy dwie przeglądarki widzą wzajemnie swoje kreski.
4. Etap 3, konta i zapis: logowanie, zapis i odtworzenie stanu, lista tablic (R-001, R-007, R-009, R-017). Gotowe, gdy po zamknięciu karty tablica wraca w tym samym stanie.
5. Etap 3.5, wdrożenie: ten sam docker compose na domowym VPS, HTTPS, dostęp z internetu dla uczniów (sposób wystawienia do ustalenia), kopie zapasowe bazy (N-004, N-006, N-009). Gotowe, gdy iPad na danych komórkowych otwiera pokój.
6. Etap 4, pierwsza prawdziwa lekcja: test z jednym uczniem, lista poprawek. Gotowe, gdy lekcja przeszła bez powrotu do IDROO.
7. Etap 5: pozostałe P2 i P3 według tego, czego zabrakło na lekcji.

## 6. Otwarte pytania
- Gotowa biblioteka tablicy czy własny canvas (licencja, obsługa iPada, możliwość własnego serwera synchronizacji). Rozstrzyga ADR 0001.
- Hosting rozstrzygnięty w ADR 0002: docker compose lokalnie, później domowy VPS. Otwarte: jak wystawić serwer domowy na internet dla uczniów (tunel lub przekierowanie portów, domena, dynamiczny adres IP).

## 7. Historia zmian
- 2026-11-09: wersja startowa, uczeń jako gość lub z kontem, zapisane tablice jako rdzeń, dodane R-017 i R-018, N-008.
- 2026-11-09: wdrożenie przez docker compose (lokalnie, potem domowy VPS): zmieniono N-006, dodano N-009 i Etap 3.5, hosting rozstrzygnięty w ADR 0002.
