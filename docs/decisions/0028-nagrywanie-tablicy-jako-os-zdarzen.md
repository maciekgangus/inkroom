# 0028. Nagrywanie tablicy jako dźwięk i oś zdarzeń, z własnym odtwarzaczem

- Status: accepted
- Data: 2026-11-25

## Kontekst
R-094 nagrywał wideo z ekranu prowadzącego (`getDisplayMedia`). W próbach wyszło, że to „suche” nagranie: zależy od klatek przeglądarki i kodera (szybkie przesuwanie się rozmywa i szarpie), wymaga wyboru okna, nie działa na iPadzie i w przeglądarce bez https, a wideo to około 2 GB na godzinę. Aplikacja zna jednak dokładnie to, co się dzieje na tablicy (pociągnięcia, widok, kursory), więc może to zapisać jako dane i odtworzyć na żądanie.

## Rozważane opcje
1. **Wideo z ekranu** (stan sprzed tej decyzji). Zrobione, ale szarpie, jest ciężkie i nie działa wszędzie.
2. **Wideo z płótna** (`canvas.captureStream`). Bez wyboru ekranu, ale dodatkowe rysowanie 30 razy na sekundę obciąża rysowanie na żywo (priorytet 1), a nagranie nadal jest wideo o stałej jakości.
3. **Oś zdarzeń i dźwięk, odtwarzane własnym odtwarzaczem, z eksportem do wideo na życzenie.** Nagrywanie prawie nic nie kosztuje, plik jest o rząd wielkości mniejszy, odtwarzanie jest płynne z założenia (rysowane w tempie ekranu, z interpolacją kamery), a wideo 30 kl./s powstaje tylko wtedy, gdy ktoś go chce.

## Decyzja
Opcja 3. **Nagranie** to: ścieżka dźwięku twórcy tablicy (MP4/AAC lub WebM/Opus, jak potrafi przeglądarka), oś zdarzeń i ewentualne ścieżki głosu uczestników (R-116). Wszystkie obiekty nagrania leżą pod wspólnym prefiksem `<id nagrania>/` w buckecie lub w katalogu: `audio.<ext>`, `snapshot.json` (stan początkowy), `events/<n>.json` (segmenty osi), `voice/<id ścieżki>.<ext>`. Usunięcie nagrania usuwa cały prefiks.

**Oś zdarzeń** to tablice `[t, typ, dane]`, gdzie `t` to milisekundy od początku nagrania. Typy: operacje na elementach tak, jak idą po WebSocketcie (`add`, `update`, `remove`, `live` z punktami w trakcie rysowania), `bg` (tło), `view` (prostokąt widoku twórcy z rozmiarem okna), `cursor` i `laser` (pozycje i ślady). Klient nagrywającego widzi wszystko, co dotyczy tablicy (własne i cudze operacje), więc to on pisze oś; serwer nie przepuszcza jej przez siebie. Zapis ma numer wersji (`v`), żeby odtwarzacz mógł obsłużyć starsze nagrania. Przechwytywanie jest opcjonalnym podsłuchem w kliencie synchronizacji, wyłączonym poza nagrywaniem, więc zwykłe rysowanie nie płaci za nic.

**Wysyłanie.** Dźwięk jak dotąd: części po 5 MiB do bucketu przez podpisane adresy. Oś: segmenty co około 10 s i stan początkowy jako pojedyncze obiekty, adres podpisywany osobno dla każdego (`POST .../events/{n}`; dla dysku adres serwera). Serwer zapisuje najwyższy numer segmentu, więc zerwane nagranie da się zakończyć bez listowania bucketu. Ścieżki uczestników to osobne przesyłania wieloczęściowe z tabeli `recording_tracks` (nazwa, przesunięcie względem początku nagrania, stan); przesunięcie liczy się z zegara serwera (klient pyta o czas serwera, odejmuje połowę czasu obiegu), a dla gości działają limity na adres jak przy obrazach.

**Odtwarzanie.** `GET .../play` zwraca indeks (czas trwania, wersja, adresy podpisane do odczytu stanu, segmentów i ścieżek). Odtwarzacz składa stan z początkowego obiektu i zdarzeń do chwili `t`, rysuje istniejącym `CanvasRenderer` w tempie ekranu i prowadzi się za zegarem dźwięku (`currentTime`). Przewijanie liczy stan od najbliższego punktu kontrolnego (pełny stan co minutę, budowany przy wczytaniu), kamera jest interpolowana. Wszystkie ścieżki grają równolegle.

**Eksport do wideo (R-115).** Odtwarzacz renderuje co 1/30 s na płótno, `MediaRecorder` nagrywa płótno razem z zmiksowanym dźwiękiem (`AudioContext`), plik pobiera klikający. Pierwsza wersja działa w czasie rzeczywistym; szybka (WebCodecs z biblioteką do MP4) później.

**Etapy:** (1) nagrywanie dźwięku i osi, serwer (obiekty, segmenty, indeks), odtwarzacz bez eksportu; (2) ścieżki uczestników; (3) eksport w czasie rzeczywistym; (4) szybki eksport. Kod nagrywania ekranu z R-094 jest usuwany, gdy etap 1 działa.

## Konsekwencje
- Rysowanie na żywo i wydajność dużych tablic (R-043) praktycznie bez zmian; koszt jest po stronie odtwarzania i eksportu.
- Pliki są małe (dźwięk około 40 MB na godzinę plus kilka MB zdarzeń), więc koszt bucketu i łącza maleje o rząd wielkości.
- Nagrywać może też iPad (potrzebny tylko mikrofon, na https lub localhost).
- Odtwarzanie wymaga, by obrazy z tablicy jeszcze istniały; usunięty obraz da zastępczy prostokąt. Wygląd tekstu zależy od załadowanych czcionek (do sprawdzenia w prototypie).
- Format zdarzeń jest nowym kontraktem: zmiana typów elementów wymaga zgodności wstecz odtwarzacza.
- Ścieżki uczestników zależą od synchronizacji zegarów; błąd rzędu dziesiątek milisekund jest tu bez znaczenia dla głosu.
- Przewijanie dużych nagrań może być wolne; punkty kontrolne i limit liczby zdarzeń do zmierzenia w prototypie.
