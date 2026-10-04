import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Disc3, Image, ListPlus, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { generateMarathon, loadSettings, resolveMarathonBackgrounds } from "../api";
import type { TrainingCandidate } from "../logic/playerAnalysis";
import type { BeatmapSet, Difficulty, PackItem } from "../types";

type MapEntry = { id: string; set: BeatmapSet; difficulty: Difficulty };
type LibraryMap = { set: BeatmapSet; difficulty: Difficulty };

const symbols = ["A", "B", "Γ", "Δ", "E", "Z", "H", "Θ", "I", "K", "Λ", "M", "N", "Ξ", "O", "Π", "P", "Σ", "T", "Y", "Φ", "X", "Ψ", "Ω", "α", "β", "γ", "δ", "ε", "ζ", "η", "θ", "ι", "κ", "λ", "μ", "ν", "ξ", "ο", "π", "ρ", "σ", "τ", "υ", "φ", "χ", "ψ", "ω", "←", "↑", "→", "↓", "↔", "↕", "∞", "•", "†", "‡"];

export function PlayerAnalyzer({ sets, language, onSendToPack }: { sets: BeatmapSet[]; onSendToPack: (items: TrainingCandidate[]) => void; language: "en" | "pl" }) {
  // Retained for the existing App contract; Dan currently has its own map queue.
  void onSendToPack;
  const pl = language === "pl";
  const maps = useMemo<LibraryMap[]>(() => sets.flatMap(set => set.difficulties.filter(difficulty => difficulty.mode === 3).map(difficulty => ({ set, difficulty }))), [sets]);
  const [entries, setEntries] = useState<MapEntry[]>([]);
  const [breakSeconds, setBreakSeconds] = useState(5);
  const [title, setTitle] = useState("Marathon");
  const [artist, setArtist] = useState("Various Artists");
  const [creator, setCreator] = useState("");
  const [version, setVersion] = useState("Marathon");
  const [symbol, setSymbol] = useState("?");
  const [glitch, setGlitch] = useState(0);
  const [trimSilentIntros, setTrimSilentIntros] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState("");
  const [resolvedBackgrounds, setResolvedBackgrounds] = useState<Record<string, string | null>>({});
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current || !maps.length) return;
    restored.current = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem("pack-studio-marathon") || "null");
      if (!saved) return;
      setBreakSeconds(typeof saved.breakSeconds === "number" ? saved.breakSeconds : 5);
      setTitle(saved.title || "Marathon");
      setArtist(saved.artist || "Various Artists");
      setCreator(saved.creator || "");
      setVersion(saved.version || "Marathon");
      setSymbol(saved.symbol || "?");
      setGlitch(saved.glitch || 0);
      setTrimSilentIntros(saved.trimSilentIntros !== false);
      // Old drafts can contain manual break entries. Breaks are now global, so
      // deliberately restore only map entries.
      const restoredEntries = (saved.entries || []).flatMap((entry: { difficultyId?: string; kind?: string }) => {
        if (entry.kind === "break") return [];
        const found = maps.find(map => map.difficulty.id === entry.difficultyId);
        return found ? [{ id: crypto.randomUUID(), ...found }] : [];
      });
      setEntries(restoredEntries);
    } catch { /* A corrupt local draft must not prevent use of Dan Creator. */ }
  }, [maps]);

  useEffect(() => {
    if (!restored.current) return;
    sessionStorage.setItem("pack-studio-marathon", JSON.stringify({
      breakSeconds, title, artist, creator, version, symbol, glitch, trimSilentIntros,
      entries: entries.map(entry => ({ difficultyId: entry.difficulty.id })),
    }));
  }, [breakSeconds, title, artist, creator, version, symbol, glitch, trimSilentIntros, entries]);

  // Queue entries keep their placement/order. Replace their data with the live
  // library version before previewing or generating so stale cache values cannot
  // select a background from a different difficulty.
  const previewMaps = useMemo(() => entries.slice(0, 4).map(entry => maps.find(map => map.difficulty.id === entry.difficulty.id) || entry), [entries, maps]);
  const previewKey = previewMaps.map(entry => `${entry.difficulty.id}:${entry.difficulty.osuPath}:${entry.difficulty.backgroundPath || entry.set.backgroundPath || ""}`).join("|");
  useEffect(() => {
    let active = true;
    const items: PackItem[] = previewMaps.map(entry => ({ set: entry.set, difficulty: entry.difficulty, rate: 1, pitch: 0, selected: false }));
    if (!items.length) { setResolvedBackgrounds({}); return; }
    void resolveMarathonBackgrounds(items).then(paths => {
      if (!active) return;
      setResolvedBackgrounds(Object.fromEntries(items.map((item, index) => [item.difficulty.id, paths[index] || null])));
    }).catch(() => { if (active) setResolvedBackgrounds({}); });
    return () => { active = false; };
  }, [previewKey]);

  const totalBreak = Math.max(0, entries.length - 1) * breakSeconds;
  const addMap = (candidate: LibraryMap) => {
    if (entries.length >= 4 || entries.some(entry => entry.difficulty.id === candidate.difficulty.id)) return;
    setEntries(current => [...current, { id: crypto.randomUUID(), ...candidate }]);
  };
  const remove = (id: string) => setEntries(current => current.filter(entry => entry.id !== id));
  const move = (id: string, offset: number) => setEntries(current => {
    const index = current.findIndex(entry => entry.id === id);
    const nextIndex = index + offset;
    if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
    const next = [...current];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    return next;
  });
  const generate = async () => {
    if (!entries.length) return;
    setGenerating(true);
    setStatus("");
    try {
      const settings = await loadSettings();
      const liveEntries = entries.map(entry => maps.find(map => map.difficulty.id === entry.difficulty.id) || entry);
      const items: PackItem[] = liveEntries.map(entry => ({ set: entry.set, difficulty: entry.difficulty, rate: 1, pitch: 0, selected: false }));
      const report = await generateMarathon(settings, {
        packName: title.trim() || settings.packName,
        artist: artist.trim() || "Various Artists",
        author: creator.trim() || settings.author,
        version: version.trim() || "Marathon",
        symbol,
        items,
        breaks: Array(Math.max(0, items.length - 1)).fill(breakSeconds),
        trimSilentIntros,
      });
      setStatus(`${pl ? "Gotowe:" : "Ready:"} ${report.outputPath}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(false);
    }
  };

  return <main className="dan-creator">
    <div className="dan-layout">
      <DanLibrary sets={sets} language={language} addedIds={new Set(entries.map(entry => entry.difficulty.id))} full={entries.length >= 4} onAdd={addMap}/>
      <div className="dan-workspace">
        <section className="dan-hero"><div><span className="eyebrow">DAN CREATOR</span><h1>{pl ? "Kreator maratonu" : "Marathon creator"}</h1><p>{pl ? "Wybierz do czterech difficulty z biblioteki, ustaw znak i wygeneruj .osz." : "Pick up to four difficulties from the library, set the symbol and generate an .osz."}</p></div></section>
        <section className="dan-grid">
          <section className="dan-card dan-queue"><div className="dan-card-title"><ListPlus/><span>{pl ? "Mapy w maratonie" : "Maps in marathon"}</span></div><div className="dan-actions"><label className="break-length" title={pl ? "Przerwa po każdej mapie" : "Break after every map"}><span>{pl ? "Przerwa" : "Break"}</span><input type="number" min="0" max="600" value={breakSeconds} onChange={event => setBreakSeconds(Math.max(0, Number(event.target.value) || 0))}/><b>s</b></label><button className="btn subtle" onClick={() => setEntries([])} disabled={!entries.length}><Trash2/>{pl ? "Wyczyść" : "Clear all"}</button></div><div className="marathon-list">{entries.length ? entries.map((entry, index) => <article className="marathon-entry" key={entry.id}><span className="entry-number">{index + 1}.</span><span className="entry-copy"><strong>{entry.set.artist} — {entry.set.title}</strong><small>[{entry.difficulty.version}]</small></span><div className="entry-controls"><button onClick={() => move(entry.id, -1)} aria-label="Move up"><ArrowUp/></button><button onClick={() => move(entry.id, 1)} aria-label="Move down"><ArrowDown/></button><button onClick={() => remove(entry.id)} aria-label="Remove"><Trash2/></button></div></article>) : <div className="dan-empty"><ListPlus/><strong>{pl ? "Nie ma jeszcze map" : "No maps yet"}</strong><span>{pl ? "Dodaj do czterech difficulty z panelu po prawej." : "Add up to four difficulties from the panel on the right."}</span></div>}</div><footer><span>{entries.length}/4 {pl ? "mapy" : "maps"}</span><span>{pl ? "Przerwy" : "Breaks"}: {totalBreak}s</span></footer></section>
          <section className="dan-card dan-metadata"><div className="dan-card-title"><Sparkles/><span>{pl ? "Metadane maratonu" : "Marathon metadata"}</span></div><div className="metadata-fields"><TextField label={pl ? "Tytuł" : "Title"} value={title} onChange={setTitle}/><TextField label={pl ? "Artysta" : "Artist"} value={artist} onChange={setArtist}/><TextField label={pl ? "Twórca" : "Creator"} value={creator} onChange={setCreator}/><TextField label={pl ? "Nazwa difficulty" : "Difficulty name"} value={version} onChange={setVersion}/></div><label className="check-row"><input type="checkbox" checked={trimSilentIntros} onChange={event => setTrimSilentIntros(event.target.checked)}/><span>{pl ? "Wycinaj ciche intro przed pierwszą nutą (fade-in 1,5 s)" : "Trim silent intros before the first note (1.5s fade-in)"}</span></label><div className="symbol-picker"><span>{pl ? "Wybierz znak dla środka tła" : "Choose the background center symbol"}</span><div>{symbols.map(value => <button className={symbol === value ? "active" : ""} key={value} onClick={() => setSymbol(value)}>{value}</button>)}</div></div><label className="glitch-control"><span>{pl ? "Efekt glitch" : "Glitch effect"}</span><input type="range" min="0" max="100" value={glitch} onChange={event => setGlitch(Number(event.target.value))}/><b>{glitch}%</b></label></section>
        </section>
        <section className={`dan-preview ${glitch ? "has-glitch" : ""}`} style={{ "--glitch": `${glitch / 100}` } as CSSProperties}><div className="dan-preview-title"><Image/><span>{pl ? "Tło maratonu" : "Marathon background"}</span><small>{pl ? "Kolaż pierwszych czterech dodanych map" : "Collage of the first four added maps"}</small></div><div className="marathon-background">{previewMaps.length ? previewMaps.map((entry, index) => { const path = resolvedBackgrounds[entry.difficulty.id] ?? entry.difficulty.backgroundPath ?? entry.set.backgroundPath; return <div className="marathon-tile" key={entry.difficulty.id} style={{ backgroundImage: path ? `url("${convertFileSrc(path).replaceAll('"', "%22")}")` : undefined }}><small>{index + 1}</small></div> }) : <div className="dan-preview-empty"><Image/><span>{pl ? "Dodaj mapy, aby utworzyć kolaż" : "Add maps to create the collage"}</span></div>}<div className="marathon-symbol">{symbol}</div></div></section>
        <footer className="dan-submit"><div><strong>{title || (pl ? "Maraton bez nazwy" : "Untitled marathon")}</strong><span>{artist} · {version}</span>{status && <em>{status}</em>}</div><button className="btn primary" onClick={generate} disabled={!entries.length || generating}>{generating ? (pl ? "Generowanie…" : "Generating…") : (pl ? "Generuj .osz" : "Generate .osz")}</button></footer>
      </div>
    </div>
  </main>;
}

function DanLibrary({ sets, language, addedIds, full, onAdd }: { sets: BeatmapSet[]; language: "en" | "pl"; addedIds: Set<string>; full: boolean; onAdd: (map: LibraryMap) => void }) {
  const pl = language === "pl";
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"title" | "artist" | "creator">("title");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(100);
  const filtered = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return sets.filter(set => {
      const haystack = `${set.folderName} ${set.artist} ${set.title} ${set.creator} ${set.difficulties.map(difficulty => difficulty.version).join(" ")}`.toLocaleLowerCase();
      return terms.every(term => haystack.includes(term)) && set.difficulties.some(difficulty => difficulty.mode === 3);
    }).sort((left, right) => left[sort].localeCompare(right[sort], language));
  }, [sets, query, sort, language]);
  useEffect(() => setVisibleCount(100), [query, sort, sets.length]);
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const toggle = (id: string) => setExpanded(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const visible = filtered.slice(0, visibleCount);
  return <aside className="panel library-panel dan-library">
    <div className="panel-heading"><div><span className="eyebrow">{pl ? "BIBLIOTEKA" : "LIBRARY"}</span><h2>{pl ? "Wybierz mapy" : "Choose maps"}</h2></div><span className="count-chip">{filtered.length}</span></div>
    <div className="library-tools"><label className="search"><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder={pl ? "Tytuł, artysta, mapper lub difficulty…" : "Title, artist, mapper or difficulty…"}/></label><select value={sort} onChange={event => setSort(event.target.value as typeof sort)} aria-label="Sort"><option value="title">{pl ? "Tytuł A–Z" : "Title A–Z"}</option><option value="artist">{pl ? "Artysta A–Z" : "Artist A–Z"}</option><option value="creator">Mapper A–Z</option></select></div>
    <div className="map-list">{!sets.length && <div className="empty"><Disc3/><strong>{pl ? "Biblioteka jest pusta" : "Library is empty"}</strong><span>{pl ? "Wybierz folder Songs i przeskanuj mapy." : "Choose your Songs folder and scan maps."}</span></div>}{visible.map(set => { const open = expanded.has(set.id); const difficulties = set.difficulties.filter(difficulty => difficulty.mode === 3 && terms.every(term => `${difficulty.version} ${set.title} ${set.artist} ${set.creator} ${set.folderName}`.toLocaleLowerCase().includes(term))); return <article className="map-card" key={set.id}><div className="map-main"><button className="chevron" onClick={() => toggle(set.id)} aria-label="Expand">{open ? <ChevronDown/> : <ChevronRight/>}</button><div className="cover" style={set.backgroundPath ? { backgroundImage: `url("${convertFileSrc(set.backgroundPath).replaceAll('"', "%22")}")` } : undefined}><Disc3/></div><div className="map-copy" onClick={() => toggle(set.id)}><strong>{set.title}</strong><span>{set.artist}</span><small>{set.creator} · {difficulties.length} difficulty</small></div></div>{open && <div className="diff-list">{difficulties.map((difficulty, index) => <button key={difficulty.id} className={addedIds.has(difficulty.id) ? "picked" : ""} disabled={full && !addedIds.has(difficulty.id)} onClick={() => onAdd({ set, difficulty })}><span className={`dot d${Math.min(index, 4)}`}/><span title={difficulty.version}>{difficulty.version}</span><small>{addedIds.has(difficulty.id) ? (pl ? "dodano" : "added") : "mania"}</small><Plus size={14}/></button>)}</div>}</article>; })}{visible.length < filtered.length && <button className="show-more" onClick={() => setVisibleCount(count => count + 100)}>{pl ? "Pokaż kolejne 100" : "Show 100 more"}<small>{visible.length} / {filtered.length}</small></button>}</div>
  </aside>;
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label><span>{label}</span><input value={value} onChange={event => onChange(event.target.value)}/></label>;
}
