# 0029. Wideo z nagrania renderowane na serwerze, w tle

- Status: accepted
- Data: 2026-11-25

## Kontekst
ADR 0028 zapisuje lekcję jako dźwięk i oś zdarzeń i odtwarza ją w aplikacji. Wideo (30 kl./s) ma powstawać dla wszystkich i bez udziału komputera prowadzącego: godzina renderowania w przeglądarce z otwartą kartą nie ma sensu, a kodowanie na komputerze, na którym trwa lekcja, uderzałoby w priorytet 1 (responsywność). Pomiar na VM z 4 vCPU: Chromium bez interfejsu koduje 720p przez WebCodecs 48 do 71 klatek na sekundę (programowo), czyli godzina lekcji to około pół godziny pracy, około 0,5 do 1 GB pamięci.

## Rozważane opcje
1. **Renderowanie w przeglądarce klikającego.** Bez kosztu serwera, ale trzeba czekać z otwartą kartą i wysyłać plik; nie nadaje się do wspólnego, zapisanego filmu.
2. **Chromium w obrazie aplikacji.** Jedna usługa mniej, ale obraz rośnie o setki MB, aplikacja wystawiona do internetu zyskuje przeglądarkę bez piaskownicy i ciężka praca dzieli proces z rysowaniem na żywo.
3. **Osobny kontener-robotnik (Node, Playwright, ffmpeg)**, który odbiera zlecenia od aplikacji. Izolowany, z limitami procesora i pamięci, można go wyłączyć, a aplikacja nie zmienia obrazu ani uprawnień.

## Decyzja
Opcja 3. **Robotnik** (`renderer/`, własny obraz i usługa w `deploy/docker-compose.yml`) pobiera zlecenia z wewnętrznego portu aplikacji `RENDER_ADDR` (jak `/metrics`: nie jest publikowany ani przekierowany przez tunel; wymaga `RENDER_TOKEN`; bez tokenu port jest wyłączony). Zlecenie to nagranie bez filmu (`video_state` w tabeli `recordings`: pusty, `queued`, `rendering`, `ready`, `failed`, z `video_progress`, `video_bytes`, `video_attempts`).

**Rysowanie.** Robotnik otwiera w Chromium bez interfejsu stronę odtwarzacza w trybie renderowania (`/b/<tablica>/r/<nagranie>?render=1`), która wystawia `window.__replay` z synchronicznym `draw(t)`: ten sam `ReplayEngine` i `CanvasRenderer` co odtwarzacz, kursory i lasery dorysowane na płótnie złożonym z warstw, bez interfejsu. Klatki nie przechodzą przez zrzuty ekranu: strona koduje je sama (`VideoEncoder`, H.264, format Annex B, 30 kl./s) i oddaje kawałki robotnikowi, który przekazuje je do `ffmpeg` (`-f h264`). Chromium dostaje `--unsafely-treat-insecure-origin-as-secure` dla adresu wewnętrznego aplikacji, bo WebCodecs wymaga bezpiecznego kontekstu.

**Dźwięk.** `ffmpeg` bierze ścieżkę prowadzącego i ścieżki uczestników (R-116) z bucketu, przesuwa je o ich przesunięcie (`adelay`), miksuje (`amix`) i koduje do AAC; wynik to `video.mp4` z `faststart`. Film jest pod prefiksem nagrania (`<id>/video.mp4`), więc usunięcie nagrania usuwa go razem z resztą.

**Wysyłanie i pobieranie.** Robotnik prosi aplikację o podpisany adres do zapisu (`PutURL`; dla zapasu na dysku adres wewnętrzny aplikacji), wysyła jednym PUT-em i zgłasza koniec z rozmiarem. Pobieranie to przekierowanie na podpisany adres, jak dla nagrania (R-094).

**Zasoby.** Jedno renderowanie naraz (`RENDER_JOBS`), niski priorytet (`nice`, limit procesora kontenera), limit pamięci kontenera. **W trakcie nagrywania** robotnik renderuje tylko wtedy, gdy obciążenie serwera jest niskie (`RENDER_LIVE_MAX_LOAD`): idzie za segmentami osi, które twórca wysyła co około 10 s, tak że po zakończeniu zostaje tylko ogon klatek i miksowanie dźwięku (sekundy, nie pół godziny). Gdy zasobów brakuje, nagranie czeka w kolejce do końca lekcji i renderuje się po niej. Porażka (awaria Chromium, brak segmentu) ponawia zlecenie kilka razy, potem `failed` z komunikatem w logu; lista pokazuje błąd, a odtwarzacz z osi zdarzeń dalej działa.

**Etapy:** (1) prototyp robotnika na istniejącym nagraniu: tryb renderowania strony, kodowanie, ffmpeg, pomiar czasu i rozmiaru; (2) protokół zleceń, kolumny, wysyłanie, stan na liście i „Pobierz wideo”, kontener w `deploy/`; (3) renderowanie w trakcie nagrywania; (4) miksowanie ścieżek uczestników razem z R-116.

## Pomiary prototypu (etap 1)
VM 4 vCPU, 720p, 30 kl./s, 2 Mb/s, H.264 programowo. Prosta tablica (16 s): 2 s renderowania, 8,4 razy szybciej niż czas rzeczywisty; MP4 ma oba strumienie (H.264 i AAC) po 16,3 s i dekoduje się bez błędów. Bardzo gęsta godzina (syntetyczna: 4000 pociągnięć, 305 tys. zdarzeń, kamera i kursor w ciągłym ruchu, więc żadna klatka się nie powtarza), pierwsze 20 minut: 13 minut renderowania (1,5 raza szybciej niż czas rzeczywisty), średnio 1,5 rdzenia (szczyt 2), do 2,1 GB pamięci (wszystkie procesy Chromium, z całą godziną logu w pamięci), 292 MB wideo. Wniosek: renderowanie w trakcie nagrywania nadąża (1,5 raza szybciej niż czas rzeczywisty), ale potrzebuje 1,5 do 2 rdzeni i do 3 GB pamięci kontenera; typowa lekcja z długimi nieruchomymi fragmentami wyjdzie wyraźnie szybciej i lżej. Nie wykonano jeszcze pełnej godziny; znane usprawnienia (nierysowanie klatki, gdy nic się nie zmieniło, niższy bitrate) są w etapie 2.

## Konsekwencje
- Nowy kontener (Chromium plus ffmpeg, rzędu setek MB), nowy kod robotnika w Node (osobne testy) i wewnętrzny port aplikacji.
- Film jest tym samym obrazem co odtwarzacz z osi zdarzeń, bo korzysta z tego samego silnika i renderera.
- Priorytet 1 jest chroniony: robotnik nie dzieli procesu z aplikacją, ma niski priorytet, a przy wysokim obciążeniu czeka.
- Wideo zajmuje w buckecie około od kilkudziesięciu do kilkuset MB na godzinę (statyczna tablica pakuje się dobrze).
- Renderowanie w trakcie nagrywania wymaga silnika, który przyjmuje segmenty w miarę ich napływania; wczesne etapy mogą obejść się bez tego.
- Ciężkie tablice (R-043) wydłużą renderowanie; rysowanie klatek bez zmian jest pomijane przy kodowaniu (powtórzona klatka).
