use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}};
use uuid::Uuid;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Difficulty {
    pub id: String,
    pub version: String,
    pub osu_path: String,
    pub mode: u8,
    pub stars: Option<f32>,
    pub audio_filename: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeatmapSet {
    pub id: String,
    pub folder_path: String,
    pub folder_name: String,
    pub artist: String,
    pub title: String,
    pub creator: String,
    pub background_path: Option<String>,
    pub difficulties: Vec<Difficulty>,
}

#[derive(Default)]
struct ParsedOsu {
    artist: String,
    title: String,
    creator: String,
    version: String,
    audio: Option<String>,
    background: Option<String>,
    mode: u8,
}

fn value(line: &str) -> Option<&str> { line.split_once(':').map(|(_, v)| v.trim()) }

fn parse_osu(path: &Path) -> Result<ParsedOsu, String> {
    let raw = fs::read(path).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&raw);
    let mut parsed = ParsedOsu::default();
    let mut section = "";
    for line in text.lines() {
        let line = line.trim().trim_start_matches('\u{feff}');
        if line.starts_with('[') && line.ends_with(']') { section = line; continue; }
        match section {
            "[General]" => {
                if line.starts_with("AudioFilename:") { parsed.audio = value(line).map(str::to_owned); }
                if line.starts_with("Mode:") { parsed.mode = value(line).and_then(|v| v.parse().ok()).unwrap_or(0); }
            }
            "[Metadata]" => {
                if line.starts_with("TitleUnicode:") && parsed.title.is_empty() { parsed.title = value(line).unwrap_or("").to_owned(); }
                if line.starts_with("Title:") && parsed.title.is_empty() { parsed.title = value(line).unwrap_or("").to_owned(); }
                if line.starts_with("ArtistUnicode:") && parsed.artist.is_empty() { parsed.artist = value(line).unwrap_or("").to_owned(); }
                if line.starts_with("Artist:") && parsed.artist.is_empty() { parsed.artist = value(line).unwrap_or("").to_owned(); }
                if line.starts_with("Creator:") { parsed.creator = value(line).unwrap_or("").to_owned(); }
                if line.starts_with("Version:") { parsed.version = value(line).unwrap_or("").to_owned(); }
            }
            "[Events]" if parsed.background.is_none() => {
                let fields: Vec<&str> = line.split(',').collect();
                if fields.len() >= 3 && (fields[0].trim() == "0" || fields[0].trim().eq_ignore_ascii_case("Background")) {
                    parsed.background = Some(fields[2].trim().trim_matches('"').to_owned());
                }
            }
            _ => {}
        }
    }
    if parsed.version.is_empty() { return Err("Brak nazwy difficulty".into()); }
    Ok(parsed)
}

fn stable_id(path: &Path) -> String {
    Uuid::new_v5(&Uuid::NAMESPACE_URL, path.to_string_lossy().as_bytes()).to_string()
}

#[tauri::command]
pub fn scan_songs_folder(path: String) -> Result<Vec<BeatmapSet>, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() { return Err("Wybrana ścieżka nie jest folderem.".into()); }
    let mut grouped: std::collections::BTreeMap<PathBuf, Vec<PathBuf>> = std::collections::BTreeMap::new();
    for entry in WalkDir::new(&root).min_depth(1).max_depth(2).follow_links(false).into_iter().filter_map(Result::ok) {
        let p = entry.path();
        if p.is_file() && p.extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("osu")) {
            if let Some(parent) = p.parent() { grouped.entry(parent.to_owned()).or_default().push(p.to_owned()); }
        }
    }
    let mut sets = Vec::with_capacity(grouped.len());
    for (folder, mut files) in grouped {
        files.sort();
        let mut difficulties = Vec::new();
        let mut artist = String::new(); let mut title = String::new(); let mut creator = String::new(); let mut background = None;
        for file in files {
            if let Ok(p) = parse_osu(&file) {
                if artist.is_empty() { artist = p.artist.clone(); title = p.title.clone(); creator = p.creator.clone(); }
                if background.is_none() { background = p.background.as_ref().map(|x| folder.join(x)).filter(|x| x.is_file()).map(|x| x.to_string_lossy().into_owned()); }
                difficulties.push(Difficulty { id: stable_id(&file), version: p.version, osu_path: file.to_string_lossy().into_owned(), mode: p.mode, stars: None, audio_filename: p.audio });
            }
        }
        if !difficulties.is_empty() {
            sets.push(BeatmapSet {
                id: stable_id(&folder), folder_path: folder.to_string_lossy().into_owned(), folder_name: folder.file_name().unwrap_or_default().to_string_lossy().into_owned(),
                artist: if artist.is_empty() { "Unknown artist".into() } else { artist }, title: if title.is_empty() { folder.file_name().unwrap_or_default().to_string_lossy().into_owned() } else { title },
                creator: if creator.is_empty() { "Unknown mapper".into() } else { creator }, background_path: background, difficulties,
            });
        }
    }
    sets.sort_by(|a,b| a.artist.to_lowercase().cmp(&b.artist.to_lowercase()).then(a.title.to_lowercase().cmp(&b.title.to_lowercase())));
    Ok(sets)
}
