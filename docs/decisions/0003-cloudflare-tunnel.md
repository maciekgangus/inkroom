# 0003. Wystawienie na internet przez Cloudflare Tunnel

- Status: accepted
- Data: 2026-11-11

## Kontekst
ADR 0002 zostawił otwartą kwestię, jak uczniowie (w tym z iPadów na danych komórkowych) docierają do serwera domowego z HTTPS, a N-004 mówi, że serwer domowy nie otwiera portów na zewnątrz. Obraz aplikacji trafia na serwer z rejestru (ADR 0014), a rejestracja ma captchę Turnstile (ADR 0013), więc domena jest i tak potrzebna w Cloudflare.

## Decyzja
- **Cloudflare Tunnel** w trybie zarządzanym zdalnie: kontener `cloudflared` w tym samym `docker compose` co aplikacja (`deploy/docker-compose.yml`), uruchamiany komendą `tunnel --no-autoupdate run` z tokenem w `TUNNEL_TOKEN` (w `.env` na serwerze, poza repo). Kontener sam łączy się na zewnątrz z Cloudflare, więc router i VPS nie otwierają żadnego portu.
- **Trasa** (publiczna nazwa domenowa, np. `lekcje.twojadomena.pl`, do usługi `http://app:8080`) jest ustawiona w panelu Cloudflare (Zero Trust, Networks, Tunnels, Public Hostname), nie w pliku: `app` to nazwa usługi w sieci compose.
- **HTTPS** kończy się u Cloudflare (certyfikat i odnowienia po ich stronie), od `cloudflared` do aplikacji idzie zwykły HTTP w sieci compose.
- **Port aplikacji** na hoście jest związany tylko z `127.0.0.1:8080`: służy skryptowi aktualizacji (`/healthz`) i obsłudze z serwera, nie internetowi.
- **Aplikacja nie wymaga zmian:** ciasteczka mają `Secure`, gdy nagłówek `X-Forwarded-Proto` to `https` (Cloudflare go ustawia), limity logowania liczą po `CF-Connecting-IP` (ADR 0005), a WebSocket (`/ws/{id}`) przechodzi przez tunel, a przy zerwaniu klient łączy się ponownie (N-005).
- **Domena** musi być w Cloudflare (DNS), bo trasa tunelu to rekord w jej strefie. Zakup i przeniesienie domeny robi użytkownik; do czasu domeny można sprawdzić tunel krótkotrwałym adresem `trycloudflare.com` (opisane w `deploy/README.md`).

## Rozważane opcje
1. Przekierowanie portów na routerze z dynamicznym DNS: odrzucone, otwiera porty i wymaga własnych certyfikatów (N-004).
2. Tailscale Funnel: działa bez domeny, ale adres jest narzucony i mniej pasuje do Turnstile i do kont z własną domeną.
3. Tunel zarządzany lokalnie (plik `config.yml` i poświadczenia): odrzucone na rzecz tokena, bo mniej plików do utrzymania na serwerze.

## Konsekwencje
- Cloudflare terminuje TLS, więc widzi ruch (obrazy, kreski); dla lekcji akceptowalne, ale warto o tym wiedzieć (N-007).
- Token tunelu to sekret: ujawniony pozwala podpiąć cudzy serwer pod nasz adres. Wymiana: nowy token w panelu i w `.env`, `docker compose up -d`.
- Awaria łącza w domu odcina uczniów (tunel nie ma jak się połączyć); lekcja bez internetu na serwerze nie jest możliwa (ADR 0002, otwarte: kopie zapasowe poza maszyną).
- `cloudflared` jest uaktualniany razem z aplikacją przez `update.sh` (pobiera obraz `cloudflare/cloudflared:latest`), co jest wymagane, bo Cloudflare przestaje wspierać stare wersje.
