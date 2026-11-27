# 0034. Analiza lekcji: podział tablicy na zadania i OCR matematyczny

- Status: proposed
- Data: 2026-11-27

## Kontekst
Sposób pracy na lekcji (R-124): tablica jest nieskończoną przestrzenią. Prowadzący wkleja zrzut
ekranu zadania z podręcznika (element `image`), pod nim albo obok razem z uczniem rozwiązuje je
odręcznie (kreski, czasem tekst, kształty i rysunki), potem wkleja następny zrzut i tak dalej.
Z takiej tablicy chcemy po lekcji dostać: (1) zadania spisane na czysto, czyli treść ze zrzutu
i rozwiązanie krok po kroku, (2) sprawdzenie, co jest dobrze, a co źle, (3) notatki z tematu na
później. Najważniejszy jest etap pierwszy, czyli **dobry podział na zadania i dobry OCR
matematyczny**. Sprawdzenie i notatki (R-125) budują się na jego wyniku.

Stan wyjściowy:
- Mikroserwis `ai/segmentsvc` (PR #132) łączy elementy w skupiska po odległości. Każde skupisko
  rysuje do PNG i wysyła do Uni-MuMER.
- Ten sam mikroserwis pomija obrazki: manifest niesie tylko ich identyfikator, a rysowanie je
  pomija. Treści zadania nie zobaczy więc żaden model.
- Uni-MuMER jest uczony na pojedynczych **odręcznych** wyrażeniach (styl CROHME). Nie nadaje się
  do drukowanego polskiego tekstu z podręcznika ani do całej strony rozwiązania naraz.
- Model działa na stałe na wynajętym GPU (vLLM, API zgodne z OpenAI), nie na homelabie.

Obserwacja, która ułatwia podział: `z` każdego elementu to znacznik czasu w ms z chwili
utworzenia albo ostatniego przesunięcia (`controller.ts`, `nextZ`). Kolejność pracy
„zrzut → rozwiązanie → następny zrzut” jest więc zapisana w samej tablicy.

## Rozważane opcje
**Podział na zadania**
1. *Skupiska po odległości (obecny segmentsvc).* Nie zna pojęcia zadania. Rozwiązanie pisane
   blisko zrzutu raz się z nim skleja, raz rozpada na kilka części.
2. *Tylko geometria wokół zrzutów* (element należy do najbliższego zrzutu nad nim lub obok).
   Działa przy porządnym układzie, ale myli się, gdy zadania leżą ciasno albo w kilku kolumnach.
3. *Zrzut jako kotwica zadania, przypisanie po czasie (`z`) i sprawdzenie geometrią.* Element
   należy do ostatniego zrzutu wklejonego przed nim, chyba że leży wyraźnie bliżej innego
   zadania (powrót do wcześniejszego zadania). Opiera się na faktycznym przebiegu lekcji.
4. *Tryb zeszytu* (strony A5, zadanie na stronie). Podział byłby prawie darmowy, ale zmienia
   sposób pracy. Zostaje na później jako osobne wymaganie.

**OCR**
1. *Wszystko przez Uni-MuMER.* Słabo na druku i polskim tekście, słabo na wielu liniach naraz.
2. *Mathpix API.* Najlepsza jakość od ręki, ale płatne za stronę i wysyła pismo uczniów do
   zewnętrznej firmy.
3. *Dwa modele na tym samym wynajętym GPU.* Zrzut zadania (druk, tekst i wzory) czyta ogólny
   model wizyjno-językowy, np. Qwen2.5-VL-7B-Instruct, który przepisuje go do Markdown z LaTeX-em.
   Odręczne rozwiązanie jest cięte na linie, a każdą linię czyta Uni-MuMER. Linię ze słowami
   zamiast wzoru czyta model ogólny.

## Decyzja
Podział: opcja 3. OCR: opcja 3. O ostatecznym wyborze modeli decydują pomiary na zbiorze
testowym z prawdziwych lekcji, nie intuicja.

Przepływ etapu 1 (R-124):
```
POST /api/boards/{id}/analyze  (właściciel tablicy)  → zadanie w tle (jak dotąd)
  serwer: manifest = zapisane elementy + bajty wklejonych obrazków (base64, z tabeli images)
  ─► segmentsvc:
     1. zadania: każdy obrazek = kotwica zadania; elementy przypisane po z i geometrii;
        elementy przed pierwszym zrzutem albo daleko od wszystkich = „notatki luźne”
     2. w zadaniu: odręczne elementy pocięte na linie (nakładanie w pionie, przerwy);
        kształty i rysunki osobno, jako „rysunek”, bez OCR; tekst z klawiatury dosłownie
     3. OCR: zrzut → model ogólny (Markdown + LaTeX); każda linia → Uni-MuMER
        (linia ze słowami → model ogólny)
  ─► wynik w SQLite: zadanie = treść, linie rozwiązania (LaTeX, elementy, prostokąt, błąd),
     rysunki; plus grupa notatek luźnych
GET /api/boards/{id}/analyze  → stan + zadania w kolejności z lekcji
```

Zasady:
- **Przesunięcie zmienia `z`.** Przesunięty element dostaje nowe `z`, więc czas jest tylko
  wskazówką. Gdy czas i geometria się kłócą, wygrywa geometria (element bliżej innego zadania).
  Kreski narysowane na zrzucie (podkreślenia, zakreślenia) należą do jego zadania i nie psują
  odczytu treści.
- **Jakość jest mierzalna.** Do repo trafia zbiór testowy: kilka prawdziwych tablic z lekcji
  (bez danych osobowych) z ręcznie poprawionym wynikiem, czyli przypisaniem elementów do zadań
  i LaTeX-em linii. segmentsvc ma test, który liczy na nim dwie miary: odsetek dobrze
  przypisanych elementów oraz odsetek linii odczytanych dokładnie (po normalizacji LaTeX-u).
  Każda zmiana podziału albo modelu pokazuje różnicę tych liczb.
- **Dane.** Pismo i zrzuty trafiają tylko na naszą wynajętą maszynę, po HTTPS i z kluczem API
  z `.env`. Nic nie jest tam przechowywane. Mathpix i podobne usługi odpadają z tego powodu.
- **Bez zmian:** endpointy, zadanie w gorutynie, jedna analiza naraz na tablicę, zachowany
  ostatni wynik, uprawnienia właściciela, `SEGMENTSVC_URL`. Wszystko to jest już w PR #143.
  Zmienia się zawartość wyniku: zamiast płaskiej listy skupisk dostajemy zadania z liniami.

## Konsekwencje
- segmentsvc dostaje nowy podział (kotwice, czas, linie), obsługę bajtów obrazków w manifeście
  i drugiego klienta modelu. Obecna segmentacja po odległości zostaje tylko do cięcia na linie.
- Na wynajętym GPU działają dwa modele (Uni-MuMER 3B i ogólny ok. 7B). Potrzebna karta ma
  ok. 24 GB VRAM. Koszt rośnie z czasem analizy, nie z liczbą tablic.
- Manifest z obrazkami bywa duży, ale mieści się w limicie tablicy (128 MB).
- Etap 2 (R-125): spisanie na czysto, sprawdzenie i notatki robi model językowy na podstawie
  wyniku etapu 1, bez ponownego patrzenia w obrazki.
- Tryb zeszytu, weryfikacja kilkoma modelami (ensemble) i trening modeli zostają na później.
