import { ArrowDown, ArrowUp, Image, ListPlus, Pause, Search, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { generateMarathon, loadSettings } from "../api";
import type { TrainingCandidate } from "../logic/playerAnalysis";
import type { BeatmapSet, Difficulty, PackItem } from "../types";

type MapEntry = { kind: "map"; id: string; set: BeatmapSet; difficulty: Difficulty };
type BreakEntry = { kind: "break"; id: string; seconds: number };
type QueueEntry = MapEntry | BreakEntry;
const symbols = ["A", "B", "Γ", "Δ", "E", "Z", "H", "Θ", "I", "K", "Λ", "M", "N", "Ξ", "O", "Π", "P", "Σ", "T", "Y", "Φ", "X", "Ψ", "Ω", "α", "β", "γ", "δ", "ε", "ζ", "η", "θ", "ι", "κ", "λ", "μ", "ν", "ξ", "ο", "π", "ρ", "σ", "τ", "υ", "φ", "χ", "ψ", "ω", "←", "↑", "→", "↓", "↔", "↕", "∞", "•", "†", "‡"];

export function PlayerAnalyzer({ sets, language }: { sets: BeatmapSet[]; onSendToPack: (items: TrainingCandidate[]) => void; language: "en" | "pl" }) {
  const pl = language === "pl";
  const maps = useMemo(() => sets.flatMap(set => set.difficulties.filter(d => d.mode === 3).map(difficulty => ({ set, difficulty }))), [sets]);
  const [query, setQuery] = useState(""); const [selectedId, setSelectedId] = useState(""); const [entries, setEntries] = useState<QueueEntry[]>([]); const [breakSeconds, setBreakSeconds] = useState(5);
  const [title, setTitle] = useState("Marathon"); const [artist, setArtist] = useState("Various Artists"); const [creator, setCreator] = useState(""); const [version, setVersion] = useState("Marathon"); const [symbol, setSymbol] = useState("?"); const [glitch, setGlitch] = useState(0); const [generating, setGenerating] = useState(false); const [status, setStatus] = useState("");
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !maps.length) return;
    restored.current = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem("pack-studio-marathon") || "null");
      if (!saved) return;
      setQuery(saved.query || ""); setBreakSeconds(saved.breakSeconds || 5); setTitle(saved.title || "Marathon"); setArtist(saved.artist || "Various Artists"); setCreator(saved.creator || ""); setVersion(saved.version || "Marathon"); setSymbol(saved.symbol || "?"); setGlitch(saved.glitch || 0);
      const restoredEntries = (saved.entries || []).map((entry: any) => entry.kind === "break" ? { ...entry, id: crypto.randomUUID() } : (() => { const found = maps.find(map => map.difficulty.id === entry.difficultyId); return found ? { kind: "map", id: crypto.randomUUID(), ...found } : null; })()).filter(Boolean);
      setEntries(restoredEntries);
    } catch { /* ignore a corrupt session draft */ }
  }, [maps]);
  useEffect(() => {
    if (!restored.current) return;
    sessionStorage.setItem("pack-studio-marathon", JSON.stringify({ query, breakSeconds, title, artist, creator, version, symbol, glitch, entries: entries.map(entry => entry.kind === "break" ? entry : ({ kind: "map", difficultyId: entry.difficulty.id })) }));
  }, [query, breakSeconds, title, artist, creator, version, symbol, glitch, entries]);
  const filtered = useMemo(() => { const term = query.trim().toLocaleLowerCase(); return term ? maps.filter(({ set, difficulty }) => `${set.artist} ${set.title} ${set.creator} ${difficulty.version}`.toLocaleLowerCase().includes(term)) : maps; }, [maps, query]);
  const selected = maps.find(map => map.difficulty.id === selectedId);
  const mapEntries = entries.filter((entry): entry is MapEntry => entry.kind === "map");
  const totalBreak = entries.reduce((sum, entry) => sum + (entry.kind === "break" ? entry.seconds : 0), 0);
  const addMap = () => { if (!selected || entries.some(entry => entry.kind === "map" && entry.difficulty.id === selected.difficulty.id)) return; setEntries(current => [...current, { kind: "map", id: crypto.randomUUID(), ...selected }]); };
  const addBreak = () => setEntries(current => [...current, { kind: "break", id: crypto.randomUUID(), seconds: breakSeconds }]);
  const remove = (id: string) => setEntries(current => current.filter(entry => entry.id !== id));
  const move = (id: string, offset: number) => setEntries(current => { const index = current.findIndex(entry => entry.id === id), nextIndex = index + offset; if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current; const next = [...current]; [next[index], next[nextIndex]] = [next[nextIndex], next[index]]; return next; });
  const generate = async () => {
    if (!mapEntries.length) return;
    setGenerating(true); setStatus("");
    try {
      const settings = await loadSettings();
      const items: PackItem[] = mapEntries.map(entry => ({ set: entry.set, difficulty: entry.difficulty, rate: 1, pitch: 0, selected: false }));
      const report = await generateMarathon(settings, {
        packName: title.trim() || settings.packName,
        artist: artist.trim() || "Various Artists",
        author: creator.trim() || settings.author,
        version: version.trim() || "Marathon",
        symbol,
        items,
        breaks: entries.filter((entry): entry is BreakEntry => entry.kind === "break").map(entry => entry.seconds),
      });
      setStatus(`${pl ? "Gotowe:" : "Ready:"} ${report.outputPath}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); } finally { setGenerating(false); }
  };
  const previewMaps = mapEntries.slice(0, 4);
  return <main className="dan-creator">
    <section className="dan-hero"><div><span className="eyebrow">DAN CREATOR</span><h1>{pl ? "Kreator maratonu" : "Marathon creator"}</h1><p>{pl ? "Wybierz do czterech map na tło, ustaw znak i wygeneruj .osz." : "Choose up to four maps for the background, set the symbol and generate an .osz."}</p></div></section>
    <section className="dan-search"><Search/><label><span>{pl ? "Znajdź mapę" : "Find a map"}</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder={pl ? "Tytuł, artysta, mapper lub difficulty…" : "Title, artist, mapper or difficulty…"}/></label><label><span>{pl ? "Wybierz difficulty" : "Choose a difficulty"}</span><select value={selectedId} onChange={event => setSelectedId(event.target.value)}><option value="">{maps.length ? (pl ? "Wybierz difficulty…" : "Choose a difficulty…") : (pl ? "Najpierw przeskanuj mapy Mania" : "Scan osu!mania maps first")}</option>{filtered.slice(0, 500).map(({ set, difficulty }) => <option key={difficulty.id} value={difficulty.id}>{set.artist} — {set.title} [{difficulty.version}]</option>)}</select></label></section>
    {query && <section className="dan-search-results">{filtered.slice(0, 12).map(({ set, difficulty }) => <button key={difficulty.id} className={selectedId === difficulty.id ? "active" : ""} onClick={() => setSelectedId(difficulty.id)}><span><strong>{set.title}</strong><small>{set.artist} · {set.creator}</small></span><b>{difficulty.version}</b></button>)}</section>}
    <section className="dan-grid"><section className="dan-card dan-queue"><div className="dan-card-title"><ListPlus/><span>{pl ? "Mapy w maratonie" : "Maps in marathon"}</span></div><div className="dan-actions"><button className="btn primary" onClick={addMap} disabled={!selected || mapEntries.length >= 4}><ListPlus/>{pl ? "Dodaj mapę" : "Add map"}</button><button className="btn secondary" onClick={addBreak}><Pause/>{pl ? "Przerwa" : "Pause"}</button><label className="break-length"><input type="number" min="1" max="600" value={breakSeconds} onChange={event => setBreakSeconds(Math.max(1, Number(event.target.value) || 1))}/><span>s</span></label><button className="btn subtle" onClick={() => setEntries([])} disabled={!entries.length}><Trash2/>{pl ? "Wyczyść" : "Clear all"}</button></div><div className="marathon-list">{entries.length ? entries.map((entry, index) => <article className={`marathon-entry ${entry.kind}`} key={entry.id}>{entry.kind === "map" ? <><span className="entry-number">{index + 1}.</span><span className="entry-copy"><strong>{entry.set.artist} — {entry.set.title}</strong><small>[{entry.difficulty.version}]</small></span></> : <><Pause/><span className="entry-copy"><strong>{pl ? "PRZERWA" : "BREAK"}</strong><small>{entry.seconds}s</small></span></>}<div className="entry-controls"><button onClick={() => move(entry.id, -1)} aria-label="Move up"><ArrowUp/></button><button onClick={() => move(entry.id, 1)} aria-label="Move down"><ArrowDown/></button><button onClick={() => remove(entry.id)} aria-label="Remove"><Trash2/></button></div></article>) : <div className="dan-empty"><ListPlus/><strong>{pl ? "Nie ma jeszcze map" : "No maps yet"}</strong><span>{pl ? "Wyszukaj i dodaj do czterech difficulty." : "Search and add up to four difficulties."}</span></div>}</div><footer><span>{mapEntries.length}/4 {pl ? "mapy" : "maps"}</span><span>{pl ? "Przerwy" : "Breaks"}: {totalBreak}s</span></footer></section>
      <section className="dan-card dan-metadata"><div className="dan-card-title"><Sparkles/><span>{pl ? "Metadane maratonu" : "Marathon metadata"}</span></div><div className="metadata-fields"><TextField label={pl ? "Tytuł" : "Title"} value={title} onChange={setTitle}/><TextField label={pl ? "Artysta" : "Artist"} value={artist} onChange={setArtist}/><TextField label={pl ? "Twórca" : "Creator"} value={creator} onChange={setCreator}/><TextField label={pl ? "Nazwa difficulty" : "Difficulty name"} value={version} onChange={setVersion}/></div><div className="symbol-picker"><span>{pl ? "Wybierz znak dla środka tła" : "Choose the background center symbol"}</span><div>{symbols.map(value => <button className={symbol === value ? "active" : ""} key={value} onClick={() => setSymbol(value)}>{value}</button>)}</div></div><label className="glitch-control"><span>{pl ? "Efekt glitch" : "Glitch effect"}</span><input type="range" min="0" max="100" value={glitch} onChange={event => setGlitch(Number(event.target.value))}/><b>{glitch}%</b></label></section></section>
    <section className={`dan-preview ${glitch ? "has-glitch" : ""}`} style={{ "--glitch": `${glitch / 100}` } as CSSProperties}><div className="dan-preview-title"><Image/><span>{pl ? "Tło maratonu" : "Marathon background"}</span><small>{pl ? "Kolaż pierwszych czterech dodanych map" : "Collage of the first four added maps"}</small></div><div className="marathon-background">{previewMaps.length ? previewMaps.map((entry, index) => <div className="marathon-tile" key={entry.id} style={{ backgroundImage: (entry.difficulty.backgroundPath || entry.set.backgroundPath) ? `url(${convertFileSrc(entry.difficulty.backgroundPath || entry.set.backgroundPath || "")})` : undefined }}><small>{index + 1}</small></div>) : <div className="dan-preview-empty"><Image/><span>{pl ? "Dodaj mapy, aby utworzyć kolaż" : "Add maps to create the collage"}</span></div>}<div className="marathon-symbol">{symbol}</div></div></section>
    <footer className="dan-submit"><div><strong>{title || (pl ? "Maraton bez nazwy" : "Untitled marathon")}</strong><span>{artist} · {version}</span>{status && <em>{status}</em>}</div><button className="btn primary" onClick={generate} disabled={!mapEntries.length || generating}>{generating ? (pl ? "Generowanie…" : "Generating…") : (pl ? "Generuj .osz" : "Generate .osz")}</button></footer>
  </main>;
}
function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label><span>{label}</span><input value={value} onChange={event => onChange(event.target.value)}/></label>; }
