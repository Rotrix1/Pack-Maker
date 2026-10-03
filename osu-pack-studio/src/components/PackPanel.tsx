import { Check, Disc3, FolderOutput, PackageOpen, Trash2, X } from "lucide-react";
import type { PackItem, Settings } from "../types";

type Props = {
  items: PackItem[];
  settings: Settings;
  generating: boolean;
  onSettings: (patch: Partial<Settings>) => void;
  onPickOutput: () => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<PackItem>) => void;
  onGenerate: () => void;
  language: "en"|"pl";
};

export function PackPanel({ items, settings, generating, onSettings, onPickOutput, onToggle, onRemove, onChange, onGenerate, language }: Props) {
  const pl=language==="pl";
  return <section className="panel pack-panel">
    <div className="panel-heading"><div><span className="eyebrow">{pl?"NOWA PACZKA":"NEW PACK"}</span><h2>{pl?"Wybrane mapy":"Selected maps"}</h2></div><span className="count-chip pink">{items.length}</span></div>
    <div className="pack-meta">
      <label><span>{pl?"Nazwa paczki":"Pack name"}</span><input value={settings.packName} onChange={e => onSettings({ packName: e.target.value })} placeholder="e.g. Freedom Dive Collection"/></label>
      <label><span>{pl?"Autor map i paczki":"Map and pack author"}</span><input value={settings.author} onChange={e => onSettings({ author: e.target.value })} placeholder={pl?"Twój nick w osu!":"Your osu! username"}/></label>
    </div>
    <div className="pack-column-head"><span>MAPA</span><span>RATE</span><span>PITCH</span><span/></div>
    <div className="pack-items">
      {!items.length && <div className="empty"><PackageOpen/><strong>{pl?"Jeszcze nic tu nie ma":"Nothing here yet"}</strong><span>{pl?"Dodaj beatmapset lub pojedyncze difficulty z biblioteki.":"Add a beatmapset or a single difficulty from the library."}</span></div>}
      {items.map(item => <article key={item.difficulty.id} className={`pack-item ${item.selected ? "selected" : ""}`}>
        <button className="select-box" onClick={() => onToggle(item.difficulty.id)}>{item.selected && <Check size={13}/>}</button>
        <div className="tiny-cover"><Disc3 size={18}/></div>
        <div className="item-copy"><strong>{item.set.title}</strong><span>{item.set.artist} · [{item.difficulty.version}]</span></div>
        <div className="number-wrap"><input className="number-input" type="number" min="0.1" max="3" step="0.1" value={item.rate} onChange={e => { if (Number.isFinite(e.target.valueAsNumber)) onChange(item.difficulty.id, { rate: e.target.valueAsNumber }); }} title="Wpisz rate od 0.1 do 3.0"/><span>×</span></div>
        <div className="number-wrap"><input className="number-input" type="number" min="-24" max="24" step="0.1" value={item.pitch} onChange={e => { if (Number.isFinite(e.target.valueAsNumber)) onChange(item.difficulty.id, { pitch: e.target.valueAsNumber }); }} title="Wpisz pitch w półtonach"/><span>st</span></div>
        <button className="remove" onClick={() => onRemove(item.difficulty.id)} title="Usuń"><X size={16}/></button>
      </article>)}
    </div>
    <footer className="pack-footer">
      <div className="output-path" onClick={onPickOutput}><FolderOutput size={18}/><div><small>{pl?"Folder docelowy":"Output folder"}</small><span>{settings.outputFolder || (pl?"Wybierz miejsce zapisu":"Choose output folder")}</span></div></div>
      <button className="btn generate" disabled={!items.length || !settings.outputFolder || !settings.packName.trim() || !settings.author.trim() || generating} onClick={onGenerate}><span>{generating?(pl?"Tworzenie…":"Generating…"):(pl?"Generuj jeden .osz":"Generate one .osz")}</span>{generating ? <Disc3 className="spin"/> : <PackageOpen/>}</button>
      {!!items.length && <button className="clear-hint" title="Zaznacz elementy i użyj przycisku usuwania"><Trash2 size={13}/> {items.filter(i => i.selected).length} zazn.</button>}
    </footer>
  </section>;
}
