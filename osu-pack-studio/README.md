# osu! Pack Studio

Natywna aplikacja desktopowa na Windows do tworzenia własnych paczek beatmap osu!. Gotowa wersja portable działa bez instalacji, konsoli, Rust i osobnego FFmpeg.

## Uruchomienie jednym kliknięciem

Uruchom dwuklikiem plik `osu-Pack-Studio.exe`. Aplikacja jest przenośna — nie wymaga instalatora. Przy pierwszym uruchomieniu Windows może potrzebować kilku sekund na rozpakowanie programu.

## Funkcje

- skanowanie folderu `osu!\\Songs` i odczyt metadanych z plików `.osu`,
- grupowanie difficulty w rozwijane beatmapsety wraz z lokalnym tłem,
- wyszukiwanie po tytule, artyście i mapperze oraz sortowanie,
- dodawanie całych setów lub pojedynczych difficulty, multi-select i obsługa dwukliku,
- ręcznie wpisywany rate od 0.1× do 3.0× oraz dowolny pitch w zakresie -24 do +24 półtonów,
- nadpisywanie pola `Creator` autorem paczki i resetowanie identyfikatorów online,
- pięć motywów kolorystycznych oraz własne półprzezroczyste zdjęcie tła,
- zdjęcie tła rozciągnięte na całe okno z regulowaną przezroczystością i rozmyciem paneli,
- trzecie okno Trainer z kontrolą HP/CS/AR/OD, rate, pitch, skalowaniem statystyk, profilami i skrótami klawiaturowymi,
- opcje Trainera: zmiana pitchu wraz z rate, usuwanie spinnerów, audio wysokiej jakości i czyszczenie nieużywanych plików audio,
- lokalny Player Analyzer: profil BPM/NPS/LN, radar umiejętności, historia skanów, podobne mapy i generator zestawów treningowych,
- wysyłanie wygenerowanego treningu bezpośrednio do Pack Studio,
- lokalne przetwarzanie audio przez FFmpeg,
- generowanie jednego importowalnego pliku `.osz` zawierającego wszystkie mapy dodane do makera,
- bezpieczny eksport do nowego folderu — istniejąca paczka nie jest nadpisywana,
- automatyczne zapisywanie ostatnich folderów, autora, nazwy paczki i ścieżki FFmpeg.

## Wymagania deweloperskie

- Node.js 20+
- Windows 10/11
- FFmpeg jest automatycznie dołączany do wersji portable

## Uruchomienie

```powershell
npm install
npm run desktop:dev
```

## Instalator Windows

```powershell
npm run desktop:build
```

Gotowy plik portable znajdzie się w `release\\osu-Pack-Studio-1.0.0-portable.exe`.

## Jak działa eksport

Wszystkie wybrane beatmapsety i difficulty są łączone w jeden plik `.osz`. Zasoby różnych map otrzymują bezpieczne unikalne nazwy, dlatego audio, tła i storyboardy nie nadpisują się wzajemnie. Gdy rate jest różny od 1.00×, backend skaluje czasy timing pointów, hit objectów, przerw, podglądu i bookmarków. FFmpeg tworzy lokalny wariant audio o zadanym tempie i pitch. Oryginalne źródła nie są modyfikowane.

## Prywatność

Aplikacja nie wykonuje żadnych żądań sieciowych i nie przesyła danych. Metadane oraz ustawienia pozostają na komputerze użytkownika.
