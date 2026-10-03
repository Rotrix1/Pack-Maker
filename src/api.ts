import { invoke } from "@tauri-apps/api/core";
import type { BeatmapSet, GenerateReport, PackItem, Settings } from "./types";

const isTauri = () => "__TAURI_INTERNALS__" in window;
const fallbackSettings: Settings = { language:"en", songsFolder:"", outputFolder:"", ffmpegPath:"", packName:"My pack", author:"", theme:"rose", backgroundImage:"", backgroundOpacity:.16 };

export async function loadSettings(): Promise<Settings> {
  if (!isTauri()) { const raw=localStorage.getItem("osu-pack-studio-settings"); return raw ? JSON.parse(raw) : fallbackSettings; }
  return invoke("load_settings");
}
export async function saveSettings(settings: Settings) {
  if (!isTauri()) { localStorage.setItem("osu-pack-studio-settings",JSON.stringify(settings)); return; }
  await invoke("save_settings",{settings});
}
export async function scanFolder(path:string):Promise<BeatmapSet[]> {
  if (!isTauri()) throw new Error("Folder scanning is available in the Tauri desktop app.");
  return invoke("scan_songs_folder",{path});
}
export async function generatePack(settings:Settings,items:PackItem[]):Promise<GenerateReport> {
  if (!isTauri()) throw new Error("Pack generation is available in the Tauri desktop app.");
  return invoke("generate_pack",{request:{packName:settings.packName,author:settings.author,outputFolder:settings.outputFolder,ffmpegPath:settings.ffmpegPath||null,items:items.map(item=>({setId:item.set.id,folderPath:item.set.folderPath,artist:item.set.artist,title:item.set.title,creator:item.set.creator,osuPath:item.difficulty.osuPath,difficulty:item.difficulty.version,rate:item.rate,pitch:item.pitch,trainer:item.trainer,customBackgroundPath:item.customBackgroundPath,backgroundPath:item.set.backgroundPath,backgroundEffects:item.backgroundEffects,overlays:item.overlays|| (item.backgroundOverlayPath?[{id:"legacy",path:item.backgroundOverlayPath,opacity:.8,scale:.3,x:.5,y:.5}]:[]) }))}});
}
export async function generateMarathon(settings: Settings, input: { packName: string; artist: string; author: string; version: string; symbol: string; items: PackItem[]; breaks: number[] }): Promise<GenerateReport> {
  if (!isTauri()) throw new Error("Marathon generation is available in the Tauri desktop app.");
  return invoke("generate_marathon", { request: {
    packName: input.packName, artist: input.artist, author: input.author, version: input.version, symbol: input.symbol,
    outputFolder: settings.outputFolder, ffmpegPath: settings.ffmpegPath || null, breaks: input.breaks,
    items: input.items.map(item => ({ folderPath: item.set.folderPath, osuPath: item.difficulty.osuPath, artist: item.set.artist, title: item.set.title, creator: item.set.creator, difficulty: item.difficulty.version, rate: item.rate, pitch: item.pitch, backgroundPath: item.difficulty.backgroundPath || item.set.backgroundPath || null }))
  }});
}
export async function estimatePackSize(items:PackItem[]):Promise<number> {
  if (!isTauri()) return 0;
  return invoke("estimate_pack_size",{items:items.map(item=>({folderPath:item.set.folderPath,osuPath:item.difficulty.osuPath,customBackgroundPath:item.customBackgroundPath||null,overlays:item.overlays||[]}))});
}
export async function createAudioPreview(item:PackItem,ffmpegPath:string):Promise<string> {
  if (!isTauri()) throw new Error("Audio preview is available in the Tauri desktop app.");
  return invoke("create_audio_preview",{item:{folderPath:item.set.folderPath,osuPath:item.difficulty.osuPath,rate:item.rate,pitch:item.pitch,trainer:item.trainer,ffmpegPath:ffmpegPath||null}});
}
export type SavedProject={id:string;name:string;kind:"manual"|"auto";savedAt:number;pack:PackItem[];settings:Settings};
export async function saveProjectFile(input:{name:string;kind:"manual"|"auto";pack:PackItem[];settings:Settings}):Promise<SavedProject>{return invoke("save_project",{input});}
export async function listProjectFiles():Promise<SavedProject[]>{return invoke("list_projects");}
export async function loadProjectFile(id:string):Promise<SavedProject>{return invoke("load_project",{id});}
export async function deleteProjectFile(id:string):Promise<void>{return invoke("delete_project",{id});}
export async function pickDirectory(title:string):Promise<string|null> { if (!isTauri()) return null; const {open}=await import("@tauri-apps/plugin-dialog"); const value=await open({directory:true,multiple:false,title}); return typeof value==="string"?value:null; }
export async function pickFfmpeg():Promise<string|null> { if (!isTauri()) return null; const {open}=await import("@tauri-apps/plugin-dialog"); const value=await open({multiple:false,filters:[{name:"FFmpeg",extensions:["exe"]}]}); return typeof value==="string"?value:null; }
export async function pickBackground():Promise<string|null> { if (!isTauri()) return null; const {open}=await import("@tauri-apps/plugin-dialog"); const value=await open({multiple:false,filters:[{name:"Images",extensions:["png","jpg","jpeg","webp","bmp"]}]}); return typeof value==="string"?value:null; }
export async function fetchManiaTrackerPage(url:string):Promise<{status:number;url:string;html:string}> { const response=await fetch(url,{headers:{accept:"text/html"}}); return {status:response.status,url:response.url,html:response.status===404?"":await response.text()}; }
