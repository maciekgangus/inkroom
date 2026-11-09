# 0007. Obrazy na tablicy i zmiana istniejących elementów

- Status: accepted
- Data: 2026-11-09

## Kontekst
R-015: wstawianie obrazu (np. zadanie ze zdjęcia), z możliwością zmiany jego rozmiaru, wklejeniem ze schowka i dodaniem z interfejsu. Obraz to binarny plik (zdjęcia z telefonu mają kilka MB), a dotąd elementy były małymi, niezmiennymi JSON-ami (ADR 0004, 0006). Zmiana rozmiaru i przesunięcie wymagają po raz pierwszy **zmiany istniejącego elementu**. Ograniczenia: tablica ma działać na danych komórkowych (N-001), niskie CPU (N-008), kopie zapasowe jednym plikiem (N-009), usunięcie tablicy usuwa jej dane (R-019, N-007).

## Rozważane opcje
Przechowywanie bajtów:
1. **Plik na dysku w `DATA_DIR/images/`** obok bazy. Prosty serwer plików, ale dwa miejsca do kopii zapasowej i sprzątania.
2. **BLOB w SQLite** (tabela `images`, `ON DELETE CASCADE` po tablicy). Jedna kopia (`sqlite3 .backup`), usunięcie tablicy czyści obrazy, bez osieroconych plików.
3. **Obraz jako data-URL w elemencie.** Odrzucone: puchnie snapshot wysyłany każdemu wchodzącemu i limit wiadomości 256 KiB.

Zmiana elementu:
1. **`remove` + `add` z nowym `id`** przy każdej zmianie rozmiaru. Zaśmieca historię i wyścigi (dwie osoby zmieniają ten sam obraz).
2. **Nowa operacja `update`** zastępująca element o tym `id`, ostatnia wygrywa (N-011).

## Decyzja
- **Bajty w SQLite (opcja 2).** Tabela `images(id, board_id, mime, data, created_at)`; `POST /api/boards/{id}/images` (surowe bajty, `Content-Type` obrazu) zwraca `{id}`, `GET /api/boards/{id}/images/{imageId}` oddaje bajty z `Cache-Control: immutable` (identyfikator jest losowy i nie zmienia treści). Wysyłać i pobierać może każdy, kto zna link do tablicy (tak jak rysować). Serwer sprawdza typ po zawartości (`http.DetectContentType`), przyjmuje tylko PNG, JPEG, WebP i GIF (nie SVG, bo to wektor z możliwym skryptem), ustawia `X-Content-Type-Options: nosniff` i odrzuca pliki ponad 5 MB.
- **Zmniejszanie po stronie klienta** przed wysłaniem: dłuższy bok do 2048 px, ponowne kodowanie do JPEG (jakość 0,85) gdy plik jest większy niż 1,5 MB lub większy wymiarowo. Oszczędza dane komórkowe i miejsce, a serwer nie dekoduje obrazów (CPU).
- **Element obrazu:** `kind: "image"`, `src` (identyfikator obrazu), `points` = dwa przeciwległe narożniki. Proporcje zachowuje interfejs.
- **Operacja `update {stroke}` (opcja 2):** zastępuje istniejący element o tym `id`; dla nieistniejącego (np. skasowanego) jest ignorowana, więc nie wskrzesza usuniętego. `add` zostaje "wstaw, jeśli brak", więc ponowne wysłanie starej wersji po ponownym połączeniu nie nadpisze nowszej zmiany. Kolejność ustala serwer jak dotąd. Zapis w bazie: `Op` dostaje wariant "zastąp".
- **Cofnij/ponów** dla zmiany to przywrócenie poprzedniej wersji (nowa akcja `update` w historii autora). Klient zapisuje wersję przed i po.
- **Gumka nie kasuje obrazów** (przeciągnięcie po pustym fragmencie zdjęcia skasowałoby całe zdjęcie przy pisaniu po nim). Obraz usuwa się przez zaznaczenie i Delete lub przycisk, co jest cofalne.
- **Warstwy:** obraz leży według `z` jak inne elementy (wklejony później leży wyżej), bez osobnej warstwy.

## Konsekwencje
- Serwer: nowa tabela (migracja), dwa endpointy, jedna operacja więcej w `Room` i `Store.Apply`. Protokół zyskuje `update`; stare tablice działają bez migracji danych.
- Zmiana modelu: elementy przestają być w pełni niezmienne (ADR 0004 do uzupełnienia odsyłaczem). Dotyczy tylko obrazów, ale operacja jest ogólna, więc przesuwanie i skalowanie innych elementów da się dodać później bez zmian w protokole.
- Rozmiar bazy rośnie z obrazami (ok. 0,2 do 1 MB po zmniejszeniu). Brak sprzątania obrazów osieroconych po skasowaniu elementu (cofnięcie może go przywrócić); do rozważenia przy kopiach zapasowych.
- Schowek: zdarzenie `paste` działa wszędzie (także po `http://`), a przycisk "Wklej z schowka" (`navigator.clipboard.read()`) wymaga HTTPS lub `localhost`, więc zadziała dopiero po wdrożeniu (Etap 3.5); do tego czasu ukryty.
