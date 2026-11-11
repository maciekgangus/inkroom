# 0012. Testy iPada na PC: Playwright z Chromium w profilu iPada

- Status: accepted
- Data: 2026-11-11

## Kontekst
Priorytet 2 to iPad z Apple Pencil (N-003, N-010). Ręczne testy na prawdziwym iPadzie są powolne i zależą od sieci lokalnej, a wada układu (górny pasek zwijający się w "wieżę" na ekranie iPada) wyszła dopiero tam. Potrzebny jest sposób sprawdzania układu i podstawowego sterowania (rysik, palec, szczypanie, listy i panele) na PC, powtarzalnie.

## Rozważane opcje
1. **Playwright z WebKit.** Najbliżej Safari, ale zbudowany Ubuntu pakiet WebKit nie działa na Fedorze (wymaga ICU 74, libjxl 0.8, libjpeg 8 itd.; `playwright install-deps` zakłada apt). Odrzucone.
2. **Playwright z Chromium i profilami iPada** (rozdzielczość, dotyk, gęstość pikseli). Działa na Fedorze, pozwala wysyłać zdarzenia rysika (`pointerType: pen`, nacisk) i dotyku (kilka palców) przez CDP. Wybrane.
3. **Wyłącznie prawdziwy iPad w sieci lokalnej.** Zostaje jako uzupełnienie dla Pencil i Safari, ale nie nadaje się do regresji.

## Decyzja
- Testy end-to-end w `web/e2e/` (`@playwright/test`), uruchamiane przez `cd web && npm run test:e2e`. Konfiguracja startuje własny serwer z pustą bazą na porcie 8199 (`webServer`), więc nie ruszają danych deweloperskich. Nie wchodzą w `npm test` (vitest je pomija).
- Trzy profile: iPad Pro 11 pionowo i poziomo oraz iPad Mini (najwęższy).
- Pierwsze testy: układ (pasek narzędzi w jednym rzędzie, nic nie wystaje poza ekran, listy i panele mieszczą się), rysik (rysuje, zaznacza, przesuwa, gumka), palec (przesuwa tablicę i nic nie rysuje, szczypanie zmienia zoom, tapnięcia w przyciski), cofnij i ponów.
- Naprawa, która wyszła z pierwszego uruchomienia: `.topbar` ma `left: 50%`, więc kontener `position: fixed` miał do dyspozycji tylko połowę ekranu i zawijał pasek w cztery rzędy. Teraz ma `width: max-content`, na wąskim ekranie (do 860 px) nazwa i osoby są u góry, a narzędzia pod spodem, nieco ciaśniej.

## Konsekwencje
- Chromium nie jest Safari: błędy specyficzne dla WebKit (np. obsługa `touch-action`, zdarzeń `pointer` w iPadOS, pamięć płótna) wymagają nadal testu na prawdziwym iPadzie.
- Nowa zależność deweloperska (`@playwright/test`) i pobranie przeglądarki (`npx playwright install chromium`).
- Przy dodawaniu interfejsu (nowy panel, lista) warto dopisać test "mieści się na ekranie iPada".
