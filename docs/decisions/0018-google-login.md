# 0018. Logowanie przez Google (OpenID Connect, kod z PKCE)

- Status: accepted
- Data: 2026-11-18

## Kontekst
R-063: logowanie i rejestracja kontem Google obok e-maila i hasła (ADR 0005, 0013). Uczniowie na tabletach nie chcą zakładać kolejnego hasła, a konto Google daje potwierdzony e-mail, czego rejestracja hasłem nie ma.

## Decyzja
- **Przepływ:** OpenID Connect, kod autoryzacji z PKCE (S256), zakresy `openid email profile`, poprzez serwer (klient ma tylko link `GET /api/auth/google/start`). Wywołanie zwrotne to `GET /api/auth/google/callback`.
- **Ochrona przepływu:** `state` jest losowy, trzymany w pamięci serwera razem z weryfikatorem PKCE i `nonce` (10 minut, użycie jednorazowe, najwyżej 1000 otwartych naraz) i związany z przeglądarką ciastkiem `google_state` (HttpOnly, SameSite=Lax, ścieżka `/api/auth/google`), więc cudzy link zwrotny nie zaloguje nikogo (login CSRF). Restart serwera kasuje trwające logowania, co najwyżej trzeba kliknąć drugi raz.
- **Token tożsamości:** serwer wymienia kod na `id_token` bezpośrednio w punkcie końcowym Google przez TLS, z sekretem klienta i weryfikatorem PKCE. Przy takim odbiorze OpenID Connect Core 3.1.3.7 pozwala nie sprawdzać podpisu, więc nie ma pobierania ani cache kluczy JWKS. Sprawdzane są: `iss` (`https://accounts.google.com` lub `accounts.google.com`), `aud` równe ID klienta, `exp`, `nonce`, niepuste `sub` i `email_verified` (bool albo napis `true`). Niepotwierdzony e-mail kończy się odmową.
- **Konto:** rozpoznawane po `sub` (kolumna `users.google_sub`, unikalna, gdy niepusta), nie po e-mailu, który się zmienia. Pierwsze logowanie bez konta tworzy konto bez hasła (pusty `hash`, który nigdy nie pasuje do żadnego hasła) i z nazwą z początku e-maila (jak migracja z ADR 0013, z liczbą przy kolizji). Captcha (R-054) nie dotyczy tej ścieżki: Google już sprawdza, kto jest człowiekiem.
- **E-mail zgodny z istniejącym kontem z hasłem:** konto jest **łączone** tylko przy potwierdzonym przez Google e-mailu, ale hasło jest wtedy **kasowane, a wszystkie sesje kończone**. Powód: rejestracja hasłem nie potwierdza e-maila, więc ktoś mógł założyć konto na cudzy adres (i zna hasło); samo połączenie dałoby mu stały dostęp do konta i tablic prawdziwego właściciela, który wszedł przez Google. Kto naprawdę miał konto z hasłem, loguje się odtąd Google (to ten sam e-mail), a hasło może ustawić ponownie po R-085. Konto już połączone z innym `sub` nigdy nie jest nadpisywane.
- **Konfiguracja:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` i `PUBLIC_URL` (adres strony do budowy `redirect_uri`; puste: z żądania, z `X-Forwarded-Proto`). Bez ID i sekretu przycisk jest ukryty (`GET /api/config` zwraca `google: false`), a obie ścieżki odpowiadają 404. Kroki w konsoli Google: `deploy/README.md`, punkt 8.
- **Błędy:** każde niepowodzenie odsyła na `/?google=error` (anulowanie: `/?google=denied`), a strona logowania pokazuje komunikat. Szczegółów błędu nie ma w adresie ani w odpowiedzi.

## Rozważane opcje
1. Biblioteka `golang.org/x/oauth2` i `coreos/go-oidc`: odrzucone, to kilkadziesiąt linii własnego kodu, a bez sprawdzania podpisu nie potrzeba JWKS (prostota, mniej zależności).
2. Stan w podpisanym ciastku zamiast w pamięci: odrzucone, bo wymaga nowego sekretu i nie daje jednorazowości.
3. Łączenie po e-mailu bez kasowania hasła: odrzucone (przejęcie konta, patrz wyżej). Odmowa łączenia i prośba o hasło: odrzucona, bo właściciel e-maila zostałby bez dostępu do własnego konta.
4. Rejestracja tylko przez Google: odrzucona, e-mail i hasło zostają.

## Konsekwencje
- Serwer rozmawia z `oauth2.googleapis.com` przy każdym logowaniu (limit 10 s); logowanie hasłem nadal działa bez Google.
- Konto z samego Google nie ma hasła, więc nie zaloguje się przez `/api/login`; ustawienie hasła to osobne zadanie (R-085).
- Migracja dodaje `users.google_sub` (domyślnie pusta) i unikalny indeks częściowy.
- `PUBLIC_URL` i adres w konsoli Google muszą być zgodne co do znaku, inaczej Google odpowiada `redirect_uri_mismatch`.
