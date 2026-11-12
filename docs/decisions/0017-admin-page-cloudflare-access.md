# 0017. Strona administratora za Cloudflare Access

- Status: accepted
- Data: 2026-11-12

## Kontekst
R-064: właściciel chce przeglądać uwagi z przycisku „!” (R-062) i zarządzać nimi z przeglądarki, także z iPada, bez zakładania w aplikacji osobnego konta administratora i bez wystawiania strony każdemu. Aplikacja stoi za tunelem Cloudflare (ADR 0003), więc ruch i tak przechodzi przez Cloudflare.

## Rozważane opcje
1. **Konto administratora w aplikacji** (flaga na koncie, hasło). Proste, ale to kolejne konto do pilnowania, a strona jest widoczna i atakowalna z internetu.
2. **Osobny nasłuch tylko na loopbacku, wejście przez SSH** (`ssh -L`). Zero ekspozycji, ale wymaga klienta SSH na każdym urządzeniu, z iPada niewygodne.
3. **Cloudflare Access przed `/admin` i `/api/admin`** (Zero Trust, plan darmowy). Wejście na adres pokazuje stronę logowania Cloudflare (kod na e-mail albo Google), reguła wpuszcza tylko e-mail właściciela. Działa z każdego urządzenia, bez kont w aplikacji.
4. **Certyfikat klienta (mTLS) lub token usługi.** Token usługi jest do skryptów (przeglądarka nie dokłada nagłówków sama); dostępności mTLS w darmowym planie nie sprawdzono.

## Decyzja
**Opcja 3, z weryfikacją po stronie serwera.** Sama bramka Cloudflare nie wystarcza: ktoś, kto dotrze do serwera z pominięciem Cloudflare (np. w sieci domowej do portu 8080), ominąłby ją. Dlatego serwer sprawdza podpisany token `Cf-Access-Jwt-Assertion`, który Cloudflare Access dokłada do każdego przepuszczonego żądania: podpis z kluczy zespołu (`https://<zespół>.cloudflareaccess.com/cdn-cgi/access/certs`, RS256, cache godzinę), wystawcę, odbiorcę (tag aplikacji `CF_ACCESS_AUD`), ważność i obecność e-maila w tokenie (token usługi nie ma e-maila, więc nie wchodzi). Bez poprawnego tokenu, a także gdy `CF_ACCESS_TEAM_DOMAIN` albo `CF_ACCESS_AUD` nie są ustawione (domyślnie), serwer odpowiada tym samym 404 co dla nieistniejącego adresu, żeby nic nie zdradzało, że strona istnieje.
- Strona jest wbudowana w plik wykonywalny (`go:embed`), nie leży w folderze statycznym, który jest publiczny.
- Zmiany (oznaczenie, usunięcie) wymagają nagłówka `X-Admin-Request`: przeglądarka nie pozwoli obcej stronie dodać go bez zapytania wstępnego, więc ciasteczko Cloudflare nie wystarcza do wywołania ich z cudzej strony.
- Strona ma `X-Robots-Tag: noindex, nofollow` i `Cache-Control: no-store`, nie jest nigdzie linkowana. Cały tekst uwag jest wstawiany jako tekst (`textContent`), nie jako HTML.
- O tym, kto wchodzi, decyduje reguła w panelu Cloudflare (adres e-mail właściciela); w aplikacji nie ma żadnych kont administratorów ani haseł.

## Konsekwencje
- **Konfiguracja jednorazowa po stronie Cloudflare** (kroki w `deploy/README.md`, sekcja 7) i dwie zmienne w `.env` na serwerze. Do tego czasu strona jest wyłączona (404).
- Wygoda: logowanie jednorazowym kodem na e-mail, sesja Access trwa tyle, ile ustawisz (np. 24 godziny).
- Zależność od dostępności Cloudflare i kluczy z `/cdn-cgi/access/certs`: gdy nie da się ich pobrać, panel jest niedostępny (zamknięty, nie otwarty).
- Dalsze funkcje panelu (np. lista kont, statystyki) mogą korzystać z tej samej bramki.
