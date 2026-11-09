# Plan Etapu 1: tablica lokalna

Stan na 2026-11-09. Źródła: `SPEC.md` (R-004, R-005, R-008, N-002, N-010), `docs/decisions/0001-stack.md`, wynik spike'u w ADR 0001.

Gotowe, gdy: rysowanie rysikiem jest płynne na iPadzie z Apple Pencil (SPEC, Etap 1). Wszystko lokalnie, bez serwera i bez synchronizacji.

Zasady: najpierw test i potwierdzenie, że pada; potem implementacja. Małe commity. Bez abstrakcji "na zapas".

## Założenia (do potwierdzenia)
1. **Gumka kasuje całe kreski** (R-004: "kasuje elementy"), nie piksele. Trafienie: odległość punktu od kreski mniejsza niż promień gumki.
2. **Model:** kreska = `{id, authorId, color, size, points: [x, y, pressure][]}`. Lista kresek w kolejności rysowania. Pole `authorId` jest od razu, bo R-008 (cofanie per użytkownik) i Etap 2 go wymagają. Lokalnie jest jeden autor.
3. **Cofnij/ponów (R-008):** stos operacji per autor (`add`, `erase`). Cofnięcie `add` usuwa kreskę, cofnięcie `erase` ją przywraca. Ponów odwrotnie. Nowa operacja czyści stos ponawiania. Lokalnie to jeden stos, ale operuje na `authorId`.
4. **Wejście (R-005, N-010):** rysują `pen` i `mouse`, `touch` nie rysuje (wzór ze spike'u). Dwa canvasy: zatwierdzony i żywy. `getCoalescedEvents`, `touch-action: none`, blokada gestów Safari.
5. **Narzędzia:** pióro, gumka, kolor (kilka stałych), grubość (kilka stałych). Panel w Preact. Skróty: Ctrl+Z / Ctrl+Shift+Z na PC.
6. **Bez** przesuwania/zoomu (R-010), stron, figur i zapisu (to inne etapy).
7. **Granica testów:** logika (model, trafianie gumką, undo/redo) testowana w Vitest bez DOM. Rysowanie na canvasie i wrażenia sprawdza ręcznie test na iPadzie, jak w spike'u.

## Kroki
1. **Branch** `feature/local-board`.
2. **Model i undo/redo** (czysty TS, `web/src/board/`): testy najpierw. Dodanie kreski, gumka (trafienie), cofnij/ponów dla `add` i `erase`, czyszczenie stosu ponawiania.
3. **Trafianie gumką:** test punkt-odcinek, potem implementacja.
4. **Warstwy canvas:** komponent z dwiema warstwami, rysowanie żywej kreski, przeniesienie na zatwierdzoną po puszczeniu, przerysowanie po resize. Wzorzec ze spike'u (ADR 0001).
5. **Wejście:** Pointer Events, odrzucanie `touch`, coalesced events, nacisk. Test jednostkowy filtra `pointerType`.
6. **Panel narzędzi:** pióro/gumka, kolor, grubość, cofnij/ponów, skróty klawiszowe.
7. **Test na iPadzie** (jak w spike'u): kryteria opóźnienia, palm rejection, nacisku, braku migotania i gestów Safari. Wynik do SPEC.md (R-004, R-005, R-008 na `done`) i krótkiej notki.
8. **Aktualizacja CLAUDE.md** (stan projektu) i PR.

## Otwarte
- Zestaw kolorów i grubości (propozycja: 5 kolorów, 3 grubości).
- Czy gumka ma mieć podgląd kółka pod kursorem (propozycja: tak, tylko dla myszy).
