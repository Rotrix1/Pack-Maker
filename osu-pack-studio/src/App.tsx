import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { LibraryPanel } from "./components/LibraryPanel";
import { PackPanel } from "./components/PackPanel";
import { SettingsModal } from "./components/SettingsModal";
import { Toast } from "./components/Toast";
import { TopBar } from "./components/TopBar";
import { TransferRail } from "./components/TransferRail";
import { TrainerPanel } from "./components/TrainerPanel";
import { PlayerAnalyzer } from "./components/PlayerAnalyzer";
import { BackgroundEditor } from "./components/BackgroundEditor";
import type { AppView } from "./components/TopBar";
import type { TrainingCandidate } from "./logic/playerAnalysis";
import { estimatePackSize, generatePack, loadSettings, pickBackground, pickDirectory, pickFfmpeg, saveSettings, scanFolder } from "./api";
import type { BeatmapSet, PackItem, Settings } from "./types";

const defaults: Settings = { language:"en", songsFolder: "", outputFolder: "", ffmpegPath: "", packName: "My pack", author: "", theme: "rose", backgroundImage: "", backgroundOpacity: 0.16 };
const themeColors: Record<Settings["theme"], [string, string]> = { rose: ["#ff5aa5", "#9a65ff"], violet: ["#a970ff", "#6948ff"], ocean: ["#31b8ff", "#5065ff"], emerald: ["#37d6a0", "#2e8dca"], amber: ["#ffac45", "#f05286"] };
type Notice = { kind: "success" | "error"; title: string; message: string };
type SavedProject={pack:PackItem[];meta:Pick<Settings,"packName"|"author"|"outputFolder">;savedAt:number};
const readProject=(key:string):SavedProject|null=>{try{return JSON.parse(localStorage.getItem(key)||"null")}catch{return null}};

