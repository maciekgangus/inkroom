# Plan Etapu 3: konta i zapis

Stan na 2026-11-09. Źródła: `SPEC.md` (R-001, R-002, R-007, R-009, R-017, R-019, N-004, N-007, N-008), `docs/decisions/0005-accounts-and-persistence.md`, ADR 0001 i 0004.

Gotowe, gdy: po zamknięciu karty (a także po restarcie kontenera) tablica wraca w tym samym stanie, a twórca widzi swoje tablice w panelu (SPEC, Etap 3).

Zasady: najpierw test i potwierdzenie, że pada; potem implementacja. Małe commity. Bez abstrakcji "na zapas". Nie ruszać plików `.env`.

## Założenia (do potwierdzenia)
1. Decyzje jak w ADR 0005: tabela bieżącego stanu (zamiast dziennika z ADR 0001), zapis z opóźnieniem ok. 500 ms, wczytanie pokoju przy pierwszym wejściu i usunięcie z pamięci po wyjściu ostatniej osoby, `argon2id`, sesje w ciasteczku.
2. **Bez** weryfikacji e-mail i odzyskiwania hasła w MVP.
3. Tablicę tworzy tylko zalogowany (z nazwą). Anonimowe `POST /api/boards` z Etapu 2 znika.
4. Zalogowany nie jest pytany o imię; jego imieniem jest część e-maila przed `@`.
5. Panel: dwie listy ("Moje tablice" i "Tablice, do których mam dostęp"), nazwa, data ostatniej zmiany, kopiowanie linku, otwarcie, usunięcie z potwierdzeniem, zmiana nazwy.
6. Strona główna: niezalogowany widzi logowanie i rejestrację, zalogowany widzi panel.
7. **Poza zakresem:** uprawnienia "tylko oglądanie" (R-016), historia wersji (R-020), kursory (R-013), kopie zapasowe (Etap 3.5).

## Kroki
1. **Branch** `feature/accounts-persistence` i ADR 0005 (status `accepted` po Twojej akceptacji; odsyłacz w ADR 0001).
2. **Magazyn SQLite** (testy najpierw, plik tymczasowy): migracje, użytkownicy, sesje, tablice, wpisy dostępu, kreski (zapis partii, wczytanie, usunięcie tablicy kasuje wszystko).
3. **Konta i sesje:** rejestracja, logowanie, wylogowanie, `GET /api/me`; haszowanie `argon2id`, ciasteczko, ograniczanie prób logowania. Testy: zły e-mail i hasło, duplikat, krótkie hasło, ciasteczko, wygasła sesja.
4. **API tablic:** `POST /api/boards` (zalogowany, nazwa), `GET /api/boards` (moje i z dostępem), `PATCH` nazwy, `DELETE` (tylko właściciel), `GET /api/boards/{id}` (200/404). Testy uprawnień.
5. **Zapis w pokojach:** wczytanie z magazynu, zapis partiami w tle, zapis przy wyjściu ostatniej osoby i zamknięciu serwera, usunięcie pokoju z pamięci, usunięcie tablicy rozłącza obecnych. Test "restartu": nowy `Hub` na tym samym pliku widzi kreski. Wpis dostępu przy wejściu zalogowanego na cudzą tablicę.
6. **Klient:** stan logowania, formularze, panel z obiema listami, usuwanie z potwierdzeniem, kopiowanie linku, strona "nie ma takiej tablicy", pominięcie pytania o imię dla zalogowanego.
7. **docker compose:** restart kontenera zachowuje tablice (wolumen `data`), sprawdzenie ręczne i skryptem.
8. **Test na PC + iPadzie:** rejestracja, tablica, zamknięcie karty, powrót tym samym linkiem, restart kontenera, panel. Wynik do SPEC.md (R-001, R-002, R-003, R-007, R-009, R-017, R-019 na `done`), aktualizacja CLAUDE.md i PR.

## Otwarte
- Minimalna długość hasła i limit prób (propozycja: 8 znaków, 10 prób na 15 minut na e-mail i adres).
- Ochrona otwartej rejestracji przed nadużyciami: odłożona do Etapu 3.5.
