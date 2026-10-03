import type { ManiaTrackerProfile } from "../types";
import { fetchManiaTrackerPage } from "../api";
import { ManiaTrackerParser } from "./maniaTrackerParser";

const CACHE_KEY = "mania-tracker:last-profile";

export class ManiaTrackerError extends Error {
  constructor(public readonly code: "INVALID_URL" | "NOT_FOUND" | "NETWORK" | "PARSE", message: string) { super(message); }
}

export class ManiaTrackerService {
  constructor(private readonly parser = new ManiaTrackerParser()) {}

  static validateUrl(input: string): { valid: boolean; normalizedUrl?: string; username?: string } {
    try {
      const url = new URL(input.trim());
      if (url.protocol !== "https:" || !["mania-tracker.com", "www.mania-tracker.com"].includes(url.hostname.toLowerCase())) return { valid: false };
      const parts = url.pathname.match(/^\/player\/([^/]+)(?:\/skills)?\/?$/i);
      if (!parts) return { valid: false };
      const username = decodeURIComponent(parts[1]).trim();
      if (!username || username.length > 64) return { valid: false };
      return { valid: true, username, normalizedUrl: `https://mania-tracker.com/player/${encodeURIComponent(username)}/skills` };
    } catch { return { valid: false }; }
  }

  async importProfile(input: string): Promise<ManiaTrackerProfile> {
    const validation = ManiaTrackerService.validateUrl(input);
    if (!validation.valid || !validation.normalizedUrl) throw new ManiaTrackerError("INVALID_URL", "Nieprawidłowy URL Mania Tracker. Użyj /player/{username} lub /player/{username}/skills.");
    let response;
    try { response = await fetchManiaTrackerPage(validation.normalizedUrl); }
    catch (error) { throw new ManiaTrackerError("NETWORK", error instanceof Error ? error.message : "Nie udało się pobrać profilu Mania Tracker."); }
    if (response.status === 404) throw new ManiaTrackerError("NOT_FOUND", "Profil Mania Tracker nie istnieje.");
    if (response.status < 200 || response.status >= 300) throw new ManiaTrackerError("NETWORK", `Mania Tracker zwrócił błąd HTTP ${response.status}.`);
    const profile = this.parser.parse(response.html, response.url, validation.username);
    const hasProfileData = [profile.avatar, profile.countryCode, profile.globalRank, profile.totalPp, profile.accuracy, profile.playCount, profile.joinDate, profile.medianBpm].some(value => value !== undefined);
    if (!hasProfileData) throw new ManiaTrackerError("NOT_FOUND", "Profil Mania Tracker nie istnieje albo nie zawiera jeszcze publicznych danych.");
    if (!profile.username) throw new ManiaTrackerError("PARSE", "Profil został pobrany, ale nie udało się odczytać jego nazwy.");
    localStorage.setItem(CACHE_KEY, JSON.stringify(profile));
    return profile;
  }

  loadCachedProfile(): ManiaTrackerProfile | null {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch { return null; }
  }
}
