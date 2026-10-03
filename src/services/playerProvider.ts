import type { BeatmapSet } from "../types";
import { analyzeLibrary, mapManiaTrackerToPlayerAnalysis, type PlayerAnalysis } from "../logic/playerAnalysis";
import { ManiaTrackerService } from "./maniaTrackerService";

export interface PlayerSnapshot { username: string; capturedAt: number; estimatedPp: number; maps: number; medianBpm: number; }
export interface PlayerDataProvider {
  readonly id: string;
  supports(input: string): boolean;
  analyze(input: string, sets: BeatmapSet[]): Promise<PlayerAnalysis>;
}

export class LocalLibraryPlayerProvider implements PlayerDataProvider {
  readonly id = "local-library";
  supports(input: string) { return !/^https?:\/\//i.test(input); }
  async analyze(username: string, sets: BeatmapSet[]): Promise<PlayerAnalysis> { return { username, source: "Local library heuristic", ...analyzeLibrary(sets) }; }
}

export class ManiaTrackerPlayerProvider implements PlayerDataProvider {
  readonly id = "mania-tracker";
  constructor(private readonly service = new ManiaTrackerService()) {}
  supports(input: string) { return ManiaTrackerService.validateUrl(input).valid; }
  async analyze(url: string, sets: BeatmapSet[]): Promise<PlayerAnalysis> {
    return mapManiaTrackerToPlayerAnalysis(await this.service.importProfile(url), sets);
  }
}

export function saveSnapshot(snapshot: PlayerSnapshot) { const key=`player-history:${snapshot.username.toLowerCase()}`; const previous:PlayerSnapshot[]=JSON.parse(localStorage.getItem(key)||"[]"); previous.push(snapshot); localStorage.setItem(key,JSON.stringify(previous.slice(-365))); }
export function loadSnapshots(username: string): PlayerSnapshot[] { try{return JSON.parse(localStorage.getItem(`player-history:${username.toLowerCase()}`)||"[]");}catch{return [];} }
