# 0012. Testy iPada na PC: Playwright z Chromium w profilu iPada

- Status: accepted
- Data: 2026-11-11

## Kontekst
Priorytet 2 to iPad z Apple Pencil (N-003, N-010). Ręczne testy na prawdziwym iPadzie są powolne i zależą od sieci lokalnej, a wada układu (górny pasek zwijający się w "wieżę" na ekranie iPada) wyszła dopiero tam. Potrzebny jest sposób sprawdzania układu i podstawowego sterowania (rysik, palec, szczypanie, listy i panele) na PC, powtarzalnie.

## Rozważane opcje
1. **Playwright z WebKit na hoście.** Najbliżej Safari, ale zbudowany pod Ubuntu pakiet WebKit nie działa na Fedorze (wymaga ICU 74, libjxl 0.8, libjpeg 8 i libbacktrace; w Fedorze 43 jest tylko `libicu74`, reszty nie ma w repozytoriach). Odrzucone na hoście, ale działa w kontenerze (niżej).
2. **Playwright z Chromium i profilami iPada** (rozdzielczość, dotyk, gęstość pikseli). Działa na Fedorze, pozwala wysyłać zdarzenia rysika (`pointerType: pen`, nacisk) i dotyku (kilka palców) przez CDP. Wybrane.
3. **Wyłącznie prawdziwy iPad w sieci lokalnej.** Zostaje jako uzupełnienie dla Pencil i Safari, ale nie nadaje się do regresji.

## Decyzja
- Testy end-to-end w `web/e2e/` (`@playwright/test`), uruchamiane przez `cd web && npm run test:e2e`. Konfiguracja startuje własny serwer z pustą bazą na porcie 8199 (`webServer`), więc nie ruszają danych deweloperskich. Nie wchodzą w `npm test` (vitest je pomija).
- Trzy profile: iPad Pro 11 pionowo i poziomo oraz iPad Mini (najwęższy).
- Pierwsze testy: układ (pasek narzędzi w jednym rzędzie, nic nie wystaje poza ekran, listy i panele mieszczą się), rysik (rysuje, zaznacza, przesuwa, gumka), palec (przesuwa tablicę i nic nie rysuje, szczypanie zmienia zoom, tapnięcia w przyciski), cofnij i ponów.
- Naprawa, która wyszła z pierwszego uruchomienia: `.topbar` ma `left: 50%`, więc kontener `position: fixed` miał do dyspozycji tylko połowę ekranu i zawijał pasek w cztery rzędy. Teraz ma `width: max-content`, na wąskim ekranie (do 860 px) nazwa i osoby są u góry, a narzędzia pod spodem, nieco ciaśniej.

## Uzupełnienie: WebKit w kontenerze
Te same testy biegną też w WebKit, w oficjalnym obrazie Playwrighta (`mcr.microsoft.com/playwright:v<wersja>-noble`, około 2 GB, `podman`): `cd web && npm run test:e2e:webkit` (skrypt `e2e/webkit.sh` buduje klienta i serwer, uruchamia serwer na hoście z pustą bazą i woła kontener z `--network host`). WebKit nie ma odpowiednika CDP dla rysika i kilku palców, więc tam `pen` i `fingers` w `e2e/helpers.ts` wysyłają te same zdarzenia wskaźnika (`PointerEvent` typu pen i touch) bezpośrednio na płótno; przy zdarzeniach sztucznych wyłączone jest tylko `setPointerCapture`. Sprawdzone: po cofnięciu poprawki paska testy układu w WebKit padają (6 z 9), po jej przywróceniu wszystkie 54 przechodzą.

## Konsekwencje
- WebKit z Playwrighta to ten sam silnik co Safari, ale na Linuksie i bez prawdziwego Apple Pencil: nacisk i opóźnienie rysika, palm rejection systemu iPadOS i pamięć płótna iPada wymagają nadal testu na prawdziwym iPadzie.
- Nowa zależność deweloperska (`@playwright/test`) i pobranie przeglądarki (`npx playwright install chromium`).
- Przy dodawaniu interfejsu (nowy panel, lista) warto dopisać test "mieści się na ekranie iPada".
