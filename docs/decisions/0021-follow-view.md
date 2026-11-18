# 0021. Śledzenie widoku innej osoby

- Status: accepted
- Data: 2026-11-19

## Kontekst
R-093 (uwaga użytkownika): na lekcji uczeń ma jednym kliknięciem patrzeć tam, gdzie patrzy korepetytor, a użytkownik doprecyzował, że śledzić może **każdy każdego** (uczeń ucznia, uczeń korepetytora, korepetytor ucznia). Widok (przesunięcie i zoom) jest dziś lokalny (R-048). Priorytety: responsywność, iPad obok monitora o innych wymiarach, mało pracy serwera (3). Wiadomości, które serwer tylko przekazuje, są w projekcie normą (kursory R-013, laser R-068, ADR 0004).

## Rozważane opcje
1. **Środek i skala widoku** wysyłane do wszystkich: na ekranie o innych proporcjach śledzący widziałby inny wycinek świata (iPad w pionie kontra monitor).
2. **Prostokąt świata widoczny u śledzonego**, dopasowany do okna śledzącego (wybrane): cały prostokąt jest zawsze widoczny, ekrany mogą się różnić.
3. **Serwer jako źródło prawdy o tym, kto kogo śledzi, i rozgłaszanie `view` do wszystkich**: marnuje pasmo, gdy nikt nie śledzi.
4. **Śledzenie po stronie klientów bez serwera** (WebRTC): dodatkowy kanał, NAT, zbędne.

## Decyzja
- **Protokół (serwer tylko przekazuje, niczego nie zapisuje):**
  - klient → serwer `follow {id}` (pusty `id` kończy), serwer zapamiętuje to przy połączeniu i rozsyła w liście osób pole `follows` (ten sam komunikat `peers`, który niesie nazwy);
  - nadawca → serwer `view {id, minX, minY, maxX, maxY}`; serwer przekazuje go **tylko** połączeniom, które go śledzą (nadawca może pokazywać wyłącznie swój widok, `id` musi być jego), i odrzuca zbyt częste (mniej niż 25 ms od poprzedniego, to tylko zabezpieczenie przed zalewem);
  - serwer → śledzony `followers {n}` przy każdej zmianie liczby śledzących; klient wysyła `view` tylko, gdy `n` > 0 (pierwszy śledzący dostaje widok od razu), co najwyżej co 50 ms (około 20 na sekundę), tylko gdy widok się zmienił o ponad pół jednostki;
  - właściciel: `invite {id}` trafia do wszystkich pozostałych (baner „Dołącz”), od innych osób serwer go ignoruje;
  - serwer → klient `follow_refused {id}` (cykl lub osoby nie ma na tablicy) i `follow_end {id}` (śledzona osoba wyszła ostatnim połączeniem). Po wyjściu celu serwer zeruje śledzenie, więc powrót tej osoby niczego nie wznawia.
- **Prostokąt świata:** klient śledzący oblicza widok, który mieści cały prostokąt w jego oknie z marginesem 4% (`fitRect`) i dojeżdża do niego wygładzaniem wykładniczym (stała około 90 ms, przesunięcie liniowo, zoom w skali logarytmicznej; `stepView`); poniżej pół piksela i 0,2% zoomu przeskakuje na cel. To też zapobiega zapętleniu przy różnych oknach: dwa różne okna nie przekazują sobie wzajemnie niczego, bo przekazywany jest prostokąt świata, nie środek i skala.
- **Łańcuchy:** widok zmieniony przez śledzenie jest rozgłaszany dalej tym samym kanałem (z tym samym limitem), więc A→B→C działa bez osobnej logiki.
- **Cykle wykluczone w dwóch miejscach.** Klient widzi z listy osób, kogo kto śledzi, i nie zaczyna śledzenia, jeśli łańcuch od celu wraca do niego („Ta osoba właśnie śledzi Ciebie”). Serwer powtarza to sprawdzenie na jednej, uporządkowanej kolejce wiadomości (wyścig A→B i B→A: pierwsze wygrywa, drugie dostaje `follow_refused` i traci poprzednie śledzenie, żeby stan klienta i serwera się zgadzał). Cel, którego nie ma na tablicy, też jest odrzucany.
- **Koniec śledzenia:** własny ruch widoku (ręka, kółko, pinch, klawisze, minimapa, przyciski zoomu: wszystko, co przechodzi przez jedną funkcję zmiany widoku), ponowne kliknięcie, „×” na chipie, wyjście celu. Po własnym ruchu chip „Wróć do widoku” pamięta ostatniego śledzonego. Zmiany widoku wykonane przez samo śledzenie są oznaczone jako programowe, więc nie kończą go i nie zapisują się jako „moje miejsce” (R-048).
- **Rysowanie nie kończy śledzenia, ale zamraża widok:** gdy trwa kreska, przeciąganie lub edycja tekstu, widok śledzącego stoi, żeby rysunek pod ręką nie uciekał; po puszczeniu dojeżdża płynnie do aktualnego.
- **Interfejs:** klik w znacznik osoby włącza i wyłącza śledzenie (u właściciela, któremu klik otwiera menu praw, jest to pozycja „Śledź widok” w tym menu); chip „Śledzisz: <nazwa> ×”, podświetlony znacznik, u śledzonego dyskretne „<n> osoby Cię śledzą”, baner zaproszenia z „Dołącz” i „×”. Prawa rysowania (R-016) nie mają wpływu: śledzić i być śledzonym mogą też goście i osoby bez prawa rysowania.

## Konsekwencje
- Koszt serwera: jedna mapa „kto kogo śledzi” przy połączeniu i przekazanie małej wiadomości tylko śledzącym; bez śledzących `view` nie jest w ogóle wysyłany. Przy dłuższych łańcuchach wiadomości mnożą się po jednej na ogniwo, co przy kilkunastu osobach jest pomijalne.
- Lista osób (`peers`) jest rozsyłana ponownie przy każdej zmianie śledzenia (rzadkie zdarzenie).
- Jedna osoba na dwóch kartach liczy się jako jedna: śledzenie kończy się dopiero po wyjściu obu.
- Niczego nie zmieniamy w zapisie tablicy ani w bazie.
