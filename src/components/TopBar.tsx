import { BarChart3, FolderOpen, Images, Package, RefreshCw, Save, Settings2 } from "lucide-react";
import logo from "../assets/pack-studio-logo.png";

export type AppView = "pack" | "analyzer" | "backgrounds" | "projects";

type Props = {
  path: string;
  count: number;
  scanning: boolean;
  onPick: () => void;
  onScan: () => void;
  onSettings: () => void;
  view: AppView;
  onViewChange: (view: AppView) => void;
  language: "en"|"pl";
};

export function TopBar({ path, count, scanning, onPick, onScan, onSettings, view, onViewChange, language }: Props) {
  const pl=language==="pl";
  return <header className="topbar">
    <div className="brand"><img className="brand-logo" src={logo} alt="Pack Studio"/><div><strong>Pack Studio</strong><small>beatmap collection builder</small></div></div>
    <nav className="view-tabs"><button className={view === "pack" ? "active" : ""} onClick={() => onViewChange("pack")}><Package/>Pack Studio</button><button className={view === "backgrounds" ? "active" : ""} onClick={() => onViewChange("backgrounds")}><Images/>Backgrounds</button><button className={view === "projects" ? "active" : ""} onClick={() => onViewChange("projects")}><Save/>Projects</button><button className={view === "analyzer" ? "active" : ""} onClick={() => onViewChange("analyzer")}><BarChart3/>Dan Creator</button></nav>
    <div className="folder-box">
      <div className="folder-copy"><small>{pl?"Folder map":"Maps folder"}</small><span title={path}>{path || (pl?"Wybierz folder Songs osu!":"Choose osu! Songs folder")}</span></div>
      <button className="btn secondary" onClick={onPick}><FolderOpen size={17}/>{pl?"Wybierz folder":"Choose folder"}</button>
      <button className="btn primary" onClick={onScan} disabled={!path || scanning}><RefreshCw className={scanning ? "spin" : ""} size={17}/>{scanning?(pl?"Skanowanie…":"Scanning…"):count?(pl?"Odśwież":"Refresh"):(pl?"Skanuj":"Scan")}</button>
    </div>
    <div className="found-count"><strong>{count}</strong><span>{pl?"beatmapsetów":"beatmapsets"}</span></div>
    <button className="icon-btn" onClick={onSettings} title={pl?"Ustawienia":"Settings"}><Settings2 size={20}/></button>
  </header>;
}
