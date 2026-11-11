# 0015. Wczytywanie PDF na tablicę (R-056)

- Status: accepted
- Data: 2026-11-11

## Kontekst
R-056: nauczyciel i uczniowie wczytują plik PDF (karta pracy, zadania z podręcznika, skan), a jego strony trafiają na tablicę jako elementy, po których można pisać. Obrazy na tablicy już są (R-015, ADR 0007): bajty w SQLite, `POST /api/boards/{id}/images`, element `kind: "image"`, limit 5 MiB na obraz, serwer nie dekoduje obrazów. Priorytety: niskie CPU serwera (3), iPad i słabe tablety (2).

## Decyzja (odpowiedzi użytkownika z 2026-11-11)
- **Konwersja w przeglądarce, biblioteką pdf.js** (Apache-2.0). Strony rysuje przeglądarka osoby, która wczytuje plik, na płótnie, i wysyła je istniejącym torem obrazów. Serwer nie parsuje PDF, nie zużywa na to procesora i nie dostaje niczego poza gotowymi obrazami (jego walidacja typu i rozmiaru obrazu zostaje). Biblioteka i jej worker ładują się dopiero przy pierwszym wczytaniu PDF, żeby nie obciążać startu aplikacji (około 1 MB).
- **Układ: strony jedna pod drugą, odblokowane.** Każda strona to zwykły element-obraz (przesuwanie, skalowanie, kopiowanie i usuwanie jak w R-021/R-022); nic nie jest zablokowane. Pierwsza strona ma lewy górny róg w lewym górnym rogu widoku (z marginesem), kolejne pod nią, z odstępem 24 jednostek tablicy; szerokość strony na tablicy to około 900 jednostek, wysokość z proporcji PDF.
- **Jakość i limity:** do **60 stron**, plik do **50 MB**, strona rastrowana do **szerokości 2000 px** (wysokość z proporcji, więc A4 pionowo ma około 2830 px; pomijamy skracanie dłuższego boku do 2048 z ADR 0007, które rozmyłoby pionowe strony). Format: JPEG (jakość 0,85) dla stron ze zdjęciami i skanów, PNG gdy strona jest prosta i wynik jest mały; gdy wynik przekracza 2 MiB, JPEG. Zmieścić się trzeba w limicie 5 MiB na obraz.
- **Za duży plik:** plik większy niż 50 MB jest odrzucany od razu, z komunikatem, bez czytania. PDF z więcej niż 60 stronami: wczytujemy **pierwsze 60 stron** i pokazujemy komunikat, ile pominięto. Zaszyfrowany lub uszkodzony plik: komunikat, nic się nie wczytuje.
- **Wczytywanie:** pozycja "Wczytaj PDF" w menu tablicy (przycisk z ikoną pobierania w górnym pasku, obok eksportu z R-014) oraz upuszczenie pliku PDF na tablicę (PC); na iPadzie wybór z aplikacji Pliki przez ten sam przycisk. Strony są renderowane i wysyłane **po kolei**, z paskiem postępu ("strona 12 z 40") i przyciskiem Anuluj; strony pojawiają się na tablicy kolejno, więc inni widzą je jak zwykłe obrazy. Anulowanie zostawia to, co już wysłano. Jedno cofnięcie (Ctrl+Z) cofa całe wczytanie, a nie pojedynczą stronę.
- **Oryginał nie jest przechowywany:** w bazie są tylko obrazy stron. Zoom jest ograniczony do rozdzielczości obrazu (2000 px szerokości), a pobranie oryginału z tablicy nie jest możliwe (nauczyciel ma plik u siebie).
- **Uprawnienia:** każdy, kto ma prawo rysowania (R-016): twórca i uczestnicy, którym go nie odebrano. Uczestnik bez prawa rysowania nie widzi działającej pozycji "Wczytaj PDF" (serwer i tak odrzuci wysyłanie obrazów, jak wszystkie zmiany tablicy).
- **Kopia tablicy (R-020) i eksport (R-014)** obejmują strony bez zmian, bo są zwykłymi obrazami (kopia kopiuje obrazy, eksport rysuje wczytane obrazy).

## Rozważane opcje
1. Konwersja na serwerze (poppler lub mupdf): odrzucona, kosztuje CPU serwera, powiększa obraz i otwiera serwer na złośliwe pliki.
2. Hybryda: odrzucona, najwięcej kodu, a nie ma jeszcze mierzonego problemu z wydajnością na tablecie.
3. Zachowanie oryginału PDF obok obrazów: odrzucone, podwaja rozmiar bazy i kopii; do rozważenia, gdyby brakowało ostrego zoomu lub pobierania.
4. Strony zablokowane lub w poziomym rzędzie: odrzucone na rzecz kolumny odblokowanej.
5. Odrzucenie całego pliku powyżej limitu albo wybór zakresu stron: odrzucone, wczytujemy pierwsze 60 stron.

## Konsekwencje
- **Ruch i miejsce:** 60 stron po 0,2 do 1 MiB to nawet kilkadziesiąt MiB wysłanych naraz (dane komórkowe) i tyle samo przybywa w SQLite i kopiach. Dlatego postęp, anulowanie i sekwencyjne wysyłanie; brakuje jeszcze ogólnego limitu obrazów na tablicę (osobne zadanie, wspólne dla zwykłych obrazów).
- **Pamięć:** w danej chwili renderowana jest jedna strona (płótno około 2000 na 2830 px), po wysłaniu zwalniane; na słabym iPadzie to największe ryzyko, do sprawdzenia testem na prawdziwym urządzeniu (dlatego nie ma hybrydy "z góry").
- **Cofanie:** wczytanie 60 stron jako jeden krok wymaga zgrupowania elementów w historii cofania (R-008), której dziś nie ma; do zrobienia w implementacji.
- **Zależność:** nowa biblioteka `pdfjs-dist` (Apache-2.0) w kliencie, ładowana leniwie.
- **Bezpieczeństwo:** PDF jest parsowany wyłącznie w przeglądarce wczytującego (jej piaskownica), a serwer widzi tylko obrazy, które już waliduje.
