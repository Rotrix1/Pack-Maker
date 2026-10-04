# osu! Pack Studio

osu! Pack Studio is a Tauri + Rust desktop app for creating osu!mania `.osz` packs. It scans a local `Songs` directory, lets you select individual difficulties, change rate and pitch, edit backgrounds and image overlays, and export an importable pack.

## Features

### Pack Studio

- Scan a local osu! `Songs` directory and browse osu!mania beatmapsets or individual difficulties.
- Search by title, artist, mapper, pack name, and difficulty; select individual maps or full beatmapsets.
- Build a pack with per-map rate and pitch settings, plus trainer-map settings.
- Generate an importable `.osz` without modifying the original beatmaps.
- Use the system Downloads folder as the default export location.
- Keep the current selected maps, rates, pitches, and settings between launches.
- Generate local audio previews and transformed audio through FFmpeg.

### Backgrounds

- Edit each selected map's background without changing the source beatmap.
- Apply brightness, contrast, saturation, blur, hue, vignette, grain, sharpen, pixelation, sepia, inversion, and visual presets.
- Add multiple image overlays with independent opacity, scale, position, and drag-to-move support.
- Apply one confirmed effects-and-overlays draft to every background in the current pack.
- Resolve the correct background for each difficulty, including beatmapsets that use multiple backgrounds.

### Dan Creator

- Combine up to four osu!mania difficulties into one marathon / Dan `.osz`.
- Configure title, artist, creator, difficulty name, a central background symbol, breaks, and glitch preview strength.
- Generate a collage background from the selected maps using the same background resolver as the final `.osz`.
- Keep generation running when you switch to another app tab.
- Preserve long-note timing while merging charts; use one BPM based on the highest source BPM and avoid source SV/timing-point data.
- Optionally trim silent intro before each stage, with a 1.5-second fade-in ending at the first note.

### Projects

- Save named manual pack projects and browse them in one place.
- Automatically save a project copy after each `.osz` export.
- Load saved projects with their selected maps, rates, pitches, trainer configuration, and background edits.
- Keep manual saves and autosaves as separate categories.

### Application

- Remember the window size and position.
- Persist settings and project data in the application data directory.
- Bundle FFmpeg on Windows, with configured-path and system-location fallbacks.

## Requirements

- Node.js 20 or newer.
- Rust stable toolchain.
- Platform build prerequisites listed below.

The Windows distribution bundles `ffmpeg.exe`. The app also looks for FFmpeg in the configured path, application directory, `PATH`, WinGet location, and Downloads folder. On Linux and macOS, install FFmpeg through the system package manager when audio or background processing is needed.

## Development

From the repository root:

```sh
npm install
npm run tauri dev
```

## Tests

```sh
npm run build
cd src-tauri
cargo test
```

## Build for Windows

Build Windows releases on Windows with the MSVC Rust toolchain and Visual Studio Build Tools installed.

```powershell
npm install
npm run build
npm run tauri build -- --bundles nsis
```

The NSIS installer is written to:

`src-tauri/target/release/bundle/nsis/`

For an unpackaged executable only:

```powershell
npm run tauri build -- --no-bundle
```

The executable is written to `src-tauri/target/release/osu-pack-studio.exe`.

## Build for Linux

Build Linux releases on Linux. Install the WebKitGTK, GTK, OpenSSL and compiler dependencies first. For Debian/Ubuntu:

```sh
sudo apt update
sudo apt install -y build-essential curl wget file libxdo-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libwebkit2gtk-4.1-dev
```

Then build an AppImage and Debian package:

```sh
npm install
npm run tauri build -- --bundles appimage,deb
```

Artifacts are written under `src-tauri/target/release/bundle/`.

## Build for macOS

Build macOS releases on macOS with Xcode Command Line Tools installed:

```sh
xcode-select --install
npm install
npm run tauri build -- --bundles dmg
```

The DMG is written to `src-tauri/target/release/bundle/dmg/`.

## Notes on platform builds

Tauri packages should normally be built on their target operating system: Windows on Windows, Linux on Linux, and macOS on macOS. Cross-compiling is possible but requires additional platform SDKs and signing setup.

## Creator

Created by [Rotrix](https://osu.ppy.sh/users/31245051).

Contributed by [Pofanek](https://osu.ppy.sh/users/18185878).
