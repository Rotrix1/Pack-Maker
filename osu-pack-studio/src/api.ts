import { invoke } from "@tauri-apps/api/core";
import type { BeatmapSet, GenerateReport, PackItem, Settings } from "./types";

const isTauri = () => "__TAURI_INTERNALS__" in window;
const isElectron = () => !!window.packStudio;

export async function loadSettings(): Promise<Settings> {
  if (isElectron()) return window.packStudio!.loadSettings();
  if (!isTauri()) {
    const raw = localStorage.getItem("osu-pack-studio-settings");
    return raw ? JSON.parse(raw) : { language:"en", songsFolder: "", outputFolder: "", ffmpegPath: "", packName: "My pack", author: "", theme: "rose", backgroundImage: "", backgroundOpacity: 0.16 };
  }
  return invoke("load_settings");
}

export async function saveSettings(settings: Settings) {
  if (isElectron()) return window.packStudio!.saveSettings(settings);
  if (!isTauri()) {
    localStorage.setItem("osu-pack-studio-settings", JSON.stringify(settings));
    return;
  }
  await invoke("save_settings", { settings });
}

export async function scanFolder(path: string): Promise<BeatmapSet[]> {
  if (isElectron()) return window.packStudio!.scanFolder(path);
  if (!isTauri()) throw new Error("Skanowanie folderów jest dostępne po uruchomieniu aplikacji przez Tauri.");
  return invoke("scan_songs_folder", { path });
}

export async function generatePack(settings: Settings, items: PackItem[]): Promise<GenerateReport> {
  const request = {
      packName: settings.packName,
      author: settings.author,
      outputFolder: settings.outputFolder,
      ffmpegPath: settings.ffmpegPath || null,
      items: items.map(({ difficulty, set, rate, pitch, trainer, customBackgroundPath, backgroundEffects, backgroundOverlayPath }) => ({
        setId: set.id,
        folderPath: set.folderPath,
        artist: set.artist,
        title: set.title,
        creator: set.creator,
        osuPath: difficulty.osuPath,
        difficulty: difficulty.version,
        rate,
        pitch,
        trainer,
        customBackgroundPath,
        backgroundPath: set.backgroundPath,
        backgroundEffects,
        backgroundOverlayPath,
      })),
    };
  if (isElectron()) return window.packStudio!.generatePack(request);
  if (!isTauri()) throw new Error("Generowanie paczek jest dostępne w aplikacji desktopowej.");
  return invoke("generate_pack", { request });
}

export async function estimatePackSize(items: PackItem[]): Promise<number> {
  const payload = items.map(item => ({ setId: item.set.id, folderPath: item.set.folderPath, osuPath: item.difficulty.osuPath, customBackgroundPath: item.customBackgroundPath || null, backgroundOverlayPath:item.backgroundOverlayPath||null }));
  if (isElectron()) return window.packStudio!.estimatePackSize(payload);
  return 0;
}

export async function createAudioPreview(item: PackItem): Promise<string> {
  if (!isElectron()) throw new Error("Podgląd audio jest dostępny w aplikacji desktopowej.");
  return window.packStudio!.createAudioPreview({ folderPath:item.set.folderPath, osuPath:item.difficulty.osuPath, rate:item.rate, pitch:item.pitch, trainer:item.trainer });
}

export async function pickDirectory(title: string): Promise<string | null> {
  if (isElectron()) return window.packStudio!.pickDirectory(title);
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const value = await open({ directory: true, multiple: false, title });
    return typeof value === "string" ? value : null;
  }
  return null;
}

export async function pickFfmpeg(): Promise<string | null> {
  if (isElectron()) return window.packStudio!.pickFfmpeg();
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const value = await open({ multiple: false, filters: [{ name: "FFmpeg", extensions: ["exe"] }] });
    return typeof value === "string" ? value : null;
  }
  return null;
}

export async function pickBackground(): Promise<string | null> {
  if (isElectron()) return window.packStudio!.pickBackground();
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const value = await open({ multiple: false, filters: [{ name: "Obrazy", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }] });
    return typeof value === "string" ? value : null;
  }
  return null;
}

export async function fetchManiaTrackerPage(url: string): Promise<{ status: number; url: string; html: string }> {
  if (isElectron()) return window.packStudio!.fetchManiaTrackerPage(url);
  if (!isTauri()) {
    const response = await fetch(url, { headers: { accept: "text/html" } });
    return { status: response.status, url: response.url, html: response.status === 404 ? "" : await response.text() };
  }
  throw new Error("Import Mania Tracker jest dostępny w wersji desktopowej Electron.");
}
