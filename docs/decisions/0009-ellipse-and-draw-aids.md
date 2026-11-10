# 0009. Elipsa i ułatwienia rysowania (Shift)

- Status: accepted
- Data: 2026-11-10

## Kontekst
R-024: z klawiszem Shift linia ma się przyciągać do kątów co 15°, prostokąt stać się kwadratem, a owal kołem. Dotąd narzędzie okręgu rysowało koło od środka (`kind: "circle"`: środek i punkt na okręgu), więc nie dało się narysować owalu. Na iPadzie nie ma klawisza Shift, więc ułatwienia tam nie obowiązują. Ograniczenia: stare tablice mają elementy `circle`; rysowanie ma zostać natychmiastowe (priorytet 1); serwer traktuje element jako nieprzezroczysty JSON (ADR 0006).

## Rozważane opcje
1. **Zmienić znaczenie `circle`** na elipsę z dwóch narożników. Psuje istniejące tablice (inne punkty).
2. **Nowy rodzaj `ellipse`** (dwa przeciwległe narożniki ramki, jak prostokąt); `circle` zostaje do odczytu starych tablic.

## Decyzja
Opcja 2. Narzędzie owalu tworzy elementy `kind: "ellipse"`; elipsa jest wpisana w prostokąt wyznaczony przez dwa przeciwległe narożniki. Koło to elipsa o równych bokach ramki (nie osobny rodzaj). Elementy `circle` z wcześniejszych tablic nadal się rysują, trafia się w nie, skalują i obracają jak dotąd.

Ułatwienia są czystą funkcją `constrainEnd(rodzaj, początek, koniec, shift)` stosowaną do punktu końcowego kształtu przy każdym ruchu i przy puszczeniu (stan Shift jest brany z aktualnego zdarzenia, więc można go wciskać i puszczać w trakcie przeciągania):
- **linia:** kąt przyciągany do najbliższej wielokrotności 15°, długość zachowana;
- **prostokąt i elipsa:** bok kwadratu to większa z dwóch odległości, kierunek zachowany (z Shift prostokąt jest kwadratem, a elipsa kołem).

Bez Shift kształt jest swobodny. Na dotyku i rysiku bez klawiatury nic się nie zmienia (zdarzenie nie niesie Shift).

Trafianie w elipsę (gumka, zaznaczanie) używa przybliżonej odległości od konturu: różnica unormowanego promienia razy mniejszy z promieni. Dla koła jest dokładna, dla spłaszczonych elips przybliżona, co wystarcza dla tolerancji kliknięcia.

## Konsekwencje
- Serwer i zapis bez zmian. Protokół bez zmian (nowy `kind` jest tylko danymi).
- Klient: nowy rodzaj w geometrii (ramka jak prostokąt), trafianiu, rysowaniu (`Path2D.ellipse`), stylach (wypełnienie i kreskowanie jak kształty).
- Etykieta narzędzia w pasku zmienia się z "Okrąg" na "Owal".
