# 0026. Markdown i rodziny czcionek w tekście na tablicy

- Status: accepted
- Data: 2026-11-24

## Kontekst
R-101 i R-102: tekst na tablicy ma przyjmować formatowanie w Markdownie, mieć pasek formatowania w stylu edytora tekstu (czcionka, rozmiar, kolor) i dawać się poszerzać bez skalowania liter. Dotychczasowy pasek Markdown wstawiał znaczniki, ale płótno rysowało gołe źródło, więc „Markdown nie działał”. Priorytet 1 to responsywność, priorytet 2 tablet z rysikiem; serwer ma zostać bez zmian (element to nieprzezroczysty JSON).

## Rozważane opcje
1. **Edytor sformatowanego tekstu (contenteditable) i zapis HTML.** Najbliżej Worda, ale zapis HTML otwiera drogę do wstrzykiwania treści, kursor i zaznaczenie na iPadzie zachowują się nieprzewidywalnie, a płótno i tak musi rysować sam.
2. **Biblioteka Markdowna (markdown-it, marked).** Gotowy parser, ale zwraca HTML, jest duża i trzeba by ją czyścić; płótno potrzebuje struktury, nie HTML.
3. **Własny mały parser do danych (bloki i przebiegi ze znacznikami), układ i rysowanie z tej samej struktury.** Treść zostaje zwykłym tekstem w polu `text`.

## Decyzja
Opcja 3. `board/markdown.ts` czyta podzbiór (pogrubienie, kursywa, przekreślenie, kod, nagłówki 1 do 3, listy, cytat) do czystych danych, nigdy do HTML; niedomknięty lub niedopasowany znacznik zostaje tekstem. `board/text.ts` składa z tego układ (wiersze, przebiegi w jednej czcionce, wcięcia, znaczniki list), który jest jedynym źródłem dla rysowania, ramki zaznaczenia, trafiania i eksportu. Tekst bez żadnych znaczników idzie starą, niezmienioną ścieżką (to samo zawijanie i ta sama linia bazowa, R-081), więc stare tablice wyglądają dokładnie jak dotąd, a koszt dużych tablic się nie zmienia (układ jest liczony raz na element).

Rodzina czcionki to właściwość całego tekstu (`font`: `sans`, `serif`, `hand`, `mono`; brak to Inter), rozmiar i kolor też. Pogrubienie i reszta to znaczniki w treści. Czcionki (Inter z kursywą, Lora, Caveat, JetBrains Mono, z polskimi znakami) są w pakiecie aplikacji (`@fontsource`), a przeglądarka pobiera plik dopiero wtedy, gdy jakiś tekst go używa; układ prosi o załadowanie czcionki przy pierwszym użyciu i mierzy tekst jeszcze raz, gdy jest gotowa.

Pasek formatowania jest nad polem i zastępuje panel właściwości na czas pisania. Przyciski nie zmieniają fokusu (`mousedown` nie odbiera go polu), a zmiany źródła idą jako edycja pisana (`execCommand`), więc Ctrl+Z działa; czyste funkcje edycji (`md-edit.ts`) są testowane bez przeglądarki. Szerokość pola zmienia uchwyt na jego prawej krawędzi, a uchwyty środków boków zaznaczonego tekstu zmieniają tylko szerokość (tekst wstawiony kliknięciem staje się wtedy obszarem); uchwyty narożne skalują jak dotąd.

## Konsekwencje
- Serwer, baza i protokół bez zmian; nowe pole `font` i `width` elementu są opcjonalne, więc starszy klient je ignoruje (rysuje Interem).
- W edytorze podczas pisania widać źródło Markdowna, nie podgląd na żywo (poza zakresem).
- Układ tekstu zależy od załadowanych czcionek: pierwsze użycie nowej rodziny chwilę rysuje czcionką zastępczą, potem tekst jest przemierzany i przemalowany.
- LaTeX (R-103) może korzystać z tego samego parsera i układu (osobna decyzja o bibliotece składu).
