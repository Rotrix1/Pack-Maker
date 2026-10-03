import { Download, FileCog, FolderOpen, ImagePlus, Languages, Palette, Save, Trash2, X } from "lucide-react";
import type { Settings } from "../types";

const themes: Array<{ id: Settings["theme"]; name: string; colors: [string, string] }> = [
  { id: "rose", name: "Osu Rose", colors: ["#ff5aa5", "#9a65ff"] },
  { id: "violet", name: "Neon Violet", colors: ["#a970ff", "#6948ff"] },
  { id: "ocean", name: "Midnight Ocean", colors: ["#31b8ff", "#5065ff"] },
  { id: "emerald", name: "Emerald", colors: ["#37d6a0", "#2e8dca"] },
  { id: "amber", name: "Sunset", colors: ["#ffac45", "#f05286"] },
];

type Props = { settings: Settings; onChange: (patch: Partial<Settings>) => void; onPickFfmpeg: () => void; onPickBackground: () => void; onSaveProject:()=>void;onLoadProject:()=>void;onClearProject:()=>void;onClose: () => void };

export function SettingsModal({ settings, onChange, onPickFfmpeg, onPickBackground, onSaveProject,onLoadProject,onClearProject,onClose }: Props) {
  const pl=settings.language==="pl";
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal settings-modal" onMouseDown={e => e.stopPropagation()}>
    <div className="modal-title"><div className="settings-icon"><FileCog/></div><div><span className="eyebrow">{pl?"USTAWIENIA":"SETTINGS"}</span><h2>{pl?"Wygląd i aplikacja":"Appearance and application"}</h2></div><button className="icon-btn" onClick={onClose}><X/></button></div>
    <section className="settings-section"><div className="settings-section-title"><Languages size={16}/><div><strong>{pl?"Język":"Language"}</strong><span>{pl?"Zmień język interfejsu.":"Change the interface language."}</span></div></div><div className="language-switch"><button className={settings.language==="en"?"active":""} onClick={()=>onChange({language:"en"})}>English</button><button className={settings.language==="pl"?"active":""} onClick={()=>onChange({language:"pl"})}>Polski</button></div></section>
    <section className="settings-section"><div className="settings-section-title"><Save size={16}/><div><strong>{pl?"Projekt paczki":"Pack project"}</strong><span>{pl?"Autosave działa automatycznie. Możesz też utworzyć ręczny zapis.":"Autosave runs automatically. You can also create a manual save."}</span></div></div><div className="project-actions"><button className="btn primary" onClick={onSaveProject}><Save/>{pl?"Zapisz stan":"Save current"}</button><button className="btn secondary" onClick={onLoadProject}><Download/>{pl?"Wczytaj zapis":"Load saved"}</button><button className="btn danger-soft" onClick={onClearProject}><Trash2/>{pl?"Wyczyść autosave":"Clear autosave"}</button></div></section>
    <section className="settings-section">
      <div className="settings-section-title"><Palette size={16}/><div><strong>{pl?"Motyw kolorystyczny":"Color theme"}</strong><span>{pl?"Wybierz akcent pasujący do Twojego stylu.":"Choose an accent matching your style."}</span></div></div>
      <div className="theme-grid">{themes.map(theme => <button key={theme.id} className={`theme-option ${settings.theme === theme.id ? "active" : ""}`} onClick={() => onChange({ theme: theme.id })}><span className="theme-swatch" style={{ background: `linear-gradient(135deg, ${theme.colors[0]}, ${theme.colors[1]})` }}/><span>{theme.name}</span></button>)}</div>
    </section>
    <section className="settings-section">
      <div className="settings-section-title"><ImagePlus size={16}/><div><strong>{pl?"Własne zdjęcie tła":"Custom application background"}</strong><span>{pl?"Zdjęcie jest przyciemnione i nie zasłania paneli.":"The image stays behind translucent panels."}</span></div></div>
      <div className="background-controls"><button className="btn secondary" onClick={onPickBackground}><FolderOpen size={16}/>{settings.backgroundImage?(pl?"Zmień zdjęcie":"Change image"):(pl?"Wybierz zdjęcie":"Choose image")}</button>{settings.backgroundImage&&<button className="btn danger-soft" onClick={()=>onChange({backgroundImage:""})}><Trash2 size={15}/>{pl?"Usuń":"Remove"}</button>}<span className="background-name" title={settings.backgroundImage}>{settings.backgroundImage?settings.backgroundImage.split(/[\\/]/).pop():(pl?"Brak własnego tła":"No custom background")}</span></div>
      <label className="opacity-control"><span>{pl?"Widoczność tła":"Background visibility"}</span><input type="range" min="0.01" max="1" step="0.01" value={Math.max(.01, Math.min(1, settings.backgroundOpacity))} onChange={e => onChange({ backgroundOpacity: Number(e.target.value) })}/><strong>{Math.round(settings.backgroundOpacity * 100)}%</strong></label>
    </section>
    <details className="advanced-settings"><summary>{pl?"Zaawansowane ustawienia audio":"Advanced audio settings"}</summary><p>{pl?"FFmpeg jest wykrywany automatycznie w folderze aplikacji, PATH, WinGet oraz Pobranych. Wybierz plik tylko, jeśli automatyczne wykrywanie go nie znajdzie.":"FFmpeg is detected automatically in the app folder, PATH, WinGet and Downloads. Choose it manually only if automatic detection cannot find it."}</p><label className="settings-field"><span>{pl?"Własna ścieżka do FFmpeg (opcjonalnie)":"Custom FFmpeg path (optional)"}</span><div><input value={settings.ffmpegPath} onChange={e => onChange({ ffmpegPath: e.target.value })} placeholder={pl?"Automatyczne wykrywanie":"Automatic detection"}/><button className="btn secondary" onClick={onPickFfmpeg}><FolderOpen size={16}/>{pl?"Wybierz":"Choose"}</button></div></label></details>
    <div className="modal-note"><strong>{pl?"Mapy będą zapisane jako Twoje.":"Maps will be saved under your name."}</strong><span>{pl?"Autor map i paczki zastąpi pole Creator.":"The map and pack author replaces the Creator field."}</span></div>
    <button className="btn primary modal-done" onClick={onClose}>{pl?"Zapisz ustawienia":"Save settings"}</button>
  </div></div>;
}
