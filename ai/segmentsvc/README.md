# segmentsvc — mikroserwis segmentacji tablicy + rozpoznawanie Uni-MuMER

Prototyp (osobny moduł Go, tylko stdlib): przyjmuje manifest JSON tablicy
(export klienta webowego: lista elementów `Stroke`), dzieli go
deterministycznie na segmenty (klastry bbox-ów), każdy segment rasteruje
do PNG i wysyła do modelu Uni-MuMER, który zwraca LaTeX per segment.

## Endpointy

| Endpoint | Opis |
|---|---|
| `GET /healthz` | zdrowie serwisu |
| `POST /api/segment?gap=&order=reading\|z` | sam manifest → segmenty (bez modelu) |
| `POST /api/analyze?gap=&order=&scale=&maxSide=` | manifest → segmenty → PNG → Uni-MuMER → LaTeX per segment |

Body: manifest JSON, patrz [examples/manifest.json](examples/manifest.json).
`gap` = maksymalna przerwa (jednostki tablicy) między elementami jednego
segmentu (domyślnie z mediany rozmiaru pisma); `order` = kolejność
segmentów; `scale`/`maxSide` = parametry rastra (domyślnie auto, max 2048 px).

Błąd pojedynczego segmentu nie blokuje całego requesta — ląduje w polu
`error` tego segmentu.

## Uruchomienie

```sh
cd ai/segmentsvc
go test ./...

# sam serwis (bez modelu: /api/segment działa, /api/analyze → 503)
PORT=8090 go run .

# z modelem Uni-MuMER przez vLLM (OpenAI-compatible API)
UNIMUMER_BASE_URL=http://gpu-box:8000 \
UNIMUMER_MODEL=phxember/Uni-MuMER-Qwen2.5-VL-3B \
UNIMUMER_API_KEY=... \
PORT=8090 go run .
```

Model na GPU w UE serwujemy vLLM-em (https://docs.vllm.ai/en/stable/serving/openai_compatible_server/):

```sh
vllm serve phxember/Uni-MuMER-Qwen2.5-VL-3B --dtype bfloat16 --max-model-len 4096
```

Wagi: https://huggingface.co/collections/phxember/uni-mumer (paper: https://arxiv.org/abs/2505.23566).

## Przykład

```sh
curl -s localhost:8090/api/segment -d @examples/manifest.json | jq .
curl -s 'localhost:8090/api/analyze?maxSide=2048' -d @examples/manifest.json | jq .
```

## Uwagi projektowe

- Teksty (`kind: "text"`) i obrazki NIE są rasteryzowane — tekst idzie
  verbatim przez JSON manifestu, więc nie przechodzi przez OCR.
- Segment = klaster elementów (union-find po bbox-ach rozszerzonych o
  `gap`); wewnątrz segmentu elementy są posortowane po `z` (kolejność
  rysowania). Kolejność segmentów: `reading` (góra→dół, lewo→prawo) lub `z`.
- Następny krok (jeszcze nie tu): tryb zeszytu (strony A5) doda `pages` do
  manifestu i segmentację per strona; kanał online (ścieżki do MyScript /
  własny model na ink) jako drugi głos w głosowaniu.