export default function App() {
  const [settings, setSettings] = useState(defaults);
  const [sets, setSets] = useState<BeatmapSet[]>([]);
  const [pack, setPack] = useState<PackItem[]>(()=>readProject("pack-studio-autosave")?.pack||[]);
  const [selectedSets, setSelectedSets] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [view, setView] = useState<AppView>("pack");
  const [estimatedSizeBytes,setEstimatedSizeBytes]=useState(0);
  const [newSetIds,setNewSetIds]=useState<Set<string>>(new Set());
  const pickedIds = useMemo(() => new Set(pack.map(x => x.difficulty.id)), [pack]);

  useEffect(() => { loadSettings().then(s => {const auto=readProject("pack-studio-autosave"),meta={...(auto?.meta||{})};if(meta.outputFolder&&(meta.outputFolder===s.songsFolder||/[\\/]Songs[\\/]?$/i.test(meta.outputFolder)))delete (meta as Partial<Settings>).outputFolder;setSettings({ ...defaults, ...s,...meta })}).catch(showError); }, []);
  useEffect(() => { const timer = setTimeout(() => saveSettings(settings).catch(() => {}), 350); return () => clearTimeout(timer); }, [settings]);
  useEffect(() => { const timer=setTimeout(()=>estimatePackSize(pack).then(setEstimatedSizeBytes).catch(()=>setEstimatedSizeBytes(0)),250);return()=>clearTimeout(timer)},[pack]);
  useEffect(()=>{const timer=setTimeout(()=>localStorage.setItem("pack-studio-autosave",JSON.stringify({pack,meta:{packName:settings.packName,author:settings.author,outputFolder:settings.outputFolder},savedAt:Date.now()} satisfies SavedProject)),500);return()=>clearTimeout(timer)},[pack,settings.packName,settings.author,settings.outputFolder]);

  const patchSettings = (patch: Partial<Settings>) => setSettings(s => ({ ...s, ...patch }));
  const chooseDirectory = async (field: "songsFolder" | "outputFolder") => {
    const value = await pickDirectory(field === "songsFolder" ? "Wybierz folder Songs osu!" : "Wybierz folder docelowy");
    if (value) patchSettings({ [field]: value });
  };
  const chooseFfmpeg = async () => { const value = await pickFfmpeg(); if (value) patchSettings({ ffmpegPath: value }); };
  const chooseBackground = async () => { const value = await pickBackground(); if (value) patchSettings({ backgroundImage: value }); };
  const chooseMapBackground = async (id: string) => { const value=await pickBackground();if(value)setPack(items=>items.map(item=>item.difficulty.id===id?{...item,customBackgroundPath:value}:item)); };
  const chooseMapOverlay = async (id: string) => { const value=await pickBackground();if(value)setPack(items=>items.map(item=>item.difficulty.id===id?{...item,backgroundOverlayPath:value}:item)); };
  const doScan = async () => {
    if (!settings.songsFolder) return;
    setScanning(true);
    try { const data=await scanFolder(settings.songsFolder),oldById=new Map(sets.map(set=>[set.id,set])),added=new Set(data.filter(set=>!oldById.has(set.id)).map(set=>set.id)),removed=sets.filter(set=>!data.some(next=>next.id===set.id)).length,changed=data.filter(set=>{const old=oldById.get(set.id);return old&&old.difficulties.map(d=>d.id).join("|")!==set.difficulties.map(d=>d.id).join("|")}).length,wasRefresh=sets.length>0;setSets(data);setNewSetIds(wasRefresh?added:new Set());setSelectedSets(new Set());const pl=settings.language==="pl";setNotice({kind:"success",title:wasRefresh?(pl?"Biblioteka odświeżona":"Library refreshed"):(pl?"Skanowanie zakończone":"Scan complete"),message:wasRefresh?(pl?`Nowe: ${added.size} · zmienione: ${changed} · usunięte: ${removed}`:`New: ${added.size} · changed: ${changed} · removed: ${removed}`):(pl?`Znaleziono ${data.length} beatmapsetów.`:`Found ${data.length} beatmapsets.`)}); }
    catch (e) { showError(e); } finally { setScanning(false); }
  };
  const addDifficulty = (set: BeatmapSet, id: string) => {
    const difficulty = set.difficulties.find(d => d.id === id); if (!difficulty || pickedIds.has(id)) return;
    setPack(old => [...old, { set, difficulty, rate: 1, pitch: 0, selected: false }]);
  };
  const addSet = (set: BeatmapSet) => setPack(old => {
    const existing = new Set(old.map(x => x.difficulty.id));
    return [...old, ...set.difficulties.filter(d => !existing.has(d.id)).map(difficulty => ({ set, difficulty, rate: 1, pitch: 0, selected: false }))];
  });
  const addSelected = () => {sets.filter(s => selectedSets.has(s.id)).forEach(addSet);setSelectedSets(new Set())};
  const saveProject=()=>{localStorage.setItem("pack-studio-manual-project",JSON.stringify({pack,meta:{packName:settings.packName,author:settings.author,outputFolder:settings.outputFolder},savedAt:Date.now()} satisfies SavedProject));setNotice({kind:"success",title:settings.language==="pl"?"Projekt zapisany":"Project saved",message:settings.language==="pl"?`Zapisano ${pack.length} difficulty, rate, pitch i backgroundy.`:`Saved ${pack.length} difficulties, rates, pitches and backgrounds.`})};
  const loadProject=()=>{const saved=readProject("pack-studio-manual-project");if(!saved){setNotice({kind:"error",title:settings.language==="pl"?"Brak zapisu":"No saved project",message:settings.language==="pl"?"Najpierw zapisz aktualny stan.":"Save the current project first."});return}setPack(saved.pack);setSettings(current=>({...current,...saved.meta}));setNotice({kind:"success",title:settings.language==="pl"?"Projekt wczytany":"Project loaded",message:new Date(saved.savedAt).toLocaleString()})};
  const clearAutosave=()=>{localStorage.removeItem("pack-studio-autosave");setNotice({kind:"success",title:settings.language==="pl"?"Autosave wyczyszczony":"Autosave cleared",message:settings.language==="pl"?"Aktualna paczka pozostaje otwarta.":"The current pack remains open."})};
  const doGenerate = async () => {
    setGenerating(true);
    try { const report = await generatePack(settings, pack); setNotice({ kind: "success", title: "Paczka jest gotowa", message: `${report.difficulties} map zapisano w ${report.outputPath}${report.warnings.length ? ` · ${report.warnings.length} ostrzeżeń` : ""}` }); }
    catch (e) { showError(e); } finally { setGenerating(false); }
  };
  const createTrainerMap = async (item: PackItem) => {
    if (!settings.outputFolder || !settings.author.trim()) { setNotice({ kind: "error", title: "Uzupełnij dane", message: "Wybierz folder docelowy i wpisz autora map." }); return; }
    setGenerating(true); try { const report = await generatePack({ ...settings, packName: `${item.set.title} Trainer` }, [item]); setNotice({ kind: "success", title: "Mapa treningowa jest gotowa", message: report.outputPath }); } catch (e) { showError(e); } finally { setGenerating(false); }
  };
  const sendTrainingToPack = (candidates: TrainingCandidate[]) => {
    setPack(old => { const existing = new Set(old.map(x=>x.difficulty.id)); return [...old,...candidates.filter(x=>!existing.has(x.difficulty.id)).map(x=>({set:x.set,difficulty:x.difficulty,rate:x.rate,pitch:0,selected:false}))]; }); setView("pack"); setNotice({kind:"success",title:"Trening dodany",message:`Dodano ${candidates.length} difficulty do Pack Studio.`});
  };
  function showError(error: unknown) { setNotice({ kind: "error", title: "Coś poszło nie tak", message: error instanceof Error ? error.message : String(error) }); }

  const colors = themeColors[settings.theme] || themeColors.rose;
  const themeStyle = { "--accent": colors[0], "--accent-2": colors[1] } as CSSProperties;
  const backgroundUrl = settings.backgroundImage ? encodeURI(`file:///${settings.backgroundImage.replace(/\\/g, "/")}`) : undefined;
  return <div className="app-shell" style={themeStyle}>
    {backgroundUrl && <div className="theme-background" style={{ backgroundImage: `url(${backgroundUrl})`, opacity: settings.backgroundOpacity }}/>} 
    <div className="ambient one"/><div className="ambient two"/>
    <TopBar path={settings.songsFolder} count={sets.length} scanning={scanning} onPick={() => chooseDirectory("songsFolder")} onScan={doScan} onSettings={() => setSettingsOpen(true)} view={view} onViewChange={setView} language={settings.language}/>
    {view === "pack" ? <main className="workspace">
      <LibraryPanel sets={sets} picked={pickedIds} selectedSets={selectedSets} newSetIds={newSetIds} language={settings.language} onToggle={id => setSelectedSets(old => { const n = new Set(old); n.has(id) ? n.delete(id) : n.add(id); return n; })} onAddSet={addSet} onAddDifficulty={addDifficulty}/>
      <TransferRail addDisabled={!selectedSets.size} removeDisabled={!pack.some(x => x.selected)} language={settings.language} onAddSelected={addSelected} onRemoveSelected={() => setPack(p => p.filter(x => !x.selected))}/>
      <PackPanel items={pack} settings={settings} language={settings.language} generating={generating} onSettings={patchSettings} onPickOutput={() => chooseDirectory("outputFolder")} onToggle={id => setPack(p => p.map(x => x.difficulty.id === id ? { ...x, selected: !x.selected } : x))} onRemove={id => setPack(p => p.filter(x => x.difficulty.id !== id))} onChange={(id, patch) => setPack(p => p.map(x => x.difficulty.id === id ? { ...x, ...patch } : x))} onGenerate={doGenerate}/>
      <TrainerPanel items={pack} estimatedSizeBytes={estimatedSizeBytes} language={settings.language} onChange={(id, patch) => setPack(p => p.map(x => x.difficulty.id === id ? { ...x, ...patch } : x))} onCreate={createTrainerMap}/>
    </main> : view === "backgrounds" ? <BackgroundEditor items={pack} language={settings.language} onPick={chooseMapBackground} onPickOverlay={chooseMapOverlay} onChange={(id,patch)=>setPack(items=>items.map(item=>item.difficulty.id===id?{...item,...patch}:item))}/> : <PlayerAnalyzer sets={sets} language={settings.language} onSendToPack={sendTrainingToPack}/>} 
    <div className="statusbar"><span><i/>{settings.language==="pl"?"Lokalny tryb pracy":"Local mode"}</span><span>{pack.length} {settings.language==="pl"?"difficulty w paczce":"difficulties in pack"}</span><a href="https://osu.ppy.sh/users/31245051" target="_blank" rel="noreferrer">Created by Rotrix</a></div>
    {settingsOpen && <SettingsModal settings={settings} onChange={patchSettings} onPickFfmpeg={chooseFfmpeg} onPickBackground={chooseBackground} onSaveProject={saveProject} onLoadProject={loadProject} onClearProject={clearAutosave} onClose={() => setSettingsOpen(false)}/>} 
    {notice && <Toast {...notice} onClose={() => setNotice(null)}/>} 
  </div>;
}
