import { Activity, Gauge, Keyboard, LoaderCircle, Lock, Pause, Play, RotateCcw, Save, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createAudioPreview } from "../api";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { PackItem, TrainerConfig } from "../types";

const makeConfig = (item: PackItem): TrainerConfig => ({ hp: item.difficulty.hp ?? 5, cs: item.difficulty.cs ?? 4, ar: item.difficulty.ar ?? 5, od: item.difficulty.od ?? 5, hrCircleSize: false, scaleAr: true, scaleOd: true, changePitch: false, noSpinners: false, highQuality: true, deleteUnusedMp3s: true });
const backgroundFor = (item: PackItem) => item.customBackgroundPath || item.difficulty.backgroundPath || item.set.backgroundPath;
type Profile = { name: string; rate: number; pitch: number; config: TrainerConfig };

export function TrainerPanel({ items, estimatedSizeBytes, language, ffmpegPath, onChange, onCreate }: { items: PackItem[]; estimatedSizeBytes: number; language:"en"|"pl"; ffmpegPath:string; onChange: (id: string, patch: Partial<PackItem>) => void; onCreate: (item: PackItem) => void }) {
  const active = items.find(item => item.selected) || items[0];
  const [profiles, setProfiles] = useState<Profile[]>(() => { try { return JSON.parse(localStorage.getItem("trainer-profiles") || "null") || []; } catch { return []; } });
  const [previewLoading,setPreviewLoading]=useState(false),[previewPlaying,setPreviewPlaying]=useState(false),[previewError,setPreviewError]=useState("");
  const [previewVolume,setPreviewVolume]=useState(()=>Number(localStorage.getItem("audio-preview-volume")||.8));
  const audioRef=useRef<HTMLAudioElement|null>(null),previewSignature=useRef("");
  const config = useMemo(() => active ? active.trainer || makeConfig(active) : null, [active]);
  const updateConfig = (patch: Partial<TrainerConfig>) => active && config && onChange(active.difficulty.id, { trainer: { ...config, ...patch } });
  const reset = () => active && onChange(active.difficulty.id, { rate: 1, pitch: 0, trainer: makeConfig(active) });
  const saveProfile = (index: number) => {
    if (!active || !config) return; const next = [...profiles]; next[index] = { name: next[index]?.name || `Profile ${index + 1}`, rate: active.rate, pitch: active.pitch, config }; setProfiles(next); localStorage.setItem("trainer-profiles", JSON.stringify(next));
  };
  const loadProfile = (index: number) => { const profile = profiles[index]; if (active && profile) onChange(active.difficulty.id, { rate: profile.rate, pitch: profile.pitch, trainer: profile.config }); };
  const renameProfile = (index: number) => { const name = window.prompt("Nazwa profilu", profiles[index]?.name || `Profile ${index + 1}`); if (!name) return; const next = [...profiles]; next[index] = { ...(next[index] || { rate: 1, pitch: 0, config: active ? makeConfig(active) : {} as TrainerConfig }), name }; setProfiles(next); localStorage.setItem("trainer-profiles", JSON.stringify(next)); };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (!active || !event.ctrlKey || !event.shiftKey) return; if (event.key === "ArrowUp") onChange(active.difficulty.id, { rate: Math.min(3, Math.round((active.rate + .05) * 100) / 100) }); if (event.key === "ArrowDown") onChange(active.difficulty.id, { rate: Math.max(.1, Math.round((active.rate - .05) * 100) / 100) }); if (event.key.toLowerCase() === "x") onCreate(active); };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [active, onChange, onCreate]);
  useEffect(()=>{audioRef.current?.pause();audioRef.current=null;previewSignature.current="";setPreviewPlaying(false);setPreviewError("")},[active?.difficulty.id,active?.rate,active?.pitch,active?.trainer?.changePitch]);
  useEffect(()=>{if(audioRef.current)audioRef.current.volume=previewVolume;localStorage.setItem("audio-preview-volume",String(previewVolume))},[previewVolume]);

  const togglePreview=async()=>{if(!active)return;const signature=`${active.difficulty.id}|${active.rate}|${active.pitch}|${active.trainer?.changePitch}|${ffmpegPath}`;if(audioRef.current&&previewSignature.current===signature){if(audioRef.current.paused){await audioRef.current.play();setPreviewPlaying(true)}else{audioRef.current.pause();setPreviewPlaying(false)}return}setPreviewLoading(true);setPreviewError("");try{const path=await createAudioPreview(active,ffmpegPath),audio=new Audio(convertFileSrc(path));audio.volume=previewVolume;audio.onended=()=>setPreviewPlaying(false);audio.onerror=()=>{setPreviewPlaying(false);setPreviewError("Nie udało się odtworzyć podglądu.")};audioRef.current=audio;previewSignature.current=signature;await audio.play();setPreviewPlaying(true)}catch(error){setPreviewError(error instanceof Error?error.message:String(error))}finally{setPreviewLoading(false)}};

  if (!active || !config) return <section className="panel trainer-panel"><div className="trainer-empty"><Wand2/><strong>osu!mania Trainer</strong><span>{language==="pl"?"Dodaj mapę do paczki, aby rozpocząć trening.":"Add a map to the pack to start training."}</span></div></section>;
  const metrics = active.difficulty.metrics;
  const oldBpm = metrics?.bpm || 0, newBpm = Math.round(oldBpm * active.rate);
  return <section className="panel trainer-panel">
    <div className="trainer-hero"><div className="trainer-cover" style={backgroundFor(active) ? { backgroundImage: `url(${convertFileSrc(backgroundFor(active)!)})` } : undefined}/><div><span className="eyebrow">OSU!MANIA TRAINER</span><strong>{active.set.title}</strong><small>{active.set.artist} · [{active.difficulty.version}]</small></div><span className="pack-size-badge" title="Przewidywany rozmiar gotowej paczki">≈ {(estimatedSizeBytes/1024/1024).toFixed(1)} MB</span></div>
    <div className="trainer-scroll">
      <div className="trainer-stats">{(["hp","cs","ar","od"] as const).map(key => <label key={key}><span>{key.toUpperCase()}</span><input type="range" min="0" max="10" step="0.1" value={config[key]} onChange={e => updateConfig({ [key]: Number(e.target.value) })}/><b>{config[key].toFixed(1)}</b>{key === "cs" && <Lock size={12}/>}</label>)}</div>
      <div className="rate-card"><Gauge/><div><span>Rate</span><input type="number" min="0.1" max="3" step="0.05" value={active.rate} onChange={e => Number.isFinite(e.target.valueAsNumber) && onChange(active.difficulty.id, { rate: e.target.valueAsNumber })}/></div><div><span>Pitch</span><input type="number" min="-24" max="24" step="0.1" value={active.pitch} onChange={e => Number.isFinite(e.target.valueAsNumber) && onChange(active.difficulty.id, { pitch: e.target.valueAsNumber })}/></div></div>
      <div className="bpm-row"><span>Old BPM <b>{oldBpm || "—"}</b></span><Activity size={15}/><span>New BPM <b>{newBpm || "—"}</b></span></div>
      <div className="audio-preview-card"><button onClick={togglePreview} disabled={previewLoading}>{previewLoading?<LoaderCircle className="spin"/>:previewPlaying?<Pause/>:<Play/>}<span><strong>{previewLoading?(language==="pl"?"Przygotowywanie…":"Preparing…"):previewPlaying?(language==="pl"?"Pauza":"Pause"):"Preview audio"}</strong><small>25 s · {active.rate.toFixed(2)}× · {active.pitch>=0?"+":""}{active.pitch.toFixed(1)} st</small></span></button><label className="preview-volume"><span>{language==="pl"?"Głośność":"Volume"}</span><input type="range" min="0" max="1" step="0.01" value={previewVolume} onChange={event=>setPreviewVolume(Number(event.target.value))}/><b>{Math.round(previewVolume*100)}%</b></label>{previewError&&<em>{previewError}</em>}</div>
      <div className="trainer-toggles">
        <Toggle label="HR Circlesize" checked={config.hrCircleSize} onChange={v => updateConfig({ hrCircleSize: v })}/><Toggle label="Scale AR" checked={config.scaleAr} onChange={v => updateConfig({ scaleAr: v })}/><Toggle label="Scale OD" checked={config.scaleOd} onChange={v => updateConfig({ scaleOd: v })}/><Toggle label="Change pitch" checked={config.changePitch} onChange={v => updateConfig({ changePitch: v })}/><Toggle label="No spinners" checked={config.noSpinners} onChange={v => updateConfig({ noSpinners: v })}/><Toggle label="High quality audio" checked={config.highQuality} onChange={v => updateConfig({ highQuality: v })}/><Toggle label="Delete unused MP3s" checked={config.deleteUnusedMp3s} onChange={v => updateConfig({ deleteUnusedMp3s: v })}/>
      </div>
      <div className="profile-grid">{[0,1,2,3].map(index => <div key={index}><button onClick={() => loadProfile(index)} onDoubleClick={() => renameProfile(index)}>{profiles[index]?.name || `Profile ${index + 1}`}</button><button className="profile-save" onClick={() => saveProfile(index)}><Save size={11}/> Save</button></div>)}</div>
      <div className="hotkey-note"><Keyboard size={13}/><span>Ctrl+Shift+↑/↓ rate · Ctrl+Shift+X create</span></div>
    </div>
    <div className="trainer-actions"><button className="btn secondary" onClick={reset}><RotateCcw/> Reset</button><button className="btn primary" onClick={() => onCreate(active)}><Sparkles/> Create Map</button></div>
  </section>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="trainer-toggle"><span>{label}</span><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}/><i/></label>;
}
