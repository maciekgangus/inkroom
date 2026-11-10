# Plan: obrazy na tablicy (R-015)

Stan na 2026-11-09. Źródła: `SPEC.md` (R-015, N-001, N-008, N-009, R-019, N-007), `docs/decisions/0007-images.md`, `docs/decisions/0004-sync-protocol.md`, `docs/decisions/0006-board-elements.md`.

Gotowe, gdy: na PC i iPadzie da się wstawić zdjęcie (wklejone ze schowka, wybrane z dysku lub aparatu, upuszczone na tablicę), zmienić jego rozmiar i położenie, drugi uczestnik je widzi na bieżąco, pisanie po zdjęciu działa, a po odświeżeniu i restarcie wszystko wraca.

Zasady: najpierw test i potwierdzenie, że pada; potem implementacja. Małe commity. Bez abstrakcji "na zapas".

## Współpraca z agentem od interfejsu
Drugi agent przebudowuje wygląd (`app.tsx`, `auth-forms.tsx`, `panel.tsx`, `style.css`, `toolbar.tsx`). Ten plan **nie dotyka tych plików**:
- cała logika w nowych plikach (`server/internal/...`, `web/src/board/image-*.ts`, `web/src/image-controls.tsx` z własnym `image-controls.css`);
- jedyne wspólne miejsce to `web/src/board-view.tsx` (kilka linii: podpięcie), więc commity tam są małe i rebase'uję przed PR;
- praca w osobnym katalogu (`git worktree`), osobny projekt Docker i port, żeby nie nadpisywać sobie kontenerów.

## Założenia (do potwierdzenia)
1. Decyzje jak w ADR 0007: bajty w SQLite, zmniejszanie w kliencie (dłuższy bok do 2048 px, JPEG 0,85), element `kind: "image"` z `src` i dwoma narożnikami, nowa operacja `update` (ostatnia wygrywa), gumka nie kasuje obrazów.
2. **Wstawianie, trzy drogi:** (a) wklejenie ze schowka (Ctrl/Cmd+V, zdarzenie `paste`; zdjęcie ląduje na środku widoku), (b) przycisk "Obraz" otwierający wybór pliku (na iPadzie zdjęcia, plik lub aparat), (c) przeciągnięcie pliku na tablicę (PC). Przycisk "Wklej" z `navigator.clipboard.read()` pokazuje się tylko tam, gdzie przeglądarka to dopuszcza (HTTPS lub `localhost`), czyli po wdrożeniu.
3. **Domyślny rozmiar:** nie szerszy niż 60% widocznej szerokości i nie większy niż naturalny rozmiar, zachowane proporcje.
4. **Edycja:** narzędzie "Zaznacz" (dotyczy obrazów): klik w obraz zaznacza go (ramka z uchwytami w czterech rogach). Przeciągnięcie uchwytu zmienia rozmiar z zachowaniem proporcji, przeciągnięcie obrazu przesuwa, Delete lub przycisk usuwa. Wszystko cofalne (Ctrl+Z, przycisk). Dotyk (palec) nie edytuje, jak i nie rysuje (N-010); działa rysik i mysz.
5. **Limit:** 5 MB na obraz po stronie serwera; brak limitu liczby obrazów na tablicę w pierwszej wersji.
6. **Poza zakresem:** obracanie, przycinanie, zaznaczanie i przesuwanie innych elementów, kolejność warstw (wyślij do tyłu), sprzątanie osieroconych obrazów, OCR.

## Kroki
1. **Branch** `feature/images`, ADR 0007 na `accepted` i R-015 na `accepted` w SPEC.md po Twojej akceptacji.
2. **Serwer, magazyn** (testy najpierw): tabela `images` (migracja), zapis i odczyt, usunięcie tablicy kasuje obrazy; `Op` z wariantem "zastąp".
3. **Serwer, API obrazów** (testy najpierw): `POST` (limit 5 MB, tylko PNG/JPEG/WebP/GIF po zawartości, odrzucenie SVG i śmieci, nieistniejąca tablica 404), `GET` (nagłówki `immutable`, `nosniff`, właściwy typ).
4. **Serwer, `update`** (testy najpierw): zastępuje element, ignorowany dla nieistniejącego, rozsyłany wszystkim, zapis w bazie, `add` nie nadpisuje istniejącego.
5. **Klient, model** (testy najpierw): `Board.updateElement` z historią cofania (przed/po), `applyRemote` dla `update`; `SyncClient` wysyła i odbiera `update`, ponowne wysłanie po rozłączeniu bierze ostatnią wersję.
6. **Klient, obrazy** (testy najpierw): czyste funkcje (dopasowanie do 2048 px, domyślny rozmiar w widoku, proporcje przy zmianie rozmiaru uchwytem, trafianie w obraz i w uchwyt), ramka obrazu do pomijania poza widokiem.
7. **Klient, wczytywanie i rysowanie:** pamięć podręczna `HTMLImageElement`, odświeżenie po załadowaniu, obraz rysowany według `z`.
8. **Klient, wstawianie:** `paste`, wybór pliku, przeciągnięcie, zmniejszenie i wysłanie, potem `add`; błędy widoczne dla użytkownika.
9. **Klient, edycja:** narzędzie "Zaznacz", uchwyty, przesuwanie, usuwanie, wszystko przez `update`/`remove`.
10. **Sprawdzenie w Chrome:** wstawianie wszystkimi drogami, zmiana rozmiaru i przesunięcie, druga karta, pisanie po zdjęciu, odświeżenie, restart kontenera, usunięcie tablicy.
11. **Test ręczny na PC i iPadzie** (aparat/zdjęcia, rysik), SPEC.md (R-015 `done`), CLAUDE.md i PR.

## Otwarte
- Czy po wstawieniu narzędzie przełącza się na "Zaznacz" (propozycja: tak, żeby od razu dało się dopasować rozmiar).
- Maksymalny bok 2048 px i jakość 0,85 (propozycja; do zmiany po pierwszej lekcji).
