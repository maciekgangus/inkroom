# 0008. Model obiektów: edycja, przekształcenia i style

- Status: accepted
- Data: 2026-11-10

## Kontekst
Dotąd element tablicy był niezmienny, a jedyną edycją był obraz (ADR 0007: operacja `update`). Chcemy, żeby wszystko, co rysujemy, było obiektem, który można złapać, przesunąć, przeskalować, obrócić i zmienić (kolor, grubość, styl): R-021, R-022, R-023. Kreska odręczna jest jednym obiektem (zbiorem punktów), więc zaznacza się i kasuje w całości (to już tak działa). Ograniczenia: responsywność rysowania (priorytet 1), iPad z rysikiem (2), niskie CPU serwera (3), zgodność ze zapisanymi tablicami, cofanie per autor (R-008), konflikty "ostatni wygrywa" (N-011).

## Rozważane opcje
Przekształcenia:
1. **Wpisywanie przekształceń w punkty** (przesunięcie, skala i obrót modyfikują `points`). Proste dla kresek i linii, ale prostokąt, tekst i obraz po obrocie przestają być prostokątami osiowymi, a ponowne przekształcenia kumulują błąd.
2. **Geometria lokalna plus kąt `rot`** (obrót wokół środka ramki, pozostałe przekształcenia w punktach). Jeden mechanizm dla wszystkich rodzajów, obrót odwracalny bez utraty dokładności.

Zmiana wielu obiektów naraz:
1. Osobne `update` bez wspólnej historii (N kroków cofania na jedno przeciągnięcie).
2. **Jedno `update` na obiekt, ale jeden wpis w historii cofania** (akcja zbiorcza). Sieć bez zmian protokołu.

## Decyzja
- **Opcja 2 dla przekształceń.** Element dostaje opcjonalne pola (brak = zachowanie dotychczasowe, więc stare tablice działają bez migracji):
  - `rot`: kąt w radianach, obrót wokół środka ramki geometrii nieobróconej;
  - `dash`: `"solid"` (domyślnie), `"dashed"`, `"dotted"`;
  - `fill`: kolor wypełnienia kształtu (prostokąt, okrąg) albo brak;
  - `opacity`: 0 do 1 (domyślnie 1);
  - `fontSize`: rozmiar czcionki tekstu w jednostkach tablicy (zastępuje tabelę 16/24/40 przy skalowaniu; brak = z tabeli według `size`).
- **Przesunięcie i skala zmieniają `points`** (i `fontSize` tekstu), **obrót zmienia `rot`**. Grubość linii (`size`) skalowanie nie zmienia (zmienia ją właściwość, jak w Excalidraw), a skalowanie kreski odręcznej skaluje jej punkty.
- **Wszystko przez `update`** (ADR 0007): każda edycja to pełna nowa wersja elementu, ostatnia wygrywa. Dwie osoby edytujące jednocześnie różne właściwości tego samego obiektu: wygrywa ostatnia zmiana w całości (zgodnie z N-011).
- **Cofanie:** akcja zbiorcza (`updateMany`): jedno przeciągnięcie lub zmiana właściwości wielu obiektów to jeden krok cofania; w sieci jedno `update` na obiekt.
- **Zaznaczenie** jest lokalne (nie synchronizowane): jeden lub wiele obiektów, ramka z uchwytami (cztery rogi skalują z zachowaniem proporcji, uchwyt nad ramką obraca, wnętrze przesuwa), klik w pusty obszar odznacza, przeciągnięcie po pustym daje ramkę zaznaczania, Shift dodaje.
- **Trafianie i ramki** liczone w układzie lokalnym obiektu: punkt kursora jest obracany odwrotnie o `rot` wokół środka ramki, a potem działa dotychczasowe trafianie (kreska, odcinek, krawędzie, wnętrze wypełnionego kształtu, ramka tekstu, obraz). Ramka do pomijania poza widokiem to obwiednia obróconych narożników.
- **Rysowanie:** `ctx.translate`, `rotate` i `globalAlpha` per obiekt; ścieżki `Path2D` zostają w cache w układzie lokalnym, więc przesuwanie i obracanie nie wymaga ich przeliczania. Styl kreskowany przez `setLineDash`.
- **Gumka** nadal kasuje cały obiekt, ale z obrotem trafia w obiekt obrócony; nadal omija obrazy (ADR 0007).
- **Zmiany innych osób w trakcie przeciągania** nie są pokazywane na żywo (widać je po puszczeniu), jak kształty (ADR 0006). Podgląd lokalny jest natychmiastowy.

## Konsekwencje
- Serwer bez zmian (nieprzezroczysty JSON, `update` już jest).
- Klient: zaznaczanie przestaje dotyczyć tylko obrazów; kontroler zaznaczenia i transformacji staje się osobnym modułem (ADR 0007 `select` obrazów zostaje jego szczególnym przypadkiem). Panel właściwości jako osobny komponent z własnym stylem (żeby nie kolidować z przebudową interfejsu).
- Obrót zmienia sposób liczenia ramek i trafiania we wszystkich rodzajach, więc to najbardziej ryzykowna część; pokrywają ją testy jednostkowe geometrii.
- Skalowanie nierównomierne (rozciąganie samej szerokości) w pierwszej wersji tylko przez uchwyty rogów z zachowaniem proporcji; uchwyty boków dojdą, jeśli będą potrzebne.
- Grupy (R-023) wymagają pola `group` z identyfikatorem i traktowania grupy jak jednego obiektu przy zaznaczaniu; zostawione na koniec, bo nie blokuje reszty.
