# Plan: nieskończone płótno (R-010)

Stan na 2026-11-09. Źródła: `SPEC.md` (R-010, N-002, N-010, R-005), `docs/decisions/0004-sync-protocol.md`, plany Etapów 1 i 2. Pierwsza pozycja Etapu 5 (reszta P2/P3 według tego, czego zabrakło). Etapy 3.5 i 4 idą na koniec.

Gotowe, gdy: na PC i na iPadzie da się przesuwać i powiększać tablicę, kreski innych osób są w tych samych miejscach niezależnie od tego, jak kto ma ustawiony widok, a rysowanie dalej jest płynne (N-002).

Zasady: najpierw test i potwierdzenie, że pada; potem implementacja. Małe commity. Bez abstrakcji "na zapas".

## Założenia (do potwierdzenia)
1. **Widok jest lokalny** dla klienta (`x`, `y`, `scale`), nie jest synchronizowany ani zapisywany. Każdy ogląda inny fragment. **Protokół i serwer bez zmian** (kreski już są we współrzędnych tablicy; stare kreski zgodne, bo odpowiadają widokowi startowemu `x=0, y=0, scale=1`).
2. **Grubość kreski jest w jednostkach tablicy**, więc przy powiększeniu kreska rośnie razem z rysunkiem. Promień gumki jest w pikselach ekranu (stały pod rysikiem), przeliczany na jednostki tablicy.
3. **Zoom** w zakresie 10% do 500%, powiększanie wokół punktu pod kursorem lub środka gestu.
4. **Sterowanie:**
   - PC: kółko myszy lub dwa palce na gładziku przesuwają, Ctrl + kółko (i szczypanie na gładziku) powiększa, środkowy przycisk myszy przeciąga widok, nowe narzędzie "Ręka" w panelu przeciąga widok lewym przyciskiem.
   - iPad: **dwa palce** przesuwają i powiększają (szczypanie). Jeden palec nadal niczego nie robi (palm rejection, N-010). Gdy rysik dotyka ekranu, dotyk jest ignorowany.
5. **Wydajność (priorytet 1):** kontury `perfect-freehand` liczone raz na kreskę i trzymane jako `Path2D`, a przy przerysowaniu pomijamy kreski spoza widoku (porównanie z ramką kreski). Przerysowanie przy każdej klatce przesuwania.
6. **Interfejs:** w panelu przyciski `-`, wskaźnik powiększenia (klik wraca do 100% i początku) i `+`.
7. **Poza zakresem:** zapamiętywanie widoku, "dopasuj do zawartości", minimapa, ograniczenie obszaru, kursory innych osób (R-013).

## Kroki
1. **Branch** `feature/infinite-canvas`. R-010 w SPEC.md na `accepted` po Twojej akceptacji.
2. **Widok (czysty TS, `web/src/board/view.ts`)**, testy najpierw: przeliczanie ekran/tablica w obie strony, przesunięcie, zoom wokół punktu (punkt pod kursorem się nie rusza), ograniczenie zakresu.
3. **Gesty dotykowe (`gestures.ts`)**, testy najpierw: dwa palce dają przesunięcie i zoom wokół środka, jeden palec nic, dotyk ignorowany gdy rysik aktywny, koniec gestu po podniesieniu palca.
4. **Kontroler we współrzędnych tablicy**, testy najpierw: punkty kresek i gumka przeliczane przez widok, narzędzie "Ręka" i środkowy przycisk przesuwają widok, stare zachowanie przy widoku startowym bez zmian.
5. **Renderer:** transformacja widoku, `Path2D` w pamięci podręcznej, pomijanie kresek spoza widoku, warstwa żywa też z widokiem (testy czystych części: ramka kreski i test widoczności).
6. **Podpięcie w `BoardView`:** kółko myszy (`preventDefault`, żeby nie powiększać strony), Ctrl + kółko, gesty dotykowe, przyciski zoomu i narzędzie "Ręka" w panelu.
7. **Sprawdzenie w Chrome** (przeglądarka z moich narzędzi): przesuwanie, zoom, rysowanie po przesunięciu, druga karta widzi kreski w tych samych miejscach.
8. **Test na PC + iPadzie:** rysowanie, dwa palce, płynność przy większej liczbie kresek. Wynik do SPEC.md (R-010 `done`), CLAUDE.md i PR.

## Otwarte
- Czy kółko myszy ma domyślnie przesuwać (jak w Figmie i Excalidraw) czy powiększać (jak w mapach). Propozycja: przesuwać, a powiększa Ctrl + kółko.
