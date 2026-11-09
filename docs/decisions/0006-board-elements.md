# 0006. Elementy tablicy: kształty i tekst

- Status: proposed
- Data: 2026-11-09

## Kontekst
R-012 dodaje linię, prostokąt, okrąg i tekst. Dotąd jedynym elementem była kreska odręczna (`Stroke`: `id`, `authorId`, `color`, `size`, `z`, `points`). Cały obieg (cofnij/ponów per autor, gumka, synchronizacja `add`/`remove`, zapis w SQLite, snapshot) opiera się na tym, że element jest niezmienny i ma `id` (ADR 0004, 0005). Serwer traktuje element jako nieprzezroczysty JSON, z którego czyta tylko `id`.

## Rozważane opcje
1. **Osobne typy elementów i wiadomości** (`addShape`, `addText`, osobne tabele). Czyste, ale mnoży kod w serwerze, bazie, kliencie i testach.
2. **Jeden element z polem `kind`** i opcjonalnym `text`; geometria zawsze w `points`. Cały obieg zostaje bez zmian, a różnice dotyczą tylko rysowania, ramki i trafiania gumką po stronie klienta.

## Decyzja
Opcja 2. Do elementu dochodzą pola opcjonalne:
- `kind`: brak lub `"stroke"` (odręczna, jak dotąd), `"line"`, `"rect"`, `"circle"`, `"text"`.
- `text`: treść (tylko dla `"text"`).

Geometria w `points` (współrzędne tablicy):
- `line`: dwa punkty (początek i koniec).
- `rect`: dwa przeciwległe narożniki.
- `circle`: środek i punkt na okręgu (promień to odległość).
- `text`: jeden punkt, lewy górny róg tekstu.

`size` oznacza grubość linii dla kształtów, a dla tekstu rozmiar czcionki wyliczany z wybranej grubości (stała tabela). Kształty są rysowane samym konturem (bez wypełnienia) o stałej grubości, bez nacisku rysika.

Wiadomości `add`, `remove`, `snapshot` i `live` oraz zapis w bazie zostają bez zmian (pole nadal nazywa się `stroke` w komunikatach, żeby nie zrywać zgodności z zapisanymi tablicami). Stare tablice działają bez migracji, bo brak `kind` oznacza kreskę odręczną.

Kształty i tekst nie są wysyłane jako `live` w trakcie przeciągania. Pozostali widzą je po puszczeniu przycisku (rysik, mysz). Podgląd lokalny jest natychmiastowy.

## Konsekwencje
- Serwer bez zmian. Klient dostaje: ramki i trafianie gumką per rodzaj, rysowanie konturu (`ctx.stroke`) obok wypełnionych obrysów kresek, edycję tekstu na nakładce HTML.
- Szerokość tekstu do ramki jest szacowana (bez pomiaru na canvasie), więc ramka jest przybliżona; gumka i pomijanie poza widokiem mają zapas.
- Brak edycji istniejącego tekstu i przesuwania elementów (kasowanie gumką lub cofnij). Ewentualny wybór i przesuwanie to osobna decyzja.
- Brak przyciągania (Shift) w pierwszej wersji.
