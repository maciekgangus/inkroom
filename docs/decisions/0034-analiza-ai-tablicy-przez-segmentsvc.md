# 0034. Analiza AI tablicy przez segmentsvc, wyniki w SQLite

- Status: proposed
- Data: 2026-11-27

## Kontekst
PR #132 dodał osobny mikroserwis `ai/segmentsvc` (moduł Go bez zależności): z manifestu JSON tablicy
dzieli elementy na segmenty (grupy kresek leżące blisko siebie), rasteryzuje każdy segment do PNG
i wysyła go do modelu Uni-MuMER (vLLM, API zgodne z OpenAI), który zwraca LaTeX. Segmenty z samym
tekstem idą dosłownie (`verbatim`), bez modelu. Mikroserwis nie był dotąd podłączony do aplikacji.

R-121 prosi o analizę zapisanej tablicy z poziomu głównego serwera: prowadzący zleca analizę,
a wynik (LaTeX każdego segmentu) zostaje w bazie i da się go odczytać później. Ograniczenia:
jedna baza SQLite (ADR 0005), serwer Go bez dodatkowych zależności, rozpoznawanie trwa długo
(sekundy do minut na segment, GPU), a responsywność tablicy (priorytet 1) nie może na tym cierpieć.

## Rozważane opcje
1. **Synchroniczne wywołanie w żądaniu HTTP.** Najprostsze, ale żądanie wisi minutami, Cloudflare
   ucina je po 100 s, a wynik ginie z zamknięciem karty.
2. **Kolejka zadań (osobny proces, Redis, tabela-kolejka z workerem).** Odporna na restart, ale to
   nowa infrastruktura i kod na zapas przy jednym użytkowniku i jednej analizie naraz.
3. **Asynchroniczne zadanie w gorutynie serwera, stan i wyniki w SQLite.** POST zakłada zadanie
   i od razu odpowiada `202`, gorutyna woła segmentsvc, wynik ląduje w tabelach `ai_jobs`
   i `ai_segments`, klient odpytuje GET. Restart serwera przerywa zadanie (oznaczane jako `failed`).
4. **Wbudowanie segmentacji w serwer główny (import pakietu).** Bez skoku sieciowego, ale miesza
   rasteryzację i klienta modelu z serwerem tablicy; segmentsvc jest celowo osobnym modułem
   (inne tempo zmian, może stać na maszynie z GPU).

## Decyzja
Opcja 3. Przepływ:

```
POST /api/boards/{id}/analyze          (tylko właściciel tablicy, Content-Type: application/json)
  └─ store: nowe zadanie ai_jobs (status running), starsze zadania tablicy usunięte
  └─ 202 {"id", "status": "running"}
gorutyna:
  Store.LoadStrokes(board) ─► manifest {"boardId", "title", "elements": [surowy JSON kresek]}
  ─► POST $SEGMENTSVC_URL/api/analyze   (domyślnie http://127.0.0.1:8090)
       segmentsvc: segmentacja ─► PNG segmentu ─► Uni-MuMER (/v1/chat/completions) ─► LaTeX
  ─► ai_segments (id, elementIds, bbox, latex, verbatim, error), ai_jobs.status = done
     albo ai_jobs.status = failed + error (segmentsvc nieosiągalny, kod ≠ 200, limit czasu)
GET /api/boards/{id}/analyze           (tylko właściciel)
  └─ ostatnie zadanie: status (none | running | done | failed), model, error, segmenty
```

- Manifest to dokładnie zapisane kreski: baza trzyma je w formacie przewodowym klienta
  (`points: [[x, y, p], ...]`), zgodnym z `ai/segmentsvc/manifest.go`, więc serwer niczego nie
  przelicza, tylko owija surowy JSON. Nadmiarowe pola kresek segmentsvc pomija.
- Kod w `server/internal/ai` (klient segmentsvc, budowa manifestu, zadanie, handlery HTTP);
  tabele i zapytania w `server/internal/store/ai.go`, migracja na końcu listy `migrations`.
- Na tablicę naraz trwa najwyżej jedno zadanie: drugi POST w trakcie dostaje `409`. Trzymamy tylko
  ostatnie zadanie tablicy (nowe kasuje stare), tabele kasują się kaskadowo z tablicą.
- Przy starcie serwer oznacza zadania `running` jako `failed` („przerwane restartem serwera”);
  przy zamykaniu anuluje trwające zadania i czeka na gorutyny.
- Cała analiza ma limit 30 minut; błąd pojedynczego segmentu (z segmentsvc) zapisuje się przy
  segmencie i nie psuje zadania.
- Autoryzacja jak przy innych zmianach tablicy (`ownedBoard`): zalogowany właściciel; analiza
  zużywa GPU i pokazuje treść całej tablicy, więc gość z linkiem jej nie zleca ani nie czyta.
- Adres segmentsvc z `SEGMENTSVC_URL`; bez sekretów (segmentsvc słucha w sieci wewnętrznej).

## Konsekwencje
- Brak nowej infrastruktury i zależności; analiza nie dotyka pokoju WebSocket ani zapisu kresek.
- Analizowany jest stan zapisany w bazie: zmiany sprzed ostatniego zrzutu pokoju (co 500 ms,
  ADR 0005) mogą się nie załapać, co przy analizie po lekcji nie ma znaczenia.
- Restart serwera gubi trwającą analizę; użytkownik zleca ją ponownie.
- Wdrożenie segmentsvc i vLLM na homelabie (compose, GPU) oraz interfejs w kliencie to osobne
  zadania; bez działającego segmentsvc zadanie kończy się `failed` z czytelnym błędem.
- Poza zakresem (kolejne zadania): tryb zeszytu, weryfikacja ensemble, etap LLM dla całego
  dokumentu, trening modeli.
