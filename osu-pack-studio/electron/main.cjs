const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const archiver = require("archiver");
const { pathToFileURL } = require("url");
const bundledFfmpeg = require("ffmpeg-static");

const defaults = { language:"en", songsFolder: "", outputFolder: "", ffmpegPath: "", packName: "My pack", author: "", theme: "rose", backgroundImage: "", backgroundOpacity: 0.16 };
const settingsPath = () => path.join(app.getPath("userData"), "settings.json");
const scanCachePath = () => path.join(app.getPath("userData"), "scan-cache-v2.json");
const idFor = (value) => crypto.createHash("sha1").update(value.toLowerCase()).digest("hex");
const exists = async (value) => { try { await fsp.access(value); return true; } catch { return false; } };
let scanCache;

function createWindow() {
  const win = new BrowserWindow({
    width: 1760, height: 940, minWidth: 1280, minHeight: 720, show: false,
    title: "osu! Pack Studio", backgroundColor: "#09080c", autoHideMenuBar: true,
    icon: path.join(__dirname, "../src-tauri/icons/icon.ico"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.once("did-finish-load", async () => {
    try {
      const mounted = await win.webContents.executeJavaScript("Boolean(document.querySelector('#root > *'))");
      win.show();
      if (!mounted) dialog.showErrorBox("Błąd uruchamiania", "Interfejs aplikacji nie został załadowany. Uruchom najnowszą wersję osu! Pack Studio.");
    } catch (error) {
      win.show();
      dialog.showErrorBox("Błąd uruchamiania", String(error));
    }
  });
  win.webContents.on("did-fail-load", (_, code, description) => {
    win.show();
    dialog.showErrorBox("Błąd ładowania aplikacji", `${description} (${code})`);
  });
  win.loadFile(path.join(__dirname, "../dist/index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
}

app.whenReady().then(() => { createWindow(); app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); }); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

ipcMain.handle("settings:load", async () => {
  try { const loaded={ ...defaults, ...JSON.parse(await fsp.readFile(settingsPath(), "utf8")) }; if(!loaded.outputFolder||loaded.outputFolder===loaded.songsFolder||path.basename(loaded.outputFolder).toLowerCase()==="songs")loaded.outputFolder=app.getPath("downloads"); return loaded; } catch { return {...defaults,outputFolder:app.getPath("downloads")}; }
});
ipcMain.handle("settings:save", async (_, settings) => {
  await fsp.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fsp.writeFile(settingsPath(), JSON.stringify({ ...defaults, ...settings }, null, 2));
});
ipcMain.handle("dialog:directory", async (_, title) => {
  const result = await dialog.showOpenDialog({ title, properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("dialog:ffmpeg", async () => {
  const result = await dialog.showOpenDialog({ title: "Wybierz ffmpeg.exe (opcjonalnie)", properties: ["openFile"], filters: [{ name: "FFmpeg", extensions: ["exe"] }] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("dialog:background", async () => {
  const result = await dialog.showOpenDialog({ title: "Wybierz zdjęcie tła", properties: ["openFile"], filters: [{ name: "Obrazy", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("library:scan", (_, folder) => scanSongs(folder));
ipcMain.handle("pack:generate", (_, request) => generatePack(request));
ipcMain.handle("pack:estimate-size", (_, items) => estimatePackSize(items));
ipcMain.handle("audio:preview", (_, item) => createAudioPreview(item));
ipcMain.handle("mania-tracker:fetch", async (_, input) => {
  let url;
  try { url = new URL(String(input)); } catch { throw new Error("Nieprawidłowy adres Mania Tracker."); }
  if (url.protocol !== "https:" || !["mania-tracker.com", "www.mania-tracker.com"].includes(url.hostname.toLowerCase()) || !/^\/player\/[^/]+(?:\/skills)?\/?$/i.test(url.pathname)) {
    throw new Error("Dozwolone są wyłącznie publiczne profile mania-tracker.com.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { redirect: "follow", signal: controller.signal, headers: { "user-agent": "Mozilla/5.0 osu-Pack-Studio/1.0", accept: "text/html,application/xhtml+xml" } });
    const finalUrl = new URL(response.url);
    if (!["mania-tracker.com", "www.mania-tracker.com"].includes(finalUrl.hostname.toLowerCase())) throw new Error("Mania Tracker przekierował zapytanie poza dozwoloną domenę.");
    const html = response.status === 404 ? "" : await response.text();
    if (html.length > 5_000_000) throw new Error("Odpowiedź Mania Tracker jest zbyt duża.");
    return { status: response.status, url: response.url, html };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Przekroczono czas oczekiwania na Mania Tracker.");
    throw error;
  } finally { clearTimeout(timeout); }
});

function parseOsuText(text) {
  text = text.replace(/^\uFEFF/, "");
  const data = { artist: "", title: "", creator: "", version: "", audio: "", background: "", mode: 0, hp: 5, cs: 4, ar: 5, od: 5 };
  let timingTotal = 0, timingCount = 0, noteCount = 0, lnCount = 0, firstTime, lastTime, peakNps = 0;
  let previousTime, intervalCount = 0, intervalMean = 0, intervalM2 = 0, streamIntervals = 0, jacks = 0, chordNotes = 0;
  let groupTime, groupCount = 0;
  const previousByColumn = new Map(), windows = new Map();
  let section = "";
  for (const source of text.split(/\r?\n/)) {
    const line = source.trim();
    if (/^\[.+\]$/.test(line)) { section = line; continue; }
    const value = line.includes(":") ? line.slice(line.indexOf(":") + 1).trim() : "";
    if (section === "[General]") {
      if (line.startsWith("AudioFilename:")) data.audio = value;
      if (line.startsWith("Mode:")) data.mode = Number(value) || 0;
    } else if (section === "[Difficulty]") {
      if (line.startsWith("HPDrainRate:")) data.hp = Number(value) || 0;
      if (line.startsWith("CircleSize:")) data.cs = Number(value) || 0;
      if (line.startsWith("ApproachRate:")) data.ar = Number(value) || 0;
      if (line.startsWith("OverallDifficulty:")) data.od = Number(value) || 0;
    } else if (section === "[Metadata]") {
      if (line.startsWith("TitleUnicode:") && value) data.title = value;
      else if (line.startsWith("Title:") && !data.title) data.title = value;
      if (line.startsWith("ArtistUnicode:") && value) data.artist = value;
      else if (line.startsWith("Artist:") && !data.artist) data.artist = value;
      if (line.startsWith("Creator:")) data.creator = value;
      if (line.startsWith("Version:")) data.version = value;
    } else if (section === "[TimingPoints]") {
      const comma = line.indexOf(","), nextComma = line.indexOf(",", comma + 1);
      const beat = Number(line.slice(comma + 1, nextComma < 0 ? undefined : nextComma));
      if (beat > 0) { timingTotal += 60000 / beat; timingCount++; }
    } else if (section === "[HitObjects]") {
      const parts = line.split(",");
      if (parts.length >= 4) {
        const x = Number(parts[0]), time = Number(parts[2]), type = Number(parts[3]);
        if (!(type & 8) && Number.isFinite(time)) {
          const keyCount = Math.max(1, Math.round(data.cs || 4));
          const column = Math.min(keyCount - 1, Math.floor(x * keyCount / 512));
          noteCount++; if (type & 128) lnCount++;
          if (firstTime === undefined) firstTime = time; lastTime = time;
          const second = Math.floor(time / 1000), inWindow = (windows.get(second) || 0) + 1;
          windows.set(second, inWindow); if (inWindow > peakNps) peakNps = inWindow;
          const previousColumnTime = previousByColumn.get(column);
          if (previousColumnTime !== undefined && time - previousColumnTime <= 180) jacks++;
          previousByColumn.set(column, time);
          if (groupTime === undefined || time !== groupTime) {
            if (groupCount > 1) chordNotes += groupCount;
            groupTime = time; groupCount = 1;
          } else groupCount++;
          if (previousTime !== undefined) {
            const interval = time - previousTime;
            if (interval > 0) {
              intervalCount++; const delta = interval - intervalMean; intervalMean += delta / intervalCount; intervalM2 += delta * (interval - intervalMean);
              if (interval <= 160) streamIntervals++;
            }
          }
          previousTime = time;
        }
      }
    } else if (section === "[Events]" && !data.background) {
      const parts = line.split(",");
      if (parts.length >= 3 && ["0", "background"].includes(parts[0].trim().toLowerCase())) data.background = parts[2].trim().replace(/^"|"$/g, "");
    }
  }
  if (!data.version) return null;
  if (groupCount > 1) chordNotes += groupCount;
  const duration = noteCount > 1 ? ((lastTime || 0) - (firstTime || 0)) / 1000 : 0;
  const deviation = intervalCount ? Math.sqrt(intervalM2 / intervalCount) : 0, keyCount = Math.max(1, Math.round(data.cs || 4));
  data.metrics = { bpm: timingCount ? Math.round(timingTotal / timingCount) : 0, duration: Math.round(duration), noteCount, lnCount, lnPercentage: noteCount ? lnCount / noteCount : 0, averageNps: duration ? noteCount / duration : 0, peakNps, chordPercentage: noteCount ? chordNotes / noteCount : 0, jackDensity: noteCount ? jacks / noteCount : 0, chordjackDensity: noteCount ? chordNotes / noteCount : 0, streamDensity: noteCount ? streamIntervals / noteCount : 0, patternVariability: intervalMean ? Math.min(1, deviation / intervalMean) : 0, keyCount };
  return data;
}

async function mapConcurrent(values, limit, task) {
  const results = new Array(values.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) { const index = cursor++; if (index >= values.length) return; results[index] = await task(values[index], index); }
  }));
  return results;
}

async function loadScanCache() {
  if (scanCache) return scanCache;
  try {
    const saved = JSON.parse(await fsp.readFile(scanCachePath(), "utf8"));
    scanCache = new Map(Object.entries(saved.files || {}));
  } catch { scanCache = new Map(); }
  return scanCache;
}

async function saveScanCache(cache) {
  const target = scanCachePath(), temporary = `${target}.tmp`;
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(temporary, JSON.stringify({ version: 2, files: Object.fromEntries(cache) }));
  await fsp.rename(temporary, target).catch(async () => { await fsp.rm(target, { force: true }); await fsp.rename(temporary, target); });
}

async function listOsuFiles(root) {
  const rootEntries = await fsp.readdir(root, { withFileTypes: true });
  const files = rootEntries.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".osu")).map(entry => path.join(root, entry.name));
  const directories = rootEntries.filter(entry => entry.isDirectory()).map(entry => path.join(root, entry.name));
  const nested = await mapConcurrent(directories, 32, async dir => {
    try { return (await fsp.readdir(dir, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".osu")).map(entry => path.join(dir, entry.name)); }
    catch { return []; }
  });
  return files.concat(...nested);
}

async function scanSongs(folder) {
  if (!folder || !await exists(folder) || !(await fsp.stat(folder)).isDirectory()) throw new Error("Wybrana ścieżka nie jest folderem.");
  const cache = await loadScanCache(), files = await listOsuFiles(folder);
  const descriptors = (await mapConcurrent(files, 64, async file => { try { const stat = await fsp.stat(file); return { file, size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs) }; } catch { return null; } })).filter(Boolean);
  const activeKeys = new Set(descriptors.map(entry => entry.file.toLowerCase()));
  const parsedFiles = await mapConcurrent(descriptors, 24, async entry => {
    const key = entry.file.toLowerCase(), cached = cache.get(key); let parsed;
    if (cached && cached.size === entry.size && cached.mtimeMs === entry.mtimeMs) parsed = cached.parsed;
    else {
      try { parsed = parseOsuText(await fsp.readFile(entry.file, "utf8")); }
      catch { parsed = null; }
      cache.set(key, { size: entry.size, mtimeMs: entry.mtimeMs, parsed });
    }
    return parsed ? { file: entry.file, parsed } : null;
  });
  for (const key of cache.keys()) if (!activeKeys.has(key) && key.startsWith(folder.toLowerCase())) cache.delete(key);
  const grouped = new Map();
  for (const entry of parsedFiles) if (entry) { const dir = path.dirname(entry.file); if (!grouped.has(dir)) grouped.set(dir, []); grouped.get(dir).push(entry); }
  const sets = (await mapConcurrent([...grouped.entries()], 32, async ([dir, entries]) => {
    const difficulties = [], sorted = entries.sort((a, b) => a.file.localeCompare(b.file)); let metadata = null, backgroundPath;
    for (const { file, parsed } of sorted) {
      metadata ||= parsed;
      if (!backgroundPath && parsed.background) { const candidate = path.resolve(dir, parsed.background); if (await exists(candidate)) backgroundPath = candidate; }
      difficulties.push({ id: idFor(file), version: parsed.version, osuPath: file, mode: parsed.mode, audioFilename: parsed.audio || undefined, hp: parsed.hp, cs: parsed.cs, ar: parsed.ar, od: parsed.od, metrics: parsed.metrics });
    }
    return difficulties.length ? { id: idFor(dir), folderPath: dir, folderName: path.basename(dir), artist: metadata.artist || "Unknown artist", title: metadata.title || path.basename(dir), creator: metadata.creator || "Unknown mapper", backgroundPath, difficulties } : null;
  })).filter(Boolean);
  await saveScanCache(cache).catch(() => {});
  return sets.sort((a, b) => a.artist.localeCompare(b.artist, "pl") || a.title.localeCompare(b.title, "pl"));
}

function safeName(input) {
  const value = String(input || "").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim().replace(/[. ]+$/g, "").slice(0, 120);
  return value || "Untitled";
}
function scaleNumber(value, rate) { const n = Number(String(value).trim()); return Number.isFinite(n) ? String(Math.round(n / rate)) : value; }
function scaleAr(value, rate) { const preempt=value<5?1800-120*value:1200-150*(value-5); const scaled=preempt/rate; return Math.max(0,Math.min(10,scaled>1200?(1800-scaled)/120:5+(1200-scaled)/150)); }
function scaleOd(value, rate) { return Math.max(0,Math.min(10,(80-(80-6*value)/rate)/6)); }
function rewriteOsu(text, rate, pitch, newAudio, packName, author, originalCreator, songTitle, customBackground, trainer = {}) {
  let section = "", backgroundWritten = false; const out = [];
  const suffix = `${Math.abs(rate - 1) > .001 ? ` ${rate.toFixed(2)}x` : ""}${Math.abs(pitch) > .001 ? ` ${pitch >= 0 ? "+" : ""}${pitch.toFixed(0)}st` : ""}`;
  for (let source of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (/^\[.+\]$/.test(source)) { section = source; out.push(source); continue; }
    const field = () => source.slice(source.indexOf(":") + 1).trim();
    if (section === "[General]") {
      if (source.startsWith("AudioFilename:") && newAudio) { out.push(`AudioFilename: ${newAudio}`); continue; }
      if (Math.abs(rate - 1) > .001 && (source.startsWith("AudioLeadIn:") || source.startsWith("PreviewTime:"))) { out.push(`${source.slice(0, source.indexOf(":") + 1)} ${scaleNumber(field(), rate)}`); continue; }
    }
    if (section === "[Editor]" && source.startsWith("Bookmarks:") && Math.abs(rate - 1) > .001) { out.push(`Bookmarks: ${field().split(",").map(v => scaleNumber(v, rate)).join(",")}`); continue; }
    if (section === "[Metadata]") {
      if (source.startsWith("Title:") || source.startsWith("TitleUnicode:")) { out.push(`${source.slice(0, source.indexOf(":") + 1)}${packName}`); continue; }
      if (source.startsWith("Creator:")) { out.push(`Creator:${author}`); continue; }
      if (source.startsWith("BeatmapID:")) { out.push("BeatmapID:0"); continue; }
      if (source.startsWith("BeatmapSetID:")) { out.push("BeatmapSetID:-1"); continue; }
      if (source.startsWith("Version:")) { out.push(`Version:(${originalCreator}) ${songTitle} - ${field()}${suffix}`); continue; }
    }
    if (section === "[Difficulty]") {
      if (source.startsWith("HPDrainRate:") && Number.isFinite(trainer.hp)) { out.push(`HPDrainRate:${trainer.hp}`); continue; }
      if (source.startsWith("CircleSize:") && Number.isFinite(trainer.cs)) { out.push(`CircleSize:${Math.min(10,trainer.hrCircleSize?trainer.cs*1.3:trainer.cs)}`); continue; }
      if (source.startsWith("ApproachRate:") && Number.isFinite(trainer.ar)) { out.push(`ApproachRate:${trainer.scaleAr?scaleAr(trainer.ar,rate):trainer.ar}`); continue; }
      if (source.startsWith("OverallDifficulty:") && Number.isFinite(trainer.od)) { out.push(`OverallDifficulty:${trainer.scaleOd?scaleOd(trainer.od,rate):trainer.od}`); continue; }
    }
    if (section === "[TimingPoints]" && source && !source.startsWith("//") && Math.abs(rate - 1) > .001) {
      const parts = source.split(","); parts[0] = scaleNumber(parts[0], rate); const beat = Number(parts[1]); if (beat > 0) parts[1] = String(beat / rate); out.push(parts.join(",")); continue;
    }
    if (section === "[HitObjects]" && source && (Math.abs(rate - 1) > .001 || trainer.noSpinners)) {
      const parts = source.split(",");
      if (trainer.noSpinners && (Number(parts[3]) & 8)) continue;
      if (Math.abs(rate - 1) > .001 && parts.length > 2) parts[2] = scaleNumber(parts[2], rate);
      if (parts.length > 5) { const [end, ...rest] = parts[5].split(":"); if (Number.isFinite(Number(end))) parts[5] = [scaleNumber(end, rate), ...rest].join(":"); }
      out.push(parts.join(",")); continue;
    }
    if (section === "[Events]" && Math.abs(rate - 1) > .001) {
      const parts = source.split(","); const kind = (parts[0] || "").trim().toLowerCase();
      if (parts.length > 2 && ["2", "break"].includes(kind)) { parts[1] = scaleNumber(parts[1], rate); parts[2] = scaleNumber(parts[2], rate); out.push(parts.join(",")); continue; }
      if (parts.length > 1 && ["1", "video"].includes(kind)) { parts[1] = scaleNumber(parts[1], rate); out.push(parts.join(",")); continue; }
    }
    if (section === "[Events]" && customBackground && /^(?:0|background)\s*,/i.test(source.trim())) { out.push(`0,0,"${customBackground}",0,0`); backgroundWritten = true; continue; }
    out.push(source);
  }
  if (customBackground && !backgroundWritten) { const index = out.findIndex(line => line.trim() === "[Events]"); if (index >= 0) out.splice(index + 1, 0, `0,0,"${customBackground}",0,0`); }
  return out.join("\r\n");
}
function tempoChain(value) { const parts = []; while (value > 2) { parts.push("atempo=2"); value /= 2; } while (value < .5) { parts.push("atempo=.5"); value /= .5; } parts.push(`atempo=${value.toFixed(8)}`); return parts.join(","); }
function ffmpegPath(custom) {
  if (custom && fs.existsSync(custom)) return custom;
  if (!bundledFfmpeg) throw new Error("Nie znaleziono dołączonego FFmpeg.");
  return bundledFfmpeg.replace("app.asar", "app.asar.unpacked");
}
function transformAudio(input, output, rate, semitones, custom, highQuality = false) {
  return new Promise((resolve, reject) => {
    const pitch = Math.pow(2, semitones / 12); const filter = `aresample=48000,asetrate=48000*${pitch},aresample=48000,${tempoChain(rate / pitch)}`;
    const quality = highQuality ? "8" : "5";
    const process = spawn(ffmpegPath(custom), ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vn", "-filter:a", filter, "-c:a", "libvorbis", "-q:a", quality, output], { windowsHide: true });
    let error = ""; process.stderr.on("data", chunk => error += chunk); process.on("error", reject); process.on("close", code => code === 0 ? resolve() : reject(new Error(`FFmpeg: ${error.trim() || `kod ${code}`}`)));
  });
}
function transformAudioPreview(input, output, rate, semitones, startSeconds = 0) {
  return new Promise((resolve,reject)=>{
    const pitch=Math.pow(2,semitones/12), filter=`aresample=48000,asetrate=48000*${pitch},aresample=48000,${tempoChain(rate/pitch)}`;
    const process=spawn(ffmpegPath(),["-hide_banner","-loglevel","error","-y","-ss",String(Math.max(0,startSeconds)),"-i",input,"-t","25","-vn","-filter:a",filter,"-c:a","libvorbis","-q:a","4",output],{windowsHide:true});
    let error="";process.stderr.on("data",chunk=>error+=chunk);process.on("error",reject);process.on("close",code=>code===0?resolve():reject(new Error(`Podgląd audio: ${error.trim()||`kod ${code}`}`)));
  });
}
async function createAudioPreview(item) {
  if(!item?.osuPath||!item?.folderPath||!Number.isFinite(item.rate)||item.rate<.1||item.rate>3)throw new Error("Nieprawidłowe dane podglądu audio.");
  const text=await fsp.readFile(item.osuPath,"utf8"), references=selectedAssetReferences(text), source=resolveMapAsset(item.folderPath,references.audio);
  if(!source||!await exists(source))throw new Error("Nie znaleziono audio wybranej mapy.");
  const previewMs=Number(text.match(/^PreviewTime:\s*(-?\d+)/mi)?.[1]||0), start=previewMs>0?previewMs/1000:Math.max(0,Number(text.match(/^\d+,\d+,(\d+),/m)?.[1]||0)/1000-3);
  const autoPitch=item.trainer?.changePitch?12*Math.log2(item.rate):0, pitch=Number(item.pitch||0)+autoPitch, key=idFor(`${item.osuPath}|${item.rate}|${pitch}|${start}`), folder=path.join(app.getPath("temp"),"osu-pack-audio-preview"), output=path.join(folder,`${key}.ogg`);
  await fsp.mkdir(folder,{recursive:true}); if(!await exists(output))await transformAudioPreview(source,output,item.rate,pitch,start);
  return pathToFileURL(output).href;
}
function transformBackground(input, output, effects, custom, overlay) {
  return new Promise((resolve, reject) => {
    const e = effects || {}, filters = [];
    const brightness = Math.max(-1, Math.min(1, (Number(e.brightness ?? 1) - 1))), contrast = Math.max(0, Math.min(2, Number(e.contrast ?? 1))), saturation = Math.max(0, Math.min(3, Number(e.saturation ?? 1)));
    filters.push(`eq=brightness=${brightness.toFixed(3)}:contrast=${contrast.toFixed(3)}:saturation=${saturation.toFixed(3)}`);
    if (Number(e.hue)) filters.push(`hue=h=${Math.max(-180, Math.min(180, Number(e.hue))).toFixed(1)}`);
    if (Number(e.blur) > 0) filters.push(`boxblur=${Math.max(.1,Math.min(12,Number(e.blur))).toFixed(1)}:1`);
    if (Number(e.pixelate) > 0) { const factor=Math.max(2,Math.min(24,Math.round(Number(e.pixelate)))); filters.push(`scale=trunc(iw/${factor}):trunc(ih/${factor}):flags=neighbor`,`scale=iw*${factor}:ih*${factor}:flags=neighbor`); }
    if (Number(e.sharpen) > 0) filters.push(`unsharp=5:5:${Math.max(0,Math.min(2,Number(e.sharpen))).toFixed(2)}`);
    if (Number(e.sepia) > 0) { const s=Math.max(0,Math.min(1,Number(e.sepia))), c=(base,tint)=>(base*(1-s)+tint*s).toFixed(3); filters.push(`colorchannelmixer=${c(1,.393)}:${c(0,.769)}:${c(0,.189)}:0:${c(0,.349)}:${c(1,.686)}:${c(0,.168)}:0:${c(0,.272)}:${c(0,.534)}:${c(1,.131)}:0:0:0:0:1`); }
    if (e.invert) filters.push("negate");
    if (Number(e.vignette) > 0) filters.push(`vignette=PI/${Math.max(2,12-Number(e.vignette)*8).toFixed(1)}`);
    const noise=Math.max(0,Math.min(30,Number(e.grain||0)+Number(e.glitch||0))); if(noise>0)filters.push(`noise=alls=${noise.toFixed(0)}:allf=u`);
    if (Number(e.glitch) > 0) { const amount=Math.max(1,Math.min(20,Number(e.glitch))); filters.push(`chromashift=cbh=${Math.round(amount/2)}:crh=-${Math.round(amount/2)}`); }
    const args=["-hide_banner","-loglevel","error","-y","-i",input];
    if(overlay){const opacity=Math.max(0,Math.min(1,Number(e.overlayOpacity??.8))),scale=Math.max(.05,Math.min(1,Number(e.overlayScale??.3))),x=Math.max(0,Math.min(1,Number(e.overlayX??.5))),y=Math.max(0,Math.min(1,Number(e.overlayY??.5)));args.push("-i",overlay,"-filter_complex",`[0:v]${filters.join(",")}[base];[1:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)}[raw];[raw][base]scale2ref=w=main_w*${scale.toFixed(3)}:h=ow/mdar[over][bg];[bg][over]overlay=x=(main_w-overlay_w)*${x.toFixed(3)}:y=(main_h-overlay_h)*${y.toFixed(3)}[out]`,"-map","[out]")}
    else args.push("-vf",filters.join(","));
    args.push("-frames:v","1",output);
    const process = spawn(ffmpegPath(custom), args, { windowsHide:true });
    let error=""; process.stderr.on("data",chunk=>error+=chunk); process.on("error",reject); process.on("close",code=>code===0?resolve():reject(new Error(`Efekt backgroundu: ${error.trim()||`kod ${code}`}`)));
  });
}
function selectedAssetReferences(text) {
  const audio = text.match(/^AudioFilename:\s*(.+)$/mi)?.[1]?.trim().replace(/^"|"$/g, "");
  const background = text.match(/^(?:0|Background)\s*,\s*[^,]*,\s*"([^"]+)"/mi)?.[1]?.trim();
  return { audio, background };
}
function resolveMapAsset(folder, reference) {
  if (!reference) return null;
  const root = path.resolve(folder), resolved = path.resolve(root, reference.replace(/\//g, path.sep)), relative = path.relative(root, resolved);
  return relative.startsWith("..") || path.isAbsolute(relative) ? null : resolved;
}
async function zipFolder(source, output) {
  await new Promise((resolve, reject) => { const stream = fs.createWriteStream(output); const zip = archiver("zip", { zlib: { level: 7 } }); stream.on("close", resolve); stream.on("error", reject); zip.on("error", reject); zip.pipe(stream); zip.directory(source, false); zip.finalize(); });
}
async function estimatePackSize(items) {
  if (!Array.isArray(items) || !items.length) return 0;
  let bytes = 0;
  for (const item of items) {
    try {
      const text = await fsp.readFile(item.osuPath,"utf8"), references = selectedAssetReferences(text);
      const files = [item.osuPath, resolveMapAsset(item.folderPath,references.audio), item.customBackgroundPath || resolveMapAsset(item.folderPath,references.background),item.backgroundOverlayPath].filter(Boolean);
      for (const file of files) try { bytes += (await fsp.stat(file)).size; } catch {}
    } catch {}
  }
  return Math.round(bytes * .98);
}
async function generatePack(request) {
  if (!request.packName?.trim() || !request.items?.length) throw new Error("Podaj nazwę i dodaj co najmniej jedną mapę.");
  if (!request.author?.trim()) throw new Error("Podaj autora paczki — zostanie zapisany jako mapper wszystkich map.");
  if (!await exists(request.outputFolder)) throw new Error("Folder docelowy nie istnieje.");
  for (const item of request.items) if (!Number.isFinite(item.rate) || item.rate < .1 || item.rate > 3) throw new Error(`Nieprawidłowy rate dla ${item.difficulty}.`);
  const output = path.join(request.outputFolder, `${safeName(request.packName.trim())}.osz`);
  const mapsets = new Set(request.items.map(item=>item.setId)).size;
  const work = await fsp.mkdtemp(path.join(app.getPath("temp"), "osu-pack-"));
  try {
    for (let index=0; index<request.items.length; index++) {
      const item=request.items[index], prefix=`m${String(index+1).padStart(3,"0")}`, originalText=await fsp.readFile(item.osuPath,"utf8"), references=selectedAssetReferences(originalText);
      const sourceAudio=resolveMapAsset(item.folderPath,references.audio); if(!sourceAudio||!await exists(sourceAudio)) throw new Error(`Nie znaleziono audio dla ${item.difficulty}.`);
      const autoPitch=item.trainer?.changePitch?12*Math.log2(item.rate):0, finalPitch=item.pitch+autoPitch, changed=Math.abs(item.rate-1)>.001||Math.abs(finalPitch)>.001;
      let generatedAudio;
      if(changed){const sign=finalPitch<0?"m":"p";generatedAudio=`${prefix}_audio_${item.rate.toFixed(1)}x_${sign}${Math.abs(finalPitch).toFixed(1)}st.ogg`;await transformAudio(sourceAudio,path.join(work,generatedAudio),item.rate,finalPitch,request.ffmpegPath,item.trainer?.highQuality)}
      else {const extension=path.extname(sourceAudio).toLowerCase()||".mp3";generatedAudio=`${prefix}_audio${extension}`;await fsp.copyFile(sourceAudio,path.join(work,generatedAudio))}
      const originalBackground=resolveMapAsset(item.folderPath,references.background), backgroundSource=item.customBackgroundPath||originalBackground, effects=item.backgroundEffects;
      const overlay=item.backgroundOverlayPath&&await exists(item.backgroundOverlayPath)?item.backgroundOverlayPath:null;
      const hasEffects=effects&&[Math.abs((effects.brightness??1)-1),Math.abs((effects.contrast??1)-1),Math.abs((effects.saturation??1)-1),Math.abs(effects.blur||0),Math.abs(effects.hue||0),Math.abs(effects.vignette||0),Math.abs(effects.glitch||0),Math.abs(effects.grain||0),Math.abs(effects.sharpen||0),Math.abs(effects.pixelate||0),Math.abs(effects.sepia||0),effects.invert?1:0].some(value=>value>.001);
      let generatedBackground;
      if(backgroundSource&&await exists(backgroundSource)){const extension=(hasEffects||overlay)?".png":(path.extname(backgroundSource).toLowerCase()||".jpg");generatedBackground=`${prefix}_background${extension}`;if(hasEffects||overlay)await transformBackground(backgroundSource,path.join(work,generatedBackground),effects,request.ffmpegPath,overlay);else await fsp.copyFile(backgroundSource,path.join(work,generatedBackground))}
      const exportedDifficulty=`(${item.creator}) ${item.title} - ${item.difficulty}`, filename=`${prefix}_${safeName(item.artist)} - ${safeName(item.title)} [${safeName(exportedDifficulty+(changed?` ${item.rate.toFixed(1)}x ${item.pitch>=0?"+":""}${item.pitch}st`:""))}].osu`;
      const rewritten=rewriteOsu(originalText,item.rate,finalPitch,generatedAudio,request.packName.trim(),request.author.trim(),item.creator,item.title,generatedBackground,item.trainer);
      await fsp.writeFile(path.join(work,filename),rewritten,"utf8");
    }
    await zipFolder(work, output);
  } finally { await fsp.rm(work, { recursive: true, force: true }); }
  return { outputPath: output, mapsets, difficulties: request.items.length, warnings: [] };
}
