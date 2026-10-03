import type { BeatmapSet, Difficulty, ManiaTrackerProfile } from "../types";

export const skillNames = ["Speed", "Stamina", "Accuracy", "Jack", "Chordjack", "Stream", "LN", "Tech"] as const;
export type SkillName = typeof skillNames[number];
export type SkillScores = Record<SkillName, number>;
export type TrainingCandidate = { set: BeatmapSet; difficulty: Difficulty; score: number; rate: number; tier: "Warmup" | "Practice" | "Challenge" };
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function analyzeLibrary(sets: BeatmapSet[]) {
  const difficulties = sets.flatMap(set => set.difficulties.map(difficulty => ({ set, difficulty }))).filter(entry => entry.difficulty.metrics);
  const avg = (fn: (d: Difficulty) => number) => difficulties.length ? difficulties.reduce((sum, entry) => sum + fn(entry.difficulty), 0) / difficulties.length : 0;
  const skills: SkillScores = {
    Speed: clamp(avg(d => (d.metrics?.peakNps || 0) * 8)),
    Stamina: clamp(avg(d => (d.metrics?.averageNps || 0) * Math.min(12, (d.metrics?.duration || 0) / 30))),
    Accuracy: clamp(100 - avg(d => (d.metrics?.patternVariability || 0) * 55)),
    Jack: clamp(avg(d => (d.metrics?.jackDensity || 0) * 280)),
    Chordjack: clamp(avg(d => (d.metrics?.chordjackDensity || 0) * 240)),
    Stream: clamp(avg(d => (d.metrics?.streamDensity || 0) * 150)),
    LN: clamp(avg(d => (d.metrics?.lnPercentage || 0) * 180)),
    Tech: clamp(avg(d => (d.metrics?.patternVariability || 0) * 130)),
  };
  const bpms = difficulties.map(x => x.difficulty.metrics?.bpm || 0).filter(Boolean).sort((a,b) => a-b);
  const histogram = [0,0,0,0,0,0,0]; for (const bpm of bpms) histogram[bpm < 150 ? 0 : bpm < 200 ? 1 : bpm < 250 ? 2 : bpm < 300 ? 3 : bpm < 350 ? 4 : bpm < 400 ? 5 : 6]++;
  const medianBpm = bpms.length ? bpms[Math.floor(bpms.length / 2)] : 0;
  const byKeys = (keys: number) => difficulties.filter(x => x.difficulty.metrics?.keyCount === keys);
  const estimatedPp = (entries: typeof difficulties) => Math.round(entries.reduce((sum, x) => sum + (x.difficulty.metrics?.noteCount || 0) * (x.difficulty.metrics?.averageNps || 0) / 180, 0));
  const ordered = Object.entries(skills).sort((a,b) => b[1]-a[1]) as [SkillName,number][];
  return { difficulties, skills, histogram, medianBpm, minBpm: bpms[0] || 0, maxBpm: bpms.at(-1) || 0, comfortRange: bpms.length ? [bpms[Math.floor(bpms.length*.25)], bpms[Math.floor(bpms.length*.75)]] : [0,0], estimatedPp: estimatedPp(difficulties), pp4k: estimatedPp(byKeys(4)), pp7k: estimatedPp(byKeys(7)), commonKeys: mostCommon(difficulties.map(x => x.difficulty.metrics?.keyCount || 0)), strong: ordered.slice(0,3), average: ordered.slice(3,5), needsPractice: ordered.slice(-3).reverse() };
}

export type PlayerAnalysis = ReturnType<typeof analyzeLibrary> & {
  username: string;
  source: string;
  profile?: ManiaTrackerProfile;
};

