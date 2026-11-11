# 0016. Kopie zapasowe bazy: Litestream do Cloudflare R2

- Status: accepted
- Data: 2026-11-11

## Kontekst
Wszystko (konta, tablice, obrazy, strony PDF) leży w jednej bazie SQLite w wolumenie `data` na homelabie (ADR 0002, 0005, 0007). Awaria dysku albo skasowanie wolumenu oznacza utratę wszystkich lekcji, a ręczna kopia (`tar` przy zatrzymanej aplikacji) jest zawodna. Baza działa w trybie WAL (`journal_mode(WAL)`), co jest warunkiem Litestream.

## Decyzja (odpowiedzi użytkownika z 2026-11-11: R2, tydzień wstecz)
- **Litestream 0.5.18** jako osobny kontener (sidecar) w `deploy/docker-compose.yml`, na tym samym wolumenie `data` co aplikacja. Co około sekundę wysyła zmiany bazy do **Cloudflare R2** (zgodnego z S3), a raz na dobę robi pełny snapshot. Konfiguracja w `deploy/litestream.yml`, klucze z `.env` (`R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`); adres to `https://<konto>.r2.cloudflarestorage.com`, region `auto`.
- **Retencja: tydzień** (`snapshot.retention: 168h`): można cofnąć bazę do dowolnej chwili z ostatnich 7 dni.
- **Brak kluczy = brak startu.** Compose wymaga czterech zmiennych R2 i odmawia uruchomienia z komunikatem, żeby nie dało się przez przeoczenie działać bez kopii.
- **Odtworzenie na nowej maszynie jest automatyczne.** Jednorazowy kontener `litestream-restore` działa przed aplikacją: gdy na wolumenie nie ma bazy, a w R2 są kopie, sprowadza bazę (`-if-db-not-exists -if-replica-exists`); gdy baza jest, nic nie robi. Po awarii wystarczy więc skopiować folder `deploy/` i `.env` na nowy serwer i uruchomić `docker compose up -d`.
- **Cofnięcie do chwili** robi `deploy/restore.sh [czas UTC]`: zatrzymuje aplikację i kopiowanie, odkłada obecną bazę do `/data/before-restore/<data>` (nic nie jest kasowane), odtwarza bazę z R2 (najnowszą albo z podanej chwili) i uruchamia wszystko. Używa usługi `shell` (busybox, profil `tools`), bo obraz Litestream nie ma powłoki.
- **Użytkownik kontenerów:** Litestream działa jako ten sam użytkownik co aplikacja (`65532`), żeby pliki, które tworzy (odtworzona baza, katalog `-litestream`), były do jej dyspozycji.
- **SELinux:** na serwerze z SELinux w trybie enforcing (Fedora, RHEL) kontenery nie mogą dzielić wolumenu bez wyłączenia kontroli etykiet; opcjonalny `deploy/docker-compose.selinux.yml` robi to dla czterech usług (włącza się go w `.env`: `COMPOSE_FILE=docker-compose.yml:docker-compose.selinux.yml`). Na hoście bez SELinux jest zbędny.
- **Test:** `sh scripts/test-backup.sh` buduje obraz aplikacji i na prawdziwym `deploy/docker-compose.yml` z lokalnym S3 (Adobe S3Mock zamiast R2) sprawdza: kopiowanie, utratę wolumenu i automatyczny powrót bazy, cofnięcie do wybranej chwili oraz dalsze kopiowanie po odtworzeniu. Trwa kilka minut, wymaga Dockera; nie jest częścią CI.

## Rozważane opcje
1. **Litestream w kontenerze aplikacji (`replicate -exec`):** zalecany przez autorów, ale wymaga zmiany obrazu (binarka Litestream, rozruch) i obraz aplikacji nie ma powłoki; sidecar nie dotyka obrazu aplikacji.
2. **Backblaze B2 albo AWS S3:** też działają (ta sama konfiguracja S3); wybrano R2, bo Cloudflare już jest w projekcie (ADR 0003), a pobieranie nie kosztuje.
3. **Ręczny `tar` wolumenu:** zostaje jako awaryjny sposób, ale wymaga zatrzymania aplikacji.

## Konsekwencje
- **Koszt:** R2 ma 10 GB za darmo i 1 mln operacji zapisu miesięcznie; kopiowanie robi zapis tylko przy zmianie bazy, więc podczas lekcji to rząd tysięcy dziennie. Baza rośnie z obrazami i stronami PDF (ADR 0007, 0015); brakuje jeszcze limitu obrazów na tablicę.
- **Jedna replika:** wersja 0.5 obsługuje jeden cel na bazę; dostępność kopii to dostępność R2.
- **Klucze:** token R2 powinien mieć tylko odczyt i zapis do tego jednego bucketu. Ujawniony pozwala czytać wszystkie dane (konta, tablice), więc trzymany jest tylko w `.env` na serwerze.
- **Błędne zmiany też się kopiują** w kilka sekund; ratuje cofnięcie do chwili sprzed błędu w oknie tygodnia.
- **Kopia nie obejmuje `.env`** (tokenów i kluczy): trzeba go trzymać osobno.
- **Odtworzenie trzeba przećwiczyć na prawdziwym R2** raz po wdrożeniu (`restore.sh` na kopii testowej), bo test automatyczny używa lokalnego S3.
