# 0032. Biblioteka nagrań przy koncie i jedna reguła dostępu do nagrań

- Status: accepted
- Data: 2026-11-26

## Kontekst
R-119 (zmienia R-019 i R-094 w punkcie usuwania tablicy). Nagrania lekcji (R-094, R-113 do R-117, ADR 0028 do 0030) są dziś przypięte do tablicy: lista „Nagrania” jest wewnątrz tablicy, adresy mają postać `/api/boards/{tablica}/recordings/{nagranie}/...` i `/b/{tablica}/r|v/{nagranie}`, wiersz `recordings` ma klucz obcy do `boards` z `ON DELETE CASCADE`, a dostęp to „ma dostęp do tablicy” (twórca, zalogowany albo gość z linkiem, R-003). Użytkownik chce, żeby nagrania i wideo były **przy koncie**: jedna biblioteka ze wszystkich tablic, do których konto kiedykolwiek miało dostęp, a nagranie ma **przeżyć usunięcie tablicy**. Zakładamy też, że obok powstaje (osobno, nie w tym ADR) system znajomych i dostępu do tablic, z którym wideo ma się zintegrować.

Stan, na którym budujemy (kod z `origin/main` i PR #134):
- `visits(user_id, board_id, last_opened)` zapisuje, że konto otworzyło tablicę (R-017), ale wiersze znikają razem z tablicą (`ON DELETE CASCADE`). Gość nie ma wiersza.
- Pliki nagrania leżą pod kluczem `<id nagrania>/…` (dysk albo bucket, ADR 0030), więc same nie zależą od tablicy. Od tablicy zależą: wiersz w bazie, adresy API i odtwarzaczy, zadania renderera (`/render/{tablica}/{nagranie}/…`) oraz **obrazy** wstawione na tablicę, do których odwołuje się zapis stanu (`snapshot.json`) i oś zdarzeń; obrazy leżą w tabeli `images` tablicy i znikają z nią.
- Dostęp sprawdza dziś jedna funkcja na tablicę (`boardFromURL` i `ownedRecording`), a każdy punkt końcowy nagrań wywołuje ją osobno.

Ograniczenia: priorytet 1 (responsywność tablicy) i priorytet 2 (iPady) nie mogą ucierpieć, a lista w bibliotece musi działać przy setkach nagrań. Bez kopiowania wielkich plików (dźwięk i wideo zostają tam, gdzie są).

## Rozważane opcje
**A. Biblioteka jako widok po `visits` (bez zmian w modelu).** Lista = nagrania tablic, które konto ma w `visits` lub jest ich twórcą. Najprostsze i zgodne z odebraniem dostępu (znika wiersz, znika dostęp), ale **nie spełnia „nagranie przeżywa tablicę”**: po usunięciu tablicy znikają i `visits`, i podstawa dostępu, i obrazy.

**B. Nagranie samodzielne, z własną listą uprawnionych.** Wiersz `recordings` przestaje zależeć od tablicy (własny właściciel, nazwa tablicy, kopia obrazów) i ma tabelę `recording_viewers(recording_id, user_id)`, zapisywaną przy końcu nagrania i przy każdym późniejszym wejściu na tablicę. Przeżywa tablicę, ale dubluje wiedzę o dostępie (druga lista do utrzymania, trzeba ją synchronizować przy odebraniu dostępu, a system znajomych musiałby pisać do niej też).

**C. Jedna reguła dostępu złożona ze źródeł (wybrane).** Funkcja `mayWatch(konto, nagranie)` składa odpowiedź z niezależnych źródeł; każde źródło jest małe i dopisuje się osobno:
1. **Twórca nagrania** (`recordings.owner_id`, zapisywany przy starcie nagrania).
2. **Tablica jeszcze istnieje:** konto ma na niej dostęp (`visits` albo jest jej twórcą), według tej samej reguły co dostęp do tablicy, więc odebranie dostępu do tablicy odbiera dostęp do nagrań. Gość z linku widzi nagrania tylko w oknie tablicy.
3. **Tablica została usunięta:** lista uprawnionych zapisana w chwili usunięcia (`recording_viewers`, wypełniana z `visits` w tej samej transakcji co usunięcie tablicy), bo tylko wtedy wiemy, kto miał dostęp.
4. **Systemy dodatkowe** (znajomi, udostępnianie, zaproszenia, kalendarz zajęć R-104): każdy dostarcza własne źródło zwracające „tak/nie” dla pary (konto, nagranie), bez dotykania reszty.

## Decyzja
Wybieramy **C**, bo jedynie ona daje jednocześnie: dostęp zgodny z tym, co dzieje się z tablicą (opcja A), nagranie niezależne od tablicy (opcja B) i jedno miejsce na reguły, do którego przyłączają się kolejne systemy. Nie utrzymujemy dwóch list uprawnionych naraz: lista z punktu 3 powstaje **raz**, w chwili usunięcia tablicy, i potem się nie zmienia (poza usunięciem konta).

Pozostałe ustalenia (z odpowiedzi użytkownika 2026-11-26):
- **Nagranie przeżywa usunięcie tablicy.** Usunięcie tablicy (R-019) usuwa tablicę, jej elementy, obrazy i `visits`, ale nie nagrania. Żeby nagranie dało się odtworzyć i wyrenderować bez tablicy, **przy usuwaniu tablicy** (albo wcześniej, przy końcu nagrania; decyzja wykonawcy z pomiarem kosztu) obrazy użyte w nagraniu są kopiowane do magazynu nagrania (`<id nagrania>/images/…`), a zapis stanu i oś zdarzeń odwołują się do nich przez adres nagrania, nie tablicy. Nagranie zapamiętuje też nazwę tablicy w chwili usunięcia, żeby biblioteka mogła ją pokazać.
- **Gość, który później założy konto,** nie wymaga osobnej ścieżki: po założeniu konta i wejściu na tablicę ma wiersz w `visits`, więc działa źródło 2. Nic z okresu, gdy był gościem, nie jest wiązane z kontem wstecz.
- **Odebranie dostępu do tablicy** odbiera dostęp do jej nagrań (źródło 2 przestaje odpowiadać „tak”). Dla tablicy już usuniętej (źródło 3) twórca nagrania może usunąć konkretną osobę z jego listy (do ustalenia przy wdrożeniu, jeśli okaże się potrzebne).
- **Adresy:** nagranie dostaje adresy niezależne od tablicy: API `/api/recordings` (lista z numerem strony i wyszukiwaniem po nazwie nagrania i tablicy), `/api/recordings/{nagranie}/…` oraz strony `/r/{nagranie}` (odtwarzacz z osi zdarzeń) i `/v/{nagranie}` (wideo). Stare adresy z tablicą (`/b/{tablica}/r|v/{nagranie}`, `/api/boards/{tablica}/recordings/...`) zostają i przekierowują albo działają dalej, bo linki z poprzednich wersji istnieją.
- **Renderer:** zadania i adresy renderera (`/render/{tablica}/{nagranie}/…`) przechodzą na sam identyfikator nagrania, bo tablicy może nie być.
- **Konto twórcy usunięte** (przez administratora, R-065, razem z jego tablicami): jego nagrania są **archiwizowane**, nie usuwane. Wiersz dostaje znacznik archiwizacji i migawkę dawnego właściciela (nazwa i e-mail), `owner_id` przestaje wskazywać konto, a wszystkie źródła `mayWatch` przestają odpowiadać „tak”: nagranie znika z bibliotek wszystkich, także osób z listy `recording_viewers`. Zostaje u administratora: zakładka **„Nagrania”** w panelu (R-064, R-065) pokazuje zwykłą listę zarchiwizowanych nagrań z akcjami „Odtwórz”, „Wideo”, „Pobierz” i „Usuń”. Odczyt idzie ścieżką `/api/admin`, za bramką panelu (Cloudflare Access), więc **nie przechodzi przez `mayWatch`**. Pliki zostają w magazynie do chwili ręcznego usunięcia. To odczytanie wypowiedzi użytkownika („niech się archiwizują i przechodzą na panel admina”): jeśli osoby z listy uprawnionych mają jednak nadal oglądać zarchiwizowane nagranie, wystarczy w źródle 3 nie wyłączać listy dla zarchiwizowanych.
- **Lista na tablicy** (R-094) zostaje: to ta sama reguła dostępu zawężona do jednej tablicy. Wejście do biblioteki jest w panelu (R-009, R-017).

## Konsekwencje
Praca do wykonania (kolejność od najmniej ryzykownej):
1. Migracja (dopisana na końcu listy `migrations`): `recordings` dostaje `owner_id`, `board_name`; klucz obcy do `boards` przestaje kasować kaskadowo (stare wiersze: `owner_id` z właściciela tablicy); tabela `recording_viewers`; zmiana kasowania tablicy tak, by przed `DELETE` zapisać uprawnionych i obrazy nagrań.
2. Funkcja `mayWatch` z testami każdego źródła i punktem wejścia dla kolejnych; wszystkie punkty końcowe nagrań (lista, odtwarzacze, pobieranie, wideo, zadania renderera) przechodzą przez nią zamiast przez dostęp do tablicy.
3. API i strona biblioteki (lista stronicowana, wyszukiwanie, filtr „z tej tablicy”), wejście z panelu.
4. Adresy niezależne od tablicy, przekierowania ze starych, zmiana adresów renderera (zgodna wstecz z pracującym rendererem, bo obraz renderera wydaje się osobno).
5. Kopiowanie obrazów do nagrania i odtwarzanie ich z adresu nagrania (odtwarzacz, renderer).
6. Archiwum po usunięciu konta twórcy: patrz „Decyzja”. Do doprecyzowania przy wdrożeniu tylko limit rozmiaru kopii obrazów.
7. Zakładka „Nagrania” w panelu administratora (zwykła lista, bez sortowania i filtrów na start) i jej API pod `/api/admin/recordings` (odczyt listy, plik dźwięku i wideo do odtworzenia i pobrania, usunięcie), za tą samą bramką co reszta panelu (R-064).

Czego nie zmienia: formatu nagrania (ADR 0028), renderowania wideo (ADR 0029), magazynu (ADR 0030) ani zasady, że tylko twórca nagrywa i usuwa nagrania. Opcja A zostaje wystarczająca, gdyby nagranie jednak nie musiało przeżywać tablicy (wtedy punkty 3 i 5 odpadają).
