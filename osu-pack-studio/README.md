# osu! Pack Studio

Desktopowa aplikacja Tauri + Rust do tworzenia paczek `.osz` dla osu!mania. Skanuje lokalny folder `Songs`, pozwala wybrać difficulty, zmienić rate/pitch, edytować tła i nakładki, a następnie tworzy importowalną paczkę.

## Funkcje

- projekty ręczne i automatyczne zapisy po wygenerowaniu `.osz`;
- zachowanie bieżącej paczki, wybranych map i ustawień między uruchomieniami;
- edycja tła z efektami oraz wieloma, przeciąganymi nakładkami;
- lokalny podgląd audio i eksport przez FFmpeg;
- domyślny folder eksportu: systemowy folder Pobrane użytkownika;
- zapamiętywanie rozmiaru i pozycji okna przez Tauri.

## Wymagania

- Node.js 20+;
- Rust (stable) z toolchainem MSVC na Windows;
- FFmpeg — dołączony do wersji Windows jako zasób aplikacji. Dodatkowo aplikacja wykrywa go w `PATH`, WinGet i Pobranych; ręczne wskazanie pliku jest tylko opcjonalnym fallbackiem.

## Development

```powershell
npm install
npm run tauri dev
```

## Testy i build

```powershell
npm run build
Set-Location src-tauri
cargo test
Set-Location ..
npm run tauri build -- --no-bundle
```

Binarka bez bundla powstaje w `src-tauri/target/release/osu-pack-studio.exe`.

## Twórca

Created by [Rotrix](https://osu.ppy.sh/users/31245051).
