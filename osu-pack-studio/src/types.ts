export interface Difficulty {
  id: string;
  version: string;
  osuPath: string;
  mode: number;
  stars?: number;
  audioFilename?: string;
  hp?: number;
  cs?: number;
  ar?: number;
  od?: number;
  metrics?: BeatmapMetrics;
}

export interface BeatmapMetrics {
  bpm: number;
  duration: number;
  noteCount: number;
  lnCount: number;
  lnPercentage: number;
  averageNps: number;
  peakNps: number;
  chordPercentage: number;
  jackDensity: number;
  chordjackDensity: number;
  streamDensity: number;
  patternVariability: number;
  keyCount: number;
}

export interface TrainerConfig {
  hp: number;
  cs: number;
  ar: number;
  od: number;
  hrCircleSize: boolean;
  scaleAr: boolean;
  scaleOd: boolean;
  changePitch: boolean;
  noSpinners: boolean;
  highQuality: boolean;
  deleteUnusedMp3s: boolean;
}

export interface BackgroundEffects {
  preset: "none" | "glitch" | "neon" | "mono" | "vintage" | "dream" | "vhs" | "ice" | "inferno" | "pixel";
  brightness: number;
  contrast: number;
  saturation: number;
  blur: number;
  hue: number;
  vignette: number;
  glitch: number;
  grain: number;
  sharpen: number;
  pixelate: number;
  sepia: number;
  invert: boolean;
  overlayOpacity: number;
  overlayScale: number;
  overlayX: number;
  overlayY: number;
}

export interface BeatmapSet {
  id: string;
  folderPath: string;
  folderName: string;
  artist: string;
  title: string;
  creator: string;
  backgroundPath?: string;
  difficulties: Difficulty[];
}

export interface PackItem {
  difficulty: Difficulty;
  set: BeatmapSet;
  rate: number;
  pitch: number;
  selected: boolean;
  trainer?: TrainerConfig;
  customBackgroundPath?: string;
  backgroundEffects?: BackgroundEffects;
  backgroundOverlayPath?: string;
}

export interface Settings {
  language: "en" | "pl";
  songsFolder: string;
  outputFolder: string;
  ffmpegPath: string;
  packName: string;
  author: string;
  theme: "rose" | "violet" | "ocean" | "emerald" | "amber";
  backgroundImage: string;
  backgroundOpacity: number;
}

export interface GenerateReport {
  outputPath: string;
  mapsets: number;
  difficulties: number;
  warnings: string[];
}

export interface ManiaTrackerProfile {
  username?: string;
  avatar?: string;
  country?: string;
  countryCode?: string;
  globalRank?: number;
  countryRank?: number;
  peakRank?: number;
  peakRankDate?: string;
  totalPp?: number;
  pp4k?: number;
  pp7k?: number;
  accuracy?: number;
  playCount?: number;
  playTimeSeconds?: number;
  joinDate?: string;
  keySplit?: Record<string, number>;
  mostUsedMod?: string;
  medianBpm?: number;
  minBpm?: number;
  maxBpm?: number;
  ppRange?: { min?: number; max?: number };
  topPlayCount?: number;
  newestTopPlay?: { title?: string; pp?: number; date?: string };
  oldestTopPlay?: { title?: string; pp?: number; date?: string };
  skills?: Partial<Record<"Speed" | "Stamina" | "Accuracy" | "Jack" | "Chordjack" | "Stream" | "LN" | "Tech", number>>;
  sourceUrl: string;
  importedAt: number;
}
