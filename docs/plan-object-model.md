# Plan: model obiektów (R-021, R-022, R-023)

Stan na 2026-11-10. Źródła: `SPEC.md` (R-021 do R-023, R-004, R-008, N-011, N-002, N-010), `docs/decisions/0008-object-model.md`, ADR 0004, 0006, 0007.

Gotowe, gdy: na PC i iPadzie da się zaznaczyć dowolny obiekt (kreskę, kształt, tekst, obraz) lub kilka, przesunąć go, przeskalować, obrócić i zmienić jego kolor, grubość i styl; zmiany widzą wszyscy, da się je cofnąć, a po odświeżeniu i restarcie wszystko wraca.

Zasady: najpierw test i potwierdzenie, że pada; potem implementacja. Małe commity. Bez abstrakcji "na zapas".

## Współpraca z agentem od interfejsu
Jak przy obrazach: logika w nowych plikach (`web/src/board/transform*.ts`, `selection*.ts`), panel właściwości jako osobny komponent z własnym plikiem CSS, a wspólne miejsca (`board-view.tsx`, ewentualnie `toolbar.tsx`) edytowane minimalnie. Przed PR sprawdzam, czy `main` się zmienił.

## Założenia (do potwierdzenia)
1. Model jak w ADR 0008: pola opcjonalne `rot`, `dash`, `fill`, `opacity`, `fontSize`; przesunięcie i skala w `points`, obrót w `rot`; wszystko przez `update`; jeden krok cofania na gest, także dla wielu obiektów.
2. **Kreska odręczna to jeden obiekt** (już tak jest): zaznaczasz, przesuwasz, skalujesz, obracasz i kasujesz ją w całości. Gumka nadal kasuje cały obiekt.
3. **Jedno narzędzie "Zaznacz"** zastępuje obecne zaznaczanie obrazów: klik w obiekt, ramka (przeciągnięcie po pustym), Shift dodaje, klik w pustkę odznacza, Delete usuwa. Uchwyty: cztery rogi skalują (proporcje zachowane), uchwyt nad ramką obraca (Shift: co 15°), wnętrze przesuwa.
4. **Dotyk** nadal niczego nie edytuje (palm rejection, N-010): edytuje rysik i mysz.
5. **Panel właściwości** pojawia się przy zaznaczeniu: kolor (paleta), grubość (3 rozmiary), styl linii (ciągła, kreskowana, kropkowana), wypełnienie (brak lub kolor z palety, tylko prostokąt i okrąg), przezroczystość (suwak lub 3 poziomy), rozmiar czcionki (tekst), dwuklik w tekst otwiera edycję treści. Przy kilku obiektach zmiana dotyczy wszystkich.
6. **Zmiany innych osób w trakcie przeciągania** widać dopiero po puszczeniu.
7. **Etap pierwszy to R-021 i R-022; R-023** (duplikuj, kopiuj i wklej, kolejność warstw, grupy) osobno, po Twoim teście, bo grupy zmieniają sposób zaznaczania.
8. **Poza zakresem:** skalowanie nierównomierne (uchwyty boków), obrót wielu obiektów jako bryły przy różnych `rot` bywa przybliżony (obrót zaznaczenia obraca każdy obiekt wokół środka zaznaczenia), zapamiętywanie zaznaczenia po odświeżeniu.

## Kroki
1. **Branch** `feature/object-model`; ADR 0008, R-021 i R-022 na `accepted` po Twojej akceptacji.
2. **Model** (testy najpierw): nowe pola elementu, `Board.updateMany` z jednym krokiem cofania, `SyncClient` (bez zmian protokołu, test, że wiele `update` z jednego gestu działa i jest ponawiane).
3. **Geometria przekształceń** (testy najpierw, czyste funkcje): ramka obiektu, obwiednia po obrocie, odwrotny obrót punktu, przesunięcie, skalowanie wokół punktu (kreska, linia, prostokąt, okrąg, tekst z `fontSize`, obraz), obrót wokół środka, obrót zbiorczy, przyciąganie kąta.
4. **Trafianie i ramki po obrocie** (testy najpierw): trafianie każdego rodzaju w układzie lokalnym, wnętrze wypełnionych kształtów, gumka po obrocie, ramka do pomijania poza widokiem po obrocie.
5. **Zaznaczanie** (testy najpierw): jeden i wiele obiektów, ramka zaznaczania, Shift, odznaczanie, trafianie uchwytów (obrót, rogi) w stałym rozmiarze na ekranie.
6. **Gesty** (testy najpierw): przesuwanie, skalowanie, obrót zaznaczenia z podglądem lokalnym i jednym `update` na obiekt po puszczeniu; jeden krok cofania.
7. **Właściwości** (testy najpierw): zmiana koloru, grubości, stylu, wypełnienia, przezroczystości, rozmiaru czcionki i treści tekstu przez `updateMany`.
8. **Renderer:** `translate`/`rotate`/`globalAlpha` per obiekt, kreskowanie, wypełnienie, tekst z `fontSize`; ramka zaznaczenia z uchwytem obrotu; `Path2D` w cache bez zmian.
9. **Interfejs:** narzędzie "Zaznacz" (rozszerzenie z ADR 0007), panel właściwości (nowy komponent z własnym CSS), dwuklik w tekst, skróty (Delete, Ctrl+Z).
10. **Sprawdzenie w Chrome** (jeśli rozszerzenie połączone) i skryptem: edycja każdego rodzaju, druga karta, odświeżenie, restart kontenera.
11. **Test ręczny na PC i iPadzie**, SPEC.md (R-021 i R-022 `done`), CLAUDE.md i PR.

## Otwarte
- Czy przezroczystość i wypełnienie wchodzą do pierwszej wersji (propozycja: tak, bo to małe przy gotowym mechanizmie).
- Czy obrót ma przyciągać do 15° tylko z Shift, czy zawsze blisko kątów prostych (propozycja: z Shift, plus lekkie przyciąganie do 0°, 90°, 180°, 270°).
- Czy grupy (R-023) robimy zaraz po R-021/R-022, czy odkładamy (propozycja: po Twoim teście).
