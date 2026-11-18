# 0020. Wykresy funkcji na układzie współrzędnych

- Status: accepted
- Data: 2026-11-18

## Kontekst
R-092: układ współrzędnych (R-084) ma pokazywać wykresy funkcji (liniowa, kwadratowa, trygonometryczne i inne) z edycją współczynników na żywo, widoczną u wszystkich na tablicy. Priorytety: responsywność (przesuwanie i zoom nie mogą liczyć krzywych od nowa), iPad, mało CPU serwera.

## Rozważane opcje
1. **Krzywa jako osobne obiekty tablicy** (po jednym na funkcję, z punktami): każda zmiana współczynnika to setki punktów w wiadomości, krzywa nie jest związana z układem (rozjeżdża się przy przesunięciu), gumka musiałaby je obchodzić. Odrzucone.
2. **Lista funkcji jako pole układu** (wybrane): układ dostaje `fns`, listę `{id, k, c, color, w, canon?}` (rodzaj wzoru, współczynniki, kolor, grubość). Zmiana współczynnika to zwykła zmiana właściwości obiektu (R-022): kilkaset bajtów, bez nowych wiadomości, razem z układem się przesuwa, skaluje i obraca, a gumka go nie rusza (układ jest dla niej jak obraz).
3. Wzór wpisany tekstem i parser: poza zakresem (R-092 mówi: później), a wymagałby bezpiecznego parsera.

## Decyzja
- Serwer niczego nie liczy i niczego nie waliduje szczegółowo: elementy tablicy są dla niego nieprzezroczystym JSON (limit wiadomości 256 KB, jak dotąd). Walidacja jest u odbiorcy: `sanitizeFns` (znany rodzaj, właściwa liczba współczynników, każdy ograniczony do ±1000, kolor `#rrggbb`, grubość 0,25 do 20, najwyżej 8 funkcji) działa przy wklejaniu ze schowka i przy zmianie właściwości; obcy lub zepsuty wpis jest odrzucany.
- Krzywa jest liczona na kliencie w `board/functions.ts`: próbkowanie co 0,5 jednostki tablicy wzdłuż x (najwyżej 4000 punktów), przerwa linii tam, gdzie funkcja jest nieokreślona i na asymptotach (skok wyższy niż arkusz, punkty dalej niż wysokość arkusza od niego są pomijane), odcięcie do arkusza przy rysowaniu (`clip`).
- Jednostką jest oczko siatki; w numeracji π (R-084) jednostką x jest radian (dwanaście oczek to π), więc wykres zgadza się z opisem osi.
- Ścieżki krzywych są liczone raz na wersję elementu (pamięć podręczna w `extraPaths`, razem z siatką), więc przesuwanie i zoom widoku tylko przerysowują gotowe ścieżki.
- Edycja w panelu właściwości układu (`function-editor.tsx`): pola liczbowe i suwaki, kolor, grubość, przełącznik postaci kanonicznej paraboli (współczynniki przeliczane tak, że krzywa się nie zmienia). Ruch suwaka to podgląd, puszczenie to zmiana.

## Konsekwencje
- Rozmiar układu nie zmienia skali krzywej: rozciągnięcie układu dodaje oczka (R-084), więc krzywa pokazuje się dalej, a nie rozciąga.
- Wykresów nie da się zaznaczyć ani skasować gumką; usuwa się je w panelu.
- Własny wzór tekstem, miejsca zerowe i wierzchołek jako opisy zostają na później (jak w R-092).
