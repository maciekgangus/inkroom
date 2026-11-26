# 0030. Nagrywanie lekcji: bucket S3 (R2) i dysk serwera jako zapas

- Status: accepted (obiekty zmienione przez ADR 0028: dźwięk i oś zdarzeń zamiast wideo z ekranu; bucket, podpisane adresy, dysk jako zapas i reszta tej decyzji obowiązują)
- Data: 2026-11-25

## Kontekst
R-094: prowadzący nagrywa ekran i mikrofon; wideo ma trafiać do magazynu poza serwerem aplikacji. Cloudflare ogranicza wideo przez swoje proxy (tunel) na darmowym planie, R2 je dopuszcza. R-117 (etap 1) dodał zapis na dysku serwera, żeby dało się nagrywać przed założeniem bucketu i na środowiskach testowych bez R2.

## Rozważane opcje
1. **Wideo przez serwer aplikacji** (do pliku lub dalej do bucketu). Proste, ale wideo idzie przez tunel i obciąża serwer, czyli to, czego R-094 chce uniknąć.
2. **Wysyłanie wieloczęściowe prosto z przeglądarki do bucketu, adresy podpisuje serwer.** Serwer nie widzi wideo; trzeba CORS w buckecie i wspólnego zachowania dwóch magazynów.
3. **Biblioteka AWS SDK lub własny SigV4.** SDK jest duże; własny podpis to kod, który łatwo zepsuć.

## Decyzja
Opcja 2, z biblioteką `minio-go` (mały klient S3, działa z R2, GCS i MinIO) w pakiecie `internal/recstore`. Interfejs `Backend` ma dwie implementacje: `S3` (bucket) i `Disk` (katalog w `DATA_DIR`). Bucket ustawiają cztery zmienne `RECORDINGS_S3_*` (wszystkie albo żadna); bez nich działa `Disk`.

Przepływ jest jeden dla obu magazynów: serwer zakłada wiersz i przesyłanie (`POST /recordings`), przeglądarka tnie wideo na części równe `PartSize` (5 MiB, ostatnia krótsza; R2 wymaga równych części) i dla każdej prosi o adres (`POST .../parts/{n}`). Dla bucketu to podpisany adres, dla dysku adres serwera (`PUT .../parts/{n}`), który wpisuje część na jej miejsce w pliku, więc kolejność i powtórzenia nie mają znaczenia. Przeglądarka nie wysyła własnych nagłówków do bucketu (podpis musi się zgadzać), a przy każdej próbie prosi o nowy adres. `POST .../finish` składa część w obiekt (`ListParts` i `CompleteMultipartUpload`, więc przeglądarka nie musi znać ETagów; bierze się nieprzerwany ciąg części od pierwszej) i zapisuje rozmiar i czas. Nagranie bez ani jednej części znika.

Uprawnienia: nagrywa, kończy i usuwa tylko twórca tablicy; listę i pobieranie ma każdy z dostępem do tablicy, także gość (R-003). Pobranie to przekierowanie na podpisany adres ważny 5 minut (dla dysku plik z serwera). Usunięcie nagrania, tablicy lub konta usuwa też obiekt.

Zerwane nagrania: co 5 minut serwer kończy te, od których przez 15 minut nie przyszła żadna część (czas trwania to czas do ostatniej części), a puste usuwa; reguła cyklu życia bucketu łapie resztę. Część wysyłana po 80 minutach od startu jest odrzucana (limit 1 h 15 min pilnuje klient, 5 minut zapasu na ostatnie części).

Czerwona kropka: klient twórcy wysyła `{"t":"recording","on":true|false}`; pokój trzyma flagę w pamięci przy połączeniu (nie w bazie) i dokłada `recording` do listy osób, więc kropkę widzą też ci, którzy dołączą później, a znika razem z połączeniem. Klient ponawia komunikat po ponownym połączeniu.

Przeglądarka łączy się z bucketem, więc CSP strony dostaje jego adres w `connect-src` (tylko gdy bucket jest ustawiony).

## Konsekwencje
- Nowa zależność `minio-go` z kilkoma drobnymi (do sprawdzenia przez Trivy w CI).
- Dwie implementacje i wiersz z polem `storage`: zmiana ustawień nie gubi starych nagrań.
- Prawdziwy S3 sprawdzają testy z `RECSTORE_TEST_S3` (lokalny S3, np. SeaweedFS lub MinIO); R2 samo trzeba sprawdzić na wdrożeniu (sekcja 12 `deploy/README.md`).
- Tryb dyskowy zostaje dla prób: wideo przez tunel, bez limitu miejsca i kopii.
- Odtwarzacza na stronie nie ma (poza zakresem R-094).
