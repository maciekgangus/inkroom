# 0005. Konta, sesje i zapis tablic

- Status: proposed
- Data: 2026-11-09

## Kontekst
Etap 3: konta (R-001), tablice w panelu twórcy z listą i usuwaniem (R-002, R-009, R-019), lista "tablice, do których mam dostęp" (R-017), automatyczny zapis i powrót do tablicy przez ten sam link (R-007). Do tego N-004 (hasła haszowane, trudne do odgadnięcia linki), N-007 (minimum danych, możliwość usunięcia tablicy), N-008 (niskie CPU). Stos: Go, SQLite bez CGO (`modernc.org/sqlite`), plik w wolumenie (ADR 0001, 0002). Protokół i pokoje z ADR 0004.

## Rozważane opcje
Zapis kresek:
1. **Dziennik operacji (append-only) z okresowym zagęszczaniem** (jak zapisano w ADR 0001). Wymaga zagęszczania i odtwarzania stanu przy każdym wczytaniu.
2. **Tabela bieżącego stanu**: wiersz na kreskę, usunięcie kreski usuwa wiersz, cofnięcie gumki wstawia go ponownie. Brak zagęszczania, wczytanie to jeden SELECT. Model z ADR 0004 (niezmienne kreski, `add`/`remove`) mapuje się na to wprost.

Sesje: ciasteczko z losowym tokenem (po stronie serwera) albo JWT. Ciasteczko pozwala natychmiast unieważnić sesję i nie wymaga kluczy.

## Decyzja
- **Zapis stanu: tabela bieżącego stanu** (opcja 2). To zmienia szczegół z ADR 0001 (dziennik z zagęszczaniem): przy niezmiennych kreskach dziennik niczego nie daje, a dokłada zagęszczanie.
- **Zapis z opóźnieniem (write-behind).** Pokój trzyma stan w pamięci, a operacje trafiają do kolejki, którą jedna goroutine zapisuje partiami w jednej transakcji co ok. 500 ms (oraz przy opuszczeniu pokoju przez ostatnią osobę i przy zamknięciu serwera). Okno utraty przy awarii procesu to ok. pół sekundy. Hot path rysowania nie dotyka dysku (priorytet 1 i 3).
- **Pokój wczytywany z SQLite przy pierwszym wejściu**, a po wyjściu ostatniej osoby (po zapisie) usuwany z pamięci. Tablice nieużywane nie zajmują RAM.
- **SQLite w trybie WAL**, plik `DATA_DIR/inkroom.db`. Jedno połączenie do zapisu. Migracje jako wersjonowane skrypty SQL w kodzie.
- **Konta:** e-mail (małe litery, unikalny) i hasło (min. 8 znaków), `argon2id`. Bez weryfikacji e-mail i bez odzyskiwania hasła w MVP.
- **Sesje:** 256-bitowy losowy token w ciasteczku `HttpOnly`, `SameSite=Lax`, `Secure` gdy żądanie przyszło po HTTPS (także przez `X-Forwarded-Proto` z Cloudflare Tunnel). W bazie tylko SHA-256 tokenu. Ważność 30 dni z odnawianiem. Wylogowanie usuwa sesję. API przyjmuje zmiany tylko jako `application/json` (z `SameSite=Lax` wystarcza przeciw CSRF).
- **Ograniczanie prób logowania** w pamięci (okno czasowe na e-mail i adres), żeby spowolnić zgadywanie haseł (N-004).
- **Tablice:** tworzy zalogowany użytkownik (`POST /api/boards` z nazwą). Link `/b/<id>` jak dotąd (128-bit losowy). Gość wchodzi z imieniem, zalogowany bez pytania o imię. Usuwa tylko właściciel; usunięcie kasuje wszystkie dane tablicy, rozłącza obecnych i link zwraca 404 (R-019).
- **Dostęp (R-017):** gdy zalogowany użytkownik otworzy cudzą tablicę, serwer zapisuje wpis (użytkownik, tablica, ostatnie otwarcie). Goście nie zostawiają śladu (N-007).
- **Istnienie tablicy:** `GET /api/boards/{id}` zwraca 200 lub 404, żeby klient nie łączył się w pętli z nieistniejącym linkiem.

## Konsekwencje
- Utrata do ok. 0,5 s ostatnich kresek przy awarii procesu (nie przy normalnym zamknięciu). Do zaakceptowania dla MVP.
- Zależności: `modernc.org/sqlite`, `golang.org/x/crypto/argon2`.
- Kopia zapasowa: `sqlite3 .backup` (Etap 3.5). Do tego czasu dane są w wolumenie Dockera.
- Rejestracja jest otwarta dla każdego (R-001), więc w Etapie 3.5 trzeba rozważyć ochronę przed nadużyciami (limit na adres, ewentualnie zaproszenia).
- Zmieniony szczegół ADR 0001 (dziennik kresek zastąpiony tabelą stanu) odnotowuję tam odsyłaczem.
