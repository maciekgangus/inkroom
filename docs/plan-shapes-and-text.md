# Plan: kształty i tekst (R-012)

Stan na 2026-11-09. Źródła: `SPEC.md` (R-012, N-002, R-005, N-011), `docs/decisions/0006-board-elements.md`, `docs/decisions/0004-sync-protocol.md`, plany Etapów 1 i 2 oraz nieskończonego płótna.

Gotowe, gdy: na PC i iPadzie da się narysować linię, prostokąt, okrąg i wstawić tekst, drugi uczestnik je widzi, gumka je kasuje, cofnij/ponów działa, a po odświeżeniu i restarcie wszystko wraca.

Zasady: najpierw test i potwierdzenie, że pada; potem implementacja. Małe commity. Bez abstrakcji "na zapas".

## Założenia (do potwierdzenia)
1. Model jak w ADR 0006: ten sam element z polem `kind` (`line`, `rect`, `circle`, `text`) i `text`. **Serwer i zapis bez zmian**, stare tablice działają bez migracji.
2. **Kształty to sam kontur** w wybranym kolorze i grubości (bez wypełnienia, bez nacisku rysika). Linia: przeciągnięcie od początku do końca. Prostokąt: przeciwległe narożniki. **Okrąg: środek i promień** (przeciągasz od środka na zewnątrz), bo na iPadzie nie ma klawisza Shift.
3. **Podgląd na żywo u innych:** kształty widać u innych po puszczeniu (nie w trakcie przeciągania). U siebie podgląd jest natychmiastowy. Odręczne kreski nadal idą na żywo.
4. **Tekst:** narzędzie "Tekst", klik w miejsce na tablicy otwiera pole do pisania (nakładka, skaluje się z zoomem). Enter zatwierdza, Shift+Enter nowa linia, Esc anuluje, kliknięcie poza polem zatwierdza. Kolor z palety, rozmiar z wybranej grubości (2 → 16 px, 5 → 24 px, 10 → 40 px przy zoomie 100%). Jeden krój (czcionka systemowa).
5. **Edycja:** istniejącego tekstu ani kształtów nie edytujemy ani nie przesuwamy; kasuje je gumka (trafienie w kontur lub w ramkę tekstu), a cofnij/ponów działa jak dla kresek.
6. **Pasek narzędzi** zawija się do kolejnych linii, żeby mieścił się na wąskim iPadzie.
7. **Poza zakresem:** wypełnienia, strzałki, przyciąganie do 15° i do kwadratu (Shift), zmiana czcionki, edycja i przesuwanie elementów, wybór kilku elementów.

## Kroki
1. **Branch** `feature/shapes-and-text`. ADR 0006 na `accepted` i R-012 na `accepted` w SPEC.md po Twojej akceptacji.
2. **Element z `kind` i `text`** (typ `Stroke`): ramka (`strokeBounds`) per rodzaj i szacowana ramka tekstu, testy najpierw.
3. **Trafianie gumką** per rodzaj (odcinek, cztery krawędzie prostokąta, kontur okręgu, ramka tekstu), testy najpierw.
4. **Kontroler:** narzędzia `line`, `rect`, `circle` (podgląd lokalny, odrzucenie zerowej wielkości, brak `live` dla kształtów), `addText`, testy najpierw.
5. **Renderer:** rysowanie konturu kształtów i tekstu obok wypełnionych kresek (w cache `Path2D`; tekst przez `fillText`), ramki do pomijania poza widokiem.
6. **Pasek narzędzi:** przyciski Linia, Prostokąt, Okrąg, Tekst, zawijanie; test komponentu.
7. **Edytor tekstu:** nakładka w `BoardView` (Enter/Shift+Enter/Esc/blur, pozycja i rozmiar z widoku), komponent z testem, pominięcie skrótów Ctrl+Z podczas pisania.
8. **Sprawdzenie w Chrome:** każdy kształt i tekst, zoom, gumka, cofnij, druga karta, odświeżenie, restart kontenera.
9. **Test na PC + iPadzie** (rysik, klawiatura ekranowa). Wynik do SPEC.md (R-012 `done`), CLAUDE.md i PR.

## Otwarte
- Rozmiary czcionki tekstu (propozycja: 16, 24, 40 px).
- Czy po wstawieniu tekstu narzędzie wraca do pióra (propozycja: zostaje Tekst, kolejny klik wstawia kolejny tekst).