export function mapManiaTrackerToPlayerAnalysis(profile: ManiaTrackerProfile, sets: BeatmapSet[]): PlayerAnalysis {
  const local = analyzeLibrary(sets);
  const skills = { ...local.skills };
  for (const name of skillNames) {
    const value = profile.skills?.[name];
    if (typeof value === "number" && Number.isFinite(value)) skills[name] = clamp(value);
  }
  const ordered = Object.entries(skills).sort((a,b) => b[1] - a[1]) as [SkillName, number][];
  const dominantKey = Object.entries(profile.keySplit || {}).sort((a,b) => b[1] - a[1])[0]?.[0];
  return {
    ...local,
    username: profile.username || "Unknown player",
    source: "Mania Tracker",
    profile,
    skills,
    estimatedPp: profile.totalPp ?? local.estimatedPp,
    pp4k: profile.pp4k ?? local.pp4k,
    pp7k: profile.pp7k ?? local.pp7k,
    medianBpm: profile.medianBpm ?? local.medianBpm,
    minBpm: profile.minBpm ?? local.minBpm,
    maxBpm: profile.maxBpm ?? local.maxBpm,
    comfortRange: profile.minBpm !== undefined && profile.maxBpm !== undefined ? [profile.minBpm, profile.maxBpm] : local.comfortRange,
    commonKeys: dominantKey ? Number(dominantKey.replace(/\D/g, "")) || local.commonKeys : local.commonKeys,
    strong: ordered.slice(0, 3),
    average: ordered.slice(3, 5),
    needsPractice: ordered.slice(-3).reverse(),
  };
}

function mostCommon(values: number[]) { const counts = new Map<number,number>(); values.forEach(v => v && counts.set(v,(counts.get(v)||0)+1)); return [...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0] || 0; }
function skillValue(skill: SkillName, d: Difficulty) { const m=d.metrics; if(!m)return 0; return { Speed:m.peakNps/14, Stamina:m.averageNps*Math.min(1,m.duration/150)/9, Accuracy:1-m.patternVariability*.5, Jack:m.jackDensity*3, Chordjack:m.chordjackDensity*3, Stream:m.streamDensity*1.5, LN:m.lnPercentage*2, Tech:m.patternVariability*1.3 }[skill]; }

export function generateTraining(sets: BeatmapSet[], options: { skill: SkillName; keys: number; bpm: number; count: number; minRate: number; maxRate: number }): TrainingCandidate[] {
  const candidates = sets.flatMap(set => set.difficulties.map(difficulty => ({ set,difficulty }))).filter(x => x.difficulty.metrics && (!options.keys || x.difficulty.metrics.keyCount===options.keys)).map(x => ({ ...x, score: skillValue(options.skill,x.difficulty) - (options.bpm ? Math.abs((x.difficulty.metrics?.bpm||0)-options.bpm)/400 : 0) })).sort((a,b)=>b.score-a.score).slice(0,options.count);
  return candidates.map((candidate,index) => { const progress=candidates.length>1?index/(candidates.length-1):.5; const rate=Math.round((options.minRate+(options.maxRate-options.minRate)*progress)*100)/100; return {...candidate,rate,tier:progress<.3?"Warmup":progress<.78?"Practice":"Challenge"}; });
}

export function similarMaps(target: Difficulty, sets: BeatmapSet[], limit=8) {
  const a=target.metrics; if(!a)return [];
  return sets.flatMap(set=>set.difficulties.map(difficulty=>({set,difficulty}))).filter(x=>x.difficulty.id!==target.id&&x.difficulty.metrics?.keyCount===a.keyCount).map(x=>{const b=x.difficulty.metrics!; const distance=Math.abs(a.bpm-b.bpm)/200+Math.abs(a.averageNps-b.averageNps)/10+Math.abs(a.lnPercentage-b.lnPercentage)+Math.abs(a.jackDensity-b.jackDensity)+Math.abs(a.chordPercentage-b.chordPercentage)+Math.abs(a.patternVariability-b.patternVariability); return {...x,similarity:Math.max(0,Math.round((1-distance/6)*100))};}).sort((x,y)=>y.similarity-x.similarity).slice(0,limit);
}
