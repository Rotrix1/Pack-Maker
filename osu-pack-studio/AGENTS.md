# Project guide

`osu-pack-studio` is a Windows desktop application built with Tauri v2, React, TypeScript and Rust.

## Structure

- `src/` — React user interface and Tauri command calls.
- `src-tauri/src/` — Rust commands for settings, scanning, projects and `.osz` generation.
- `src-tauri/tauri.conf.json` — desktop window and Tauri configuration.

## Important behaviour

- Do not modify original osu! beatmap files. Generation always writes a new `.osz`.
- FFmpeg is bundled at `src-tauri/resources/ffmpeg.exe`; honor an optional configured executable first, then resolve the packaged app resource before checking PATH, WinGet and Downloads. Hide spawned Windows processes.
- The global Background Editor is draft-only until its confirmation dialog saves effects and image layers to every map.
- Persist user settings through `settings.rs`; project saves live in the Tauri app-data folder.
- Preserve the data contract in `src/types.ts` and its Rust serde equivalents when adding fields.

## Validation

From the project root run `npm run build`. From `src-tauri` run `cargo test`. For a release executable run `npm run tauri build -- --no-bundle`.
