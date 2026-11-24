# 0025. Kalendarz zajęć w tej samej bazie i na tym samym koncie

- Status: proposed
- Data: 2026-11-24

## Kontekst
Platforma Ekorepetycje (Python, FastAPI, PostgreSQL, Redis, HTMX) ma kalendarz zajęć, serie, niedostępność i prośby o zmianę terminu, a Inkroom (Go, SQLite, Preact) tablice i konta. Wymagania: R-104 do R-109. Obie aplikacje mają osobne konta (INTEGER i UUID), osobne bazy i osobne wdrożenia, a zajęcia i tablice mają być połączone.

## Rozważane opcje
1. Dwie aplikacje i dwie bazy ze wspólnym logowaniem. Wady: dwa wdrożenia, SSO, spójność danych przez sieć, a wspólne jest właściwie tylko konto.
2. Jedna aplikacja, kalendarz w tej samej bazie SQLite. Zalety: jedno konto, klucze obce do `users` i `boards` (zajęcie wskazuje tablicę), transakcje, jedna kopia Litestream, jedno wdrożenie.
3. Jedna aplikacja, ale kalendarz w Postgresie. Wady: nowa usługa na homelabie bez powodu, skala to kilkadziesiąt kont.

## Decyzja
Opcja 2. Kalendarz to nowe tabele w SQLite Inkrooma (`lessons`, `lesson_series`, `unavailability`, `change_requests`) i nowe pakiety w serwerze Go. Bez ról na koncie: prowadzącym jest ten, kto tworzy zajęcie. Czasy w bazie jako sekundy UTC (INTEGER, jak reszta bazy), serie trzymają strefę IANA i rozwijają się przy tworzeniu. Redis odpada (nie ma cache'u do utrzymania), Postgres też. Pliki Pythona służą tylko jako wzór funkcji i znikną po przeniesieniu.

## Konsekwencje
- Migracje dopisujemy do listy `migrations` w `store.go` (tylko na końcu).
- Czas zajęć sprawdzamy w jednej transakcji z zapisem, żeby dwa żądania nie wstawiły nakładających się zajęć.
- Ograniczenie: jedna instancja serwera i jeden zapis naraz (SQLite), co przy tej skali wystarcza.
- Projekt wizualny kalendarza jest osobnym zadaniem; pierwszy klient jest prosty.
