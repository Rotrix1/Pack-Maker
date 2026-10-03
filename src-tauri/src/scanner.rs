use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
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
    pub background_path: Option<String>,
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

fn value(line: &str) -> Option<&str> {
    line.split_once(':').map(|(_, v)| v.trim())
}

fn parse_osu(path: &Path) -> Result<ParsedOsu, String> {
    let raw = fs::read(path).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&raw);
    let mut parsed = ParsedOsu::default();
    let mut section = "";
    for line in text.lines() {
        let line = line.trim().trim_start_matches('\u{feff}');
        if line.starts_with('[') && line.ends_with(']') {
            section = line;
            continue;
        }
        match section {
            "[General]" => {
                if line.starts_with("AudioFilename:") {
                    parsed.audio = value(line).map(str::to_owned);
                }
                if line.starts_with("Mode:") {
                    parsed.mode = value(line).and_then(|v| v.parse().ok()).unwrap_or(0);
                }
            }
            "[Metadata]" => {
                if line.starts_with("TitleUnicode:") {
                    let unicode_title = value(line).unwrap_or("").trim();
                    if !unicode_title.is_empty() {
                        parsed.title = unicode_title.to_owned();
                    }
                }
                if line.starts_with("Title:") && parsed.title.is_empty() {
                    parsed.title = value(line).unwrap_or("").to_owned();
                }
                if line.starts_with("ArtistUnicode:") {
                    let unicode_artist = value(line).unwrap_or("").trim();
                    if !unicode_artist.is_empty() {
                        parsed.artist = unicode_artist.to_owned();
                    }
                }
                if line.starts_with("Artist:") && parsed.artist.is_empty() {
                    parsed.artist = value(line).unwrap_or("").to_owned();
                }
                if line.starts_with("Creator:") {
                    parsed.creator = value(line).unwrap_or("").to_owned();
                }
                if line.starts_with("Version:") {
                    parsed.version = value(line).unwrap_or("").to_owned();
                }
            }
            "[Events]" if parsed.background.is_none() => {
                let fields: Vec<&str> = line.split(',').collect();
                if fields.len() >= 3
                    && (fields[0].trim() == "0"
                        || fields[0].trim().eq_ignore_ascii_case("Background"))
                {
                    parsed.background = Some(fields[2].trim().trim_matches('"').to_owned());
                }
            }
            _ => {}
        }
    }
    if parsed.version.is_empty() {
        return Err("Brak nazwy difficulty".into());
    }
    Ok(parsed)
}

fn stable_id(path: &Path) -> String {
    Uuid::new_v5(&Uuid::NAMESPACE_URL, path.to_string_lossy().as_bytes()).to_string()
}

fn usable_background(folder: &Path, name: Option<&String>) -> Option<PathBuf> {
    let requested = name.map(|value| folder.join(value)).filter(|path| path.is_file());
    if requested.as_ref().is_some_and(|path| path.extension().and_then(|x| x.to_str()).is_some_and(|x| !x.eq_ignore_ascii_case("svg"))) {
        return requested;
    }
    WalkDir::new(folder).max_depth(1).into_iter().filter_map(Result::ok).map(|entry| entry.into_path()).find(|path| {
        path.is_file() && path.extension().and_then(|x| x.to_str()).is_some_and(|x| matches!(x.to_ascii_lowercase().as_str(), "jpg" | "jpeg" | "png" | "webp" | "bmp"))
    }).or(requested)
}

fn scan_songs_folder_inner(path: String) -> Result<Vec<BeatmapSet>, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err("Wybrana ścieżka nie jest folderem.".into());
    }
    let mut grouped: std::collections::BTreeMap<PathBuf, Vec<PathBuf>> =
        std::collections::BTreeMap::new();
    for entry in WalkDir::new(&root)
        .min_depth(1)
        .max_depth(2)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        let p = entry.path();
        if p.is_file()
            && p.extension()
                .and_then(|x| x.to_str())
                .is_some_and(|x| x.eq_ignore_ascii_case("osu"))
        {
            if let Some(parent) = p.parent() {
                grouped
                    .entry(parent.to_owned())
                    .or_default()
                    .push(p.to_owned());
            }
        }
    }
    let mut sets = Vec::with_capacity(grouped.len());
    for (folder, mut files) in grouped {
        files.sort();
        let mut difficulties = Vec::new();
        let mut artist = String::new();
        let mut title = String::new();
        let mut creator = String::new();
        let mut background = None;
        for file in files {
            if let Ok(p) = parse_osu(&file) {
                // Pack Studio creates osu!mania packs. Ignoring other modes makes
                // scans substantially smaller in large Songs folders and prevents
                // irrelevant maps from reaching the UI.
                if p.mode != 3 {
                    continue;
                }
                if artist.is_empty() {
                    artist = p.artist.clone();
                    title = p.title.clone();
                    creator = p.creator.clone();
                }
                if background.is_none() {
                    background = usable_background(&folder, p.background.as_ref()).map(|x| x.to_string_lossy().into_owned());
                }
                let difficulty_background = usable_background(&folder, p.background.as_ref()).map(|x| x.to_string_lossy().into_owned());
                difficulties.push(Difficulty {
                    id: stable_id(&file),
                    version: p.version,
                    osu_path: file.to_string_lossy().into_owned(),
                    mode: p.mode,
                    stars: None,
                    audio_filename: p.audio,
                    background_path: difficulty_background,
                });
            }
        }
        if !difficulties.is_empty() {
            sets.push(BeatmapSet {
                id: stable_id(&folder),
                folder_path: folder.to_string_lossy().into_owned(),
                folder_name: folder
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                artist: if artist.is_empty() {
                    "Unknown artist".into()
                } else {
                    artist
                },
                title: if title.is_empty() {
                    folder
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned()
                } else {
                    title
                },
                creator: if creator.is_empty() {
                    "Unknown mapper".into()
                } else {
                    creator
                },
                background_path: background,
                difficulties,
            });
        }
    }
    sets.sort_by(|a, b| {
        a.artist
            .to_lowercase()
            .cmp(&b.artist.to_lowercase())
            .then(a.title.to_lowercase().cmp(&b.title.to_lowercase()))
    });
    Ok(sets)
}

#[tauri::command]
pub async fn scan_songs_folder(path: String) -> Result<Vec<BeatmapSet>, String> {
    tauri::async_runtime::spawn_blocking(move || scan_songs_folder_inner(path))
        .await
        .map_err(|error| format!("Skanowanie zostało przerwane: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_non_empty_unicode_metadata() {
        let file = tempfile::NamedTempFile::new().unwrap();
        fs::write(
            file.path(),
            "[General]\nMode:3\n[Metadata]\nArtist:Artist\nArtistUnicode:Artysta\nTitle:Title\nTitleUnicode:Tytuł\nCreator:Mapper\nVersion:Hard",
        )
        .unwrap();

        let parsed = parse_osu(file.path()).unwrap();

        assert_eq!(parsed.artist, "Artysta");
        assert_eq!(parsed.title, "Tytuł");
    }

    #[test]
    fn keeps_regular_metadata_when_unicode_fields_are_empty() {
        let file = tempfile::NamedTempFile::new().unwrap();
        fs::write(
            file.path(),
            "[Metadata]\nArtist:Artist\nArtistUnicode:  \nTitle:Title\nTitleUnicode:\nCreator:Mapper\nVersion:Hard",
        )
        .unwrap();

        let parsed = parse_osu(file.path()).unwrap();

        assert_eq!(parsed.artist, "Artist");
        assert_eq!(parsed.title, "Title");
    }
}
