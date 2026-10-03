# osu! Pack Studio

osu! Pack Studio is a Tauri + Rust desktop app for creating osu!mania `.osz` packs. It scans a local `Songs` directory, lets you select individual difficulties, change rate and pitch, edit backgrounds and image overlays, and export an importable pack.

## Features

- Scan local osu! beatmaps and choose full beatmapsets or individual difficulties.
- Keep the current pack, trainer settings, rates, pitches, and projects between launches.
- Create manual project saves and automatic saves after each `.osz` export.
- Edit per-map backgrounds with effects, multiple draggable image overlays, scale, and opacity.
- Apply a saved effects-and-overlays draft to every background in the pack after confirmation.
- Generate audio previews and transformed audio locally with FFmpeg.
- Remember the window size and position.
- Use the system Downloads folder as the default export location.

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
