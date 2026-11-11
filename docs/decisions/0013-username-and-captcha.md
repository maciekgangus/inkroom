# 0013. Nazwa użytkownika, strona rejestracji z captchą i logowanie e-mailem lub nazwą

- Status: accepted
- Data: 2026-11-11

## Kontekst
R-053 do R-055. Konto dotąd miało tylko e-mail, a nazwa na tablicy była jego początkiem (ADR 0005), co pokazywało fragment cudzego adresu. Rejestracja była formularzem na stronie głównej bez ochrony przed botami.

## Decyzja
- **Nazwa użytkownika.** Kolumny `users.username` (jak wpisano) i `users.username_key` (małe litery, unikalne). Reguła: `^[A-Za-z0-9._-]{3,24}$`, bez rozróżniania wielkości liter przy unikalności. Migracja nadaje istniejącym kontom nazwę z początku e-maila (małe litery, niedozwolone znaki usunięte, uzupełnienie do 3 znaków, przy kolizji liczba na końcu), w kolejności `id`. Nazwa jest publiczną nazwą osoby na tablicy (lista osób, kursor, adnotacja właściciela); e-mail nie opuszcza serwera poza właścicielem konta (`/api/me`).
- **Logowanie.** Jedno pole: zawierające `@` jest e-mailem, reszta nazwą. Limity prób liczone po zapisanym kluczu (`email:` albo `user:` plus znormalizowany identyfikator) i po adresie IP, jak dotąd; komunikat błędu jest jeden ("Nieprawidłowy login lub hasło"), niezależnie od tego, czy konto istnieje.
- **Rejestracja** to `POST /api/register` z polami `email`, `username`, `password`, `captcha`. Serwer weryfikuje token captchy u Cloudflare (`https://challenges.cloudflare.com/turnstile/v0/siteverify`, pola `secret`, `response`, `remoteip`) **przed** zapisem konta. Bez skonfigurowanego sekretu (`TURNSTILE_SECRET`) rejestracja kończy się 503, więc zapomnienie o kluczach nie otwiera jej po cichu. Weryfikator jest interfejsem (`auth.Captcha`), więc testy używają atrapy.
- **Konfiguracja.** `TURNSTILE_SITE_KEY` (publiczny, klient dostaje go z `GET /api/config`) i `TURNSTILE_SECRET` w `.env`. Lokalnie `docker-compose.override.yml` podaje opublikowane klucze testowe Turnstile (zawsze przechodzą), więc na serwerze, gdzie override nie jest ładowany (ADR 0002), trzeba ustawić prawdziwe klucze z panelu Cloudflare (widżet Turnstile dla domeny).
- **Strona `/register`** jest osobnym widokiem klienta (tak samo `/` ma logowanie), z widżetem Turnstile ładowanym ze skryptu Cloudflare (jawne renderowanie). Rejestracja nie jest już na stronie głównej; odnośniki "Załóż konto" i "Mam już konto" łączą oba widoki.

## Rozważane opcje
1. Własna captcha z proof-of-work (Altcha): bez zewnętrznej usługi, ale słabsza ochrona; użytkownik wybrał Turnstile.
2. hCaptcha: odrzucona, bez przewagi nad Turnstile przy Cloudflare Tunnel (ADR 0003).
3. Pytanie o nazwę przy pierwszym logowaniu istniejących kont: odrzucone, migracja nadaje nazwę z e-maila (można ją zmienić później).

## Konsekwencje
- Rejestracja wymaga połączenia z Cloudflare (widżet w przeglądarce i weryfikacja z serwera); logowanie nie.
- Interfejs `/api/register` zmienia się niekompatybilnie (nowe wymagane pola); klient i testy zmieniają się razem.
- `/api/me` zwraca także `username`; klient używa go zamiast początku e-maila.
- Zmiana nazwy użytkownika po rejestracji nie jest częścią tego zadania.
