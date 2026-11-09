# 0002. Wdrożenie: docker compose, najpierw lokalnie, potem domowy VPS

- Status: accepted
- Data: 2026-11-09

## Kontekst
Aplikacja ma być tania w utrzymaniu (N-006) i uruchamiana jedną komendą (N-009). Uczniowie, w tym z iPadów i tabletów, muszą docierać do serwera przez internet podczas lekcji, z HTTPS (N-004).

## Decyzja
1. Cała aplikacja (serwer, baza, ewentualny reverse proxy) jest opisana w `docker-compose.yml`. Lokalnie uruchamiana przez `docker compose up`.
2. Ta sama konfiguracja trafia później na domowy VPS (maszyna wirtualna na własnym serwerze), z nadpisaniami produkcyjnymi (np. `docker-compose.prod.yml` lub zmienne środowiskowe).
3. Sekrety w pliku `.env` poza repo. Dane (baza, zapisane tablice) w wolumenach, z regularną kopią zapasową.
4. Na razie bez Kubernetes i bez zewnętrznego hostingu.

## Konsekwencje
- Stos wybrany w ADR 0001 musi dać się uruchomić w kontenerze. Obraz ma być mały i oszczędny procesorowo (N-008).
- Etap 0 obejmuje działający `docker compose up` z pustą aplikacją. Test na iPadzie w Etapie 0 odbywa się przez sieć lokalną.
- Etap 3.5 wdraża to samo na domowy VPS i sprawdza dostęp z iPada na danych komórkowych.

## Otwarte do rozstrzygnięcia w Etapie 3.5
- Jak wystawić serwer domowy na internet: tunel (np. Cloudflare Tunnel, Tailscale Funnel) albo przekierowanie portów z dynamicznym DNS. Zależy m.in. od tego, czy dostawca łącza daje publiczny adres IP.
- Domena i certyfikaty HTTPS (np. reverse proxy z automatycznymi certyfikatami).
- Zachowanie przy awarii łącza w domu i sposób kopii zapasowych poza maszyną z aplikacją.
