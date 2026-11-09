# Plan: kursory pozostałych osób (R-013)

Stan na 2026-11-09. Źródła: `SPEC.md` (R-013, N-001, N-008), `docs/decisions/0004-sync-protocol.md` (konsekwencje: kursory jako kolejny typ wiadomości), plany nieskończonego płótna i kształtów.

Gotowe, gdy: na dwóch urządzeniach widać kursor drugiej osoby z jej imieniem, w dobrym miejscu tablicy niezależnie od przesunięcia i zoomu, a rysowanie dalej jest płynne.

## Założenia
1. Wiadomość `cursor {id, name, x, y}` (współrzędne tablicy; `hidden: true` chowa kursor). Serwer przekazuje ją pozostałym, nie zapisuje i nie odsyła nadawcy. Po rozłączeniu autora serwer wysyła `cursor_drop {ids}`. Serwer odrzuca puste lub zbyt długie `id` i imię (limit 64 znaki).
2. Klient wysyła pozycję myszy i rysika (także gdy unosi się nad ekranem), nie dotyku; najwyżej ok. 30 razy na sekundę, tylko gdy się zmieniła; `hidden` po opuszczeniu tablicy.
3. Kursory innych jako elementy HTML nad tablicą (strzałka i imię w kolorze wyliczonym z identyfikatora), pozycja z widoku, stały rozmiar na ekranie, bez przerysowywania kresek.
4. Kursor znika po 15 s bez ruchu, po `hidden`, po `cursor_drop` i po utracie połączenia.
5. Poza zakresem: własny kursor, ślad ruchu, czat.

## Kroki
1. **Serwer** (testy najpierw): `cursor` przekazywany innym, nie odsyłany, nie zapisywany, `hidden`, `cursor_drop` po wyjściu, walidacja.
2. **Kolor osoby** z identyfikatora (deterministyczny, z palety), test.
3. **SyncClient** (testy najpierw): ograniczone wysyłanie, odbiór, `hidden`, `cursor_drop`, wygasanie, czyszczenie po rozłączeniu; osobne wywołanie zwrotne, żeby ruch kursora nie przerysowywał kresek.
4. **Komponent `Cursors`** (test): pozycje z widoku, imiona, kolory.
5. **Podpięcie w `BoardView`:** wysyłanie przy ruchu wskaźnika (poza dotykiem), `hidden` przy wyjściu, imię z `BoardPage`.
6. **Sprawdzenie w Chrome** na dwóch kartach.
7. **Test ręczny, SPEC.md (R-013 `done`), CLAUDE.md, PR.**
