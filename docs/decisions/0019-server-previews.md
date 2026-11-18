# 0019. Podglądy tablic zapisane na serwerze

- Status: accepted
- Data: 2026-11-18

## Kontekst
R-088 (uwaga użytkownika: „ładowanie preview tablic powinno być szybsze”), rozstrzyga pomysł z R-080. Dziś kafelek pobiera dane całej tablicy (`GET /api/boards/{id}/preview`, wszystkie kreski jako JSON) i sam rysuje miniaturę (R-052). Przy dużych tablicach to dużo bajtów i dużo pracy klienta, a cache z R-080 pomaga dopiero od drugiego wejścia. Priorytet 3: serwer ma mało CPU.

## Rozważane opcje
1. **Serwer rysuje miniaturę** (Go): trzeba by powtórzyć w Go cały renderer klienta (kształty, tekst, układ współrzędnych, zdjęcia) i płacić CPU serwera. Odrzucone.
2. **Klient wysyła narysowaną miniaturę, serwer tylko ją trzyma** (wybrane): serwer nie rysuje nic, przechowuje bajty PNG (do 300 KB) razem ze znacznikiem wersji tablicy (ten sam ETag co dotąd: czas ostatniej zmiany i tło) i oddaje je jednym żądaniem.
3. Dane uproszczone (mniej punktów) zamiast obrazu: nadal rysowanie po stronie klienta, więc mniejszy zysk.

## Decyzja
- Tabela `board_previews(board_id, tag, png)`, kasowana razem z tablicą.
- `GET /api/boards/{id}/preview.png`: obraz, jeśli zapisany jest dla bieżącej wersji tablicy (ETag, 304 przy braku zmian); inaczej 404. Otwarte dla każdego z linkiem, jak dane podglądu.
- `PUT /api/boards/{id}/preview.png?tag=<ETag>`: tylko właściciel, `Content-Type: image/png` (nie jest „prostym” żądaniem między witrynami), sygnatura PNG, do 300 KB, a `tag` musi być bieżącą wersją (inaczej 409). Starsza wersja podglądu jest zastępowana.
- Kafelek najpierw prosi o obraz z serwera; przy 404 działa jak dotąd (dane + rysowanie), a kafelek właściciela po narysowaniu wysyła obraz na serwer, więc następny kafelek (dowolnego urządzenia) rysować już nie musi.

## Konsekwencje
- Podgląd jest generowany przy zmianie tablicy leniwie: pierwszy kafelek właściciela po zmianie. Tablice cudze, których właściciel nie otworzył panelu po zmianie, nadal rysuje klient odwiedzającego (dane + rysowanie), bez zapisu.
- Serwer nie weryfikuje, że obraz odpowiada tablicy (to miniatura własnej tablicy właściciela, nic więcej nie czyta ani nie wykonuje); sprawdza tylko typ, rozmiar i sygnaturę.
- Koszt serwera: zapis i odczyt do 300 KB na zmianę wersji, bez rysowania.
- Obraz ma tag z sekundową rozdzielczością (jak ETag dotąd): zmiany w tej samej sekundzie mogą pokazać poprzedni obraz do następnej zmiany.
