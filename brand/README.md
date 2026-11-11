# Inkroom — zestaw brandingu

Znak: stalówka. Napis: Space Grotesk (ink 700 / room 400), litery zamienione na krzywe — pliki SVG nie wymagają fontu.

Kolory
- Atrament (light): #3B36E0, na tle #F4F4F7 (obrys #DADBE3)
- Atrament (dark):  #7C78FF, na tle #1C1D27 (obrys #2E3040)
- Tekst: #12131A (light) / #FFFFFF (dark)

## svg/
- `logo-light.svg`, `logo-dark.svg` — ikona + napis (przezroczyste tło; light na jasne, dark na ciemne tło)
- `logo-notile-*.svg` — sama stalówka + napis, bez kafelka
- `wordmark-*.svg` — sam napis
- `icon-*.svg` — ikona w kafelku (szczegół dla dużych rozmiarów); `icon-*-small.svg` — wersja do 16–48 px
- `app-icon-*.svg` — pełny kwadrat bez zaokrągleń (ikony iOS/Android, system sam zaokrągla)
- `nib-*.svg` — sama stalówka z wycięciem, bez tła
- `favicon.svg` — sam przełącza się light/dark wg motywu przeglądarki

## png/
- `icon-{light,dark}-{16..1024}.png` — przezroczyste rogi; rozmiary ≤48 mają pogrubione nacięcie i otworek, żeby były czytelne
- `apple-touch-icon-{light,dark}.png` — 180×180, pełny kwadrat
- `logo-{light,dark}@2x.png`

## web/ (to idzie do public/)
`favicon.svg`, `favicon.ico` (16/32/48), `apple-touch-icon.png`, `icon-192/512.png`, `maskable-192/512.png`, `site.webmanifest`, `head-snippet.html`
