import type { BeatmapSet, GenerateReport, Settings } from "./types";

declare global {
  interface Window {
    packStudio?: {
      loadSettings(): Promise<Settings>;
      saveSettings(settings: Settings): Promise<void>;
      pickDirectory(title: string): Promise<string | null>;
      pickFfmpeg(): Promise<string | null>;
      pickBackground(): Promise<string | null>;
      scanFolder(folder: string): Promise<BeatmapSet[]>;
      generatePack(request: unknown): Promise<GenerateReport>;
      estimatePackSize(items: unknown[]): Promise<number>;
      createAudioPreview(item: unknown): Promise<string>;
      fetchManiaTrackerPage(url: string): Promise<{ status: number; url: string; html: string }>;
    };
  }
}
export {};
