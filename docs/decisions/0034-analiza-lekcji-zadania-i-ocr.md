# 0034. Analiza lekcji: drobne kawałki, OCR i klejenie modelem

- Status: proposed
- Data: 2026-11-27

## Kontekst
Sposób pracy na lekcji (R-124): tablica jest nieskończoną przestrzenią. Prowadzący wkleja zrzuty
z podręcznika i rozwiązuje zadania odręcznie z uczniem. Zrzut nie zawsze jest zadaniem: bywa
materiałem pomocniczym (tabelka wzorów, przykład, rysunek). Rozwiązanie jednego zadania bywa
rozrzucone, a obok leżą rzeczy z innego zadania. Człowiek patrzy na tablicę i od razu widzi, co do
czego należy. Ma to rozumieć system, a docelowo **własny model**, który nauczy się kleić te rzeczy
w całość na danych z naszych lekcji.

Z wyniku chcemy dostać zadania spisane na czysto, ich sprawdzenie i notatki (R-125).
Najważniejsze są dwie rzeczy: dobry OCR matematyczny i dobre sklejenie w całość.

Stan wyjściowy:
- Mikroserwis `ai/segmentsvc` (PR #132) łączy elementy w skupiska po odległości. To za mało:
  odległość nie mówi, co do czego należy.
- Ten sam mikroserwis pomija obrazki: manifest niesie tylko ich identyfikator.
- Uni-MuMER czyta tylko odręczne wyrażenia. Druku po polsku nie przeczyta.
- Modele działają na stałe na wynajętym GPU (vLLM, API zgodne z OpenAI).
- Wskazówka dostępna za darmo: `z` każdego elementu to znacznik czasu w ms z chwili utworzenia
  albo przesunięcia (`controller.ts`, `nextZ`).

## Rozważane opcje
1. *Reguły geometryczne (skupiska po odległości).* Proste, ale nie rozumieją treści. Sklejają
   sąsiednie zadania i rozcinają rozrzucone rozwiązanie.
2. *Reguły „zrzut = zadanie” plus czas i położenie.* Lepsze, ale fałszywe, gdy zrzut jest
   materiałem albo gdy wraca się do wcześniejszego zadania. Każdy wyjątek to nowa reguła.
3. *Tryb zeszytu* (strona = zadanie). Podział byłby prawie darmowy, ale zmienia sposób pracy.
   Zostaje jako osobne, późniejsze wymaganie, które klejenie tylko ułatwi.
4. *Klejenie modelem:* najpierw tablica jest rozbita na drobne kawałki i każdy kawałek odczytany,
   a potem model, który widzi całą tablicę oraz treść, położenie i czas kawałków, decyduje, co jest
   zadaniem, co materiałem, co notatką i który kawałek do czego należy. Na start model ogólny
   z instrukcją; poprawki prowadzącego zbieramy jako dane do własnego modelu.

## Decyzja
Opcja 4, w trzech krokach w segmentsvc:

```
1. Kawałki (deterministycznie, bez rozumienia treści):
   każdy wklejony obrazek; każdy tekst z klawiatury; odręczne kreski pocięte na linie
   (nakładanie w pionie, przerwy); kształty i rysunki jako osobne kawałki.
   Zasada: lepiej pociąć za drobno niż skleić dwie różne rzeczy, bo klejenie naprawi tylko pierwsze.
2. OCR każdego kawałka:
   obrazek → model wizyjny ogólny (druk: tekst i wzory, Markdown z LaTeX-em);
   linia odręczna → Uni-MuMER (linia ze słowami → model ogólny); tekst → dosłownie.
3. Klejenie (model):
   wejście: obraz całej tablicy z ponumerowanymi kawałkami + lista kawałków (id, prostokąt,
   czas z, rodzaj, odczytana treść);
   wyjście (JSON): grupy z rodzajem (zadanie | materiał | notatki), kolejnością i kawałkami;
   materiał może być powiązany z zadaniami, których dotyczy.
```

Zasady:
- **Czas i położenie to wskazówki dla modelu, nie reguły.** Dostaje je w danych wejściowych.
- **Klejenie to wymienny krok.** Ma stałe wejście i wyjście, więc model ogólny z instrukcją można
  później zastąpić własnym, wytrenowanym modelem bez zmian w reszcie systemu.
- **Dane do własnego modelu.** Każde ręczne poprawienie wyniku przez prowadzącego (przeniesienie
  kawałka do innej grupy, zmiana rodzaju grupy, poprawka LaTeX-u) zapisuje się jako przykład
  uczący. Interfejs do poprawiania i sam trening to osobne wymagania. Ten ADR ustala tylko, że wynik
  ma postać, którą da się poprawić i zapisać.
- **Jakość jest mierzalna.** Do repo trafia zbiór testowy: kilka prawdziwych tablic (bez danych
  osobowych) z ręcznie ustalonym wynikiem. Test liczy trzy liczby: odsetek kawałków w dobrej
  grupie, trafność rodzaju grupy i odsetek linii odczytanych dokładnie (po normalizacji
  LaTeX-u). Każda zmiana modelu, instrukcji albo cięcia pokazuje różnicę.
- **Dane.** Pismo i zrzuty trafiają tylko na naszą wynajętą maszynę, po HTTPS i z kluczem API
  z `.env`. Nic nie jest tam przechowywane. Mathpix i podobne usługi odpadają z tego powodu.
- **Bez zmian:** endpointy, zadanie w gorutynie, jedna analiza naraz na tablicę, zachowany
  ostatni wynik, uprawnienia właściciela, `SEGMENTSVC_URL` (PR #143). Serwer dokłada do manifestu
  bajty wklejonych obrazków (base64 z tabeli `images`). Wynik to grupy z kawałkami zamiast płaskiej
  listy skupisk.

## Konsekwencje
- segmentsvc dostaje cięcie na kawałki, drugiego klienta modelu, krok klejenia i rysowanie obrazu
  całej tablicy z numerami kawałków. Obecna segmentacja po odległości zostaje tylko do cięcia na
  linie.
- Na GPU działają Uni-MuMER (3B) i model ogólny. Ten drugi potrzebuje do klejenia dobrego
  rozumienia układu, więc raczej 7B lub większy; ostateczny rozmiar wybierzemy pomiarem na zbiorze
  testowym. Karta ok. 24–48 GB VRAM. Koszt rośnie z czasem analizy.
- Pierwsze wyniki klejenia będą tak dobre jak model ogólny. Lepsze przyjdą z własnym modelem,
  uczonym na zebranych poprawkach.
- Etap 2 (R-125): spisanie na czysto, sprawdzenie i notatki robi model językowy na podstawie
  sklejonych grup.
- Później: tryb zeszytu, interfejs poprawiania wyniku, trening własnego modelu, weryfikacja
  kilkoma modelami (ensemble).
