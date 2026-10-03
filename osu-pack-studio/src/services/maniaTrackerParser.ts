import type { ManiaTrackerProfile } from "../types";

const number = (value?: string) => {
  if (!value) return undefined;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
};
const match = (html: string, expression: RegExp) => expression.exec(html)?.[1];
const text = (value?: string) => value?.replace(/\\u0026/g, "&").replace(/&amp;/g, "&").replace(/&#x27;/g, "'");

export class ManiaTrackerParser {
  parse(html: string, sourceUrl: string, requestedUsername?: string): ManiaTrackerProfile {
    const username = text(match(html, /\busername:"([^"]+)"/i)) || text(match(html, /<title>([^<]+?)(?: Skills)? - Mania Tracker<\/title>/i)) || requestedUsername;
    const country = text(match(html, /\bcountry:\$R\[\d+\]=\{code:"[^"]+",name:"([^"]+)"/i));
    const profile: ManiaTrackerProfile = {
      username,
      avatar: text(match(html, /\bavatar_url:"([^"]+)"/i)),
      country,
      countryCode: match(html, /\bcountry_code:"([A-Z]{2})"/i),
      globalRank: number(match(html, /\bglobal_rank:(\d+)/i)),
      countryRank: number(match(html, /\bcountry_rank:(\d+)/i)),
      peakRank: number(match(html, /\brank_highest:\$R\[\d+\]=\{rank:(\d+)/i)),
      peakRankDate: match(html, /\brank_highest:\$R\[\d+\]=\{rank:\d+,updated_at:"([^"]+)"/i),
      totalPp: number(match(html, /\bpp:([\d.]+),pp_exp:/i)),
      pp4k: number(match(html, /variant:"4k"[^}]{0,240}?\bpp:([\d.]+)/i)),
      pp7k: number(match(html, /variant:"7k"[^}]{0,240}?\bpp:([\d.]+)/i)),
      accuracy: number(match(html, /\bhit_accuracy:([\d.]+)/i)),
      playCount: number(match(html, /\bplay_count:(\d+)/i)),
      playTimeSeconds: number(match(html, /\bplay_time:(\d+)/i)),
      joinDate: match(html, /\bjoin_date:"([^"]+)"/i),
      medianBpm: number(match(html, /\bmedianBpm:([\d.]+)/i)),
      minBpm: number(match(html, /\bbpmRange:\$R\[\d+\]=\{min:([\d.]+)/i)),
      maxBpm: number(match(html, /\bbpmRange:\$R\[\d+\]=\{min:[\d.]+,max:([\d.]+)/i)),
      ppRange: {
        max: number(match(html, /\bppRange:\$R\[\d+\]=\{top:([\d.]+)/i)),
        min: number(match(html, /\bppRange:\$R\[\d+\]=\{top:[\d.]+,bottom:([\d.]+)/i)),
      },
      topPlayCount: number(match(html, /\bppDistribution:\$R\[\d+\]=\[\$R\[\d+\]=\{min:[^}]+?total:(\d+)/i)),
      newestTopPlay: this.parseTopPlay(html, "newestTopPlay"),
      oldestTopPlay: this.parseTopPlay(html, "oldestTopPlay"),
      sourceUrl,
      importedAt: Date.now(),
    };
    profile.keySplit = this.parseKeySplit(html);
    profile.mostUsedMod = this.parseMostUsedMod(html);
    profile.skills = this.parseSkills(html);
    if (profile.ppRange && profile.ppRange.min === undefined && profile.ppRange.max === undefined) delete profile.ppRange;
    return profile;
  }

  private parseKeySplit(html: string) {
    const section = match(html, /\bkeymodePlayCounts:\$R\[\d+\]=\[([\s\S]{0,800}?)\],fetchedAt:/i);
    if (!section) return undefined;
    const result: Record<string, number> = {};
    for (const entry of section.matchAll(/keyCount:(\d+),count:(\d+)/gi)) result[`${entry[1]}K`] = Number(entry[2]);
    return Object.keys(result).length ? result : undefined;
  }

  private parseMostUsedMod(html: string) {
    const end = html.search(/\bmedianBpm:/i);
    const start = end > 0 ? Math.max(0, end - 5000) : 0;
    const candidates = [...html.slice(start, end > 0 ? end : undefined).matchAll(/\{label:"([^"]+)",count:(\d+),total:\d+\}/g)]
      .map(entry => ({ label: entry[1], count: Number(entry[2]) }))
      .filter(entry => /^[A-Z|]+$/.test(entry.label));
    return candidates.sort((a,b) => b.count - a.count)[0]?.label;
  }

  private parseSkills(html: string) {
    const block = match(html, /\bcachedManiaCardSkills:\$R\[\d+\]=\{([^}]+)\}/i);
    if (!block) return undefined;
    const score = (key: string) => {
      const raw = number(match(block, new RegExp(`${key}:([\\d.]+)`, "i")));
      return raw === undefined ? undefined : Math.max(0, Math.min(100, Math.round(raw / 10)));
    };
    return { Speed: score("speed"), Stamina: score("stamina"), Accuracy: score("accuracy"), Tech: score("versatility"), Jack: score("fingerControl") };
  }

  private parseTopPlay(html: string, key: "newestTopPlay" | "oldestTopPlay") {
    const block = match(html, new RegExp(`\\b${key}:\\$R\\[\\d+\\]=\\{([^}]+)\\}`, "i"));
    if (!block) return undefined;
    return { title: text(match(block, /title:"([^"]+)"/i)), pp: number(match(block, /\bpp:([\d.]+)/i)), date: match(block, /\bdate:"([^"]+)"/i) };
  }
}
