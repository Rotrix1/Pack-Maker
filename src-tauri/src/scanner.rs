use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;
use walkdir::WalkDir;

const CACHE_VERSION: u32 = 1;
const BATCH_SIZE: usize = 10;
const MAX_SCAN_WORKERS: usize = 4;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct FileFingerprint {
    path: String,
    size: u64,
    modified_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedFolder {
    folder_path: String,
    sources: Vec<FileFingerprint>,
    set: Option<BeatmapSet>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LibraryCache {
    version: u32,
    songs_folder: String,
    completed_at_ms: u64,
    folders: Vec<CachedFolder>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanBatch {
    pub scan_id: String,
    pub sets: Vec<BeatmapSet>,
    pub processed_folders: usize,
    pub total_folders: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanComplete {
    pub scan_id: String,
    pub total_sets: usize,
    pub processed_folders: usize,
    pub total_folders: usize,
    pub active_set_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanError {
    scan_id: String,
    message: String,
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

#[derive(Clone)]
struct FolderSnapshot {
    folder: PathBuf,
    osu_files: Vec<PathBuf>,
    images: Vec<PathBuf>,
    sources: Vec<FileFingerprint>,
}

fn value(line: &str) -> Option<&str> {
    line.split_once(':').map(|(_, value)| value.trim())
}

fn parse_osu(path: &Path) -> Result<ParsedOsu, String> {
    let raw = fs::read(path).map_err(|error| error.to_string())?;
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
                    parsed.mode = value(line)
                        .and_then(|value| value.parse().ok())
                        .unwrap_or(0);
                }
            }
            "[Metadata]" => {
                if line.starts_with("TitleUnicode:") {
                    let title = value(line).unwrap_or("").trim();
                    if !title.is_empty() {
                        parsed.title = title.to_owned();
                    }
                }
                if line.starts_with("Title:") && parsed.title.is_empty() {
                    parsed.title = value(line).unwrap_or("").to_owned();
                }
                if line.starts_with("ArtistUnicode:") {
                    let artist = value(line).unwrap_or("").trim();
                    if !artist.is_empty() {
                        parsed.artist = artist.to_owned();
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
        return Err("Missing difficulty name".into());
    }
    Ok(parsed)
}

fn stable_id(path: &Path) -> String {
    Uuid::new_v5(&Uuid::NAMESPACE_URL, path.to_string_lossy().as_bytes()).to_string()
}

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "jpg" | "jpeg" | "png" | "webp" | "bmp"
            )
        })
}

fn modified_ms(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn fingerprint(path: &Path) -> Option<FileFingerprint> {
    let metadata = fs::metadata(path).ok()?;
    Some(FileFingerprint {
        path: path.to_string_lossy().into_owned(),
        size: metadata.len(),
        modified_ms: metadata.modified().map(modified_ms).unwrap_or_default(),
    })
}

fn usable_background(folder: &Path, images: &[PathBuf], name: Option<&String>) -> Option<PathBuf> {
    let requested = name
        .map(|value| folder.join(value))
        .filter(|path| path.is_file() && is_image(path));
    requested.or_else(|| images.first().cloned())
}

fn cached_backgrounds_are_usable(cached: &CachedFolder, folder_images: &[PathBuf]) -> bool {
    let Some(set) = &cached.set else {
        return true;
    };
    // Older cache entries can have no resolved path even when an image is present.
    // Do not keep those incomplete entries: the generator can resolve the image,
    // so the library/Dan preview must be refreshed to use the same one.
    if !folder_images.is_empty()
        && set
            .difficulties
            .iter()
            .any(|difficulty| difficulty.background_path.is_none())
    {
        return false;
    }
    set.background_path
        .iter()
        .chain(
            set.difficulties
                .iter()
                .filter_map(|difficulty| difficulty.background_path.as_ref()),
        )
        .all(|path| Path::new(path).is_file() && is_image(Path::new(path)))
}

fn build_snapshots(root: &Path) -> Result<Vec<FolderSnapshot>, String> {
    if !root.is_dir() {
        return Err("Selected path is not a folder.".into());
    }
    let mut grouped: BTreeMap<PathBuf, (Vec<PathBuf>, Vec<PathBuf>)> = BTreeMap::new();
    for entry in WalkDir::new(root)
        .min_depth(1)
        .max_depth(2)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let is_osu = path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("osu"));
        if !is_osu && !is_image(path) {
            continue;
        }
        if let Some(folder) = path.parent() {
            let files = grouped.entry(folder.to_owned()).or_default();
            if is_osu {
                files.0.push(path.to_owned());
            } else {
                files.1.push(path.to_owned());
            }
        }
    }
    Ok(grouped
        .into_iter()
        .filter_map(|(folder, (mut osu_files, mut images))| {
            if osu_files.is_empty() {
                return None;
            }
            osu_files.sort();
            images.sort();
            let mut sources = osu_files
                .iter()
                .chain(images.iter())
                .filter_map(|path| fingerprint(path))
                .collect::<Vec<_>>();
            sources.sort_by(|left, right| left.path.cmp(&right.path));
            Some(FolderSnapshot {
                folder,
                osu_files,
                images,
                sources,
            })
        })
        .collect())
}

fn parse_folder(snapshot: FolderSnapshot, cached: Option<&CachedFolder>) -> CachedFolder {
    if let Some(cached) = cached {
        if cached.sources == snapshot.sources
            && cached_backgrounds_are_usable(cached, &snapshot.images)
        {
            return cached.clone();
        }
    }
    let mut difficulties = Vec::new();
    let mut artist = String::new();
    let mut title = String::new();
    let mut creator = String::new();
    let mut background = None;
    for file in &snapshot.osu_files {
        let Ok(parsed) = parse_osu(file) else {
            continue;
        };
        if parsed.mode != 3 {
            continue;
        }
        if artist.is_empty() {
            artist = parsed.artist.clone();
            title = parsed.title.clone();
            creator = parsed.creator.clone();
        }
        let difficulty_background = usable_background(
            &snapshot.folder,
            &snapshot.images,
            parsed.background.as_ref(),
        )
        .map(|path| path.to_string_lossy().into_owned());
        if background.is_none() {
            background = difficulty_background.clone();
        }
        difficulties.push(Difficulty {
            id: stable_id(file),
            version: parsed.version,
            osu_path: file.to_string_lossy().into_owned(),
            mode: parsed.mode,
            stars: None,
            audio_filename: parsed.audio,
            background_path: difficulty_background,
        });
    }
    let set = (!difficulties.is_empty()).then(|| BeatmapSet {
        id: stable_id(&snapshot.folder),
        folder_path: snapshot.folder.to_string_lossy().into_owned(),
        folder_name: snapshot
            .folder
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
            snapshot
                .folder
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
    CachedFolder {
        folder_path: snapshot.folder.to_string_lossy().into_owned(),
        sources: snapshot.sources,
        set,
    }
}

fn normalized_path(path: &str) -> String {
    fs::canonicalize(path)
        .unwrap_or_else(|_| PathBuf::from(path))
        .to_string_lossy()
        .into_owned()
}

fn cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create app-data directory: {error}"))?;
    Ok(dir.join("library-cache.json"))
}

fn temporary_cache_path(path: &Path) -> PathBuf {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    path.with_file_name(format!("{name}.tmp"))
}

fn write_atomically(path: &Path, data: &[u8]) -> Result<(), String> {
    let temporary = temporary_cache_path(path);
    let mut file = fs::File::create(&temporary)
        .map_err(|error| format!("Could not create temporary library cache: {error}"))?;
    file.write_all(data)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Could not write temporary library cache: {error}"))?;
    fs::rename(&temporary, path).map_err(|error| {
        format!("Could not replace library cache without losing the previous cache: {error}")
    })
}

fn read_cache(app: &AppHandle) -> Result<Option<LibraryCache>, String> {
    let path = cache_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Could not read library cache: {error}"))?;
    let cache: LibraryCache = match serde_json::from_str::<LibraryCache>(&raw) {
        Ok(cache) if cache.version == CACHE_VERSION => cache,
        Ok(_) | Err(_) => return Ok(None),
    };
    Ok(Some(cache))
}

fn write_cache(app: &AppHandle, cache: &LibraryCache) -> Result<(), String> {
    let data = serde_json::to_string_pretty(cache).map_err(|error| error.to_string())?;
    write_atomically(&cache_path(app)?, data.as_bytes())
}

fn now_ms() -> u64 {
    modified_ms(SystemTime::now())
}

fn sorted_sets(mut sets: Vec<BeatmapSet>) -> Vec<BeatmapSet> {
    sets.sort_by(|left, right| {
        left.artist
            .to_lowercase()
            .cmp(&right.artist.to_lowercase())
            .then(left.title.to_lowercase().cmp(&right.title.to_lowercase()))
    });
    sets
}

fn sets_from_folders(folders: &[CachedFolder]) -> Vec<BeatmapSet> {
    sorted_sets(
        folders
            .iter()
            .filter_map(|folder| folder.set.clone())
            .collect(),
    )
}

#[tauri::command]
pub fn load_library_cache(app: AppHandle, path: String) -> Result<Vec<BeatmapSet>, String> {
    let expected_folder = normalized_path(&path);
    let Some(cache) = read_cache(&app)? else {
        return Ok(Vec::new());
    };
    if cache.songs_folder != expected_folder {
        return Ok(Vec::new());
    }
    Ok(sets_from_folders(&cache.folders))
}

fn scan_library(app: AppHandle, path: String, scan_id: String) -> Result<ScanComplete, String> {
    let songs_folder = normalized_path(&path);
    let snapshots = build_snapshots(Path::new(&songs_folder))?;
    let total_folders = snapshots.len();
    let cached_folders = read_cache(&app)?
        .filter(|cache| cache.songs_folder == songs_folder)
        .map(|cache| {
            cache
                .folders
                .into_iter()
                .map(|folder| (folder.folder_path.clone(), folder))
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default();
    let cached_folders = Arc::new(cached_folders);
    let worker_count = thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(1)
        .clamp(1, MAX_SCAN_WORKERS)
        .min(total_folders.max(1));
    let (job_sender, job_receiver) = mpsc::channel::<FolderSnapshot>();
    let (result_sender, result_receiver) = mpsc::channel::<CachedFolder>();
    let job_receiver = Arc::new(Mutex::new(job_receiver));

    thread::scope(|scope| {
        for _ in 0..worker_count {
            let jobs = Arc::clone(&job_receiver);
            let results = result_sender.clone();
            let cached = Arc::clone(&cached_folders);
            scope.spawn(move || loop {
                let snapshot = match jobs.lock().expect("scan work queue poisoned").recv() {
                    Ok(snapshot) => snapshot,
                    Err(_) => break,
                };
                let key = snapshot.folder.to_string_lossy().into_owned();
                if results
                    .send(parse_folder(snapshot, cached.get(&key)))
                    .is_err()
                {
                    break;
                }
            });
        }
        drop(result_sender);
        for snapshot in snapshots {
            let _ = job_sender.send(snapshot);
        }
        drop(job_sender);

        let mut folders = Vec::with_capacity(total_folders);
        let mut batch = Vec::with_capacity(BATCH_SIZE);
        for processed_folders in 1..=total_folders {
            let folder = result_receiver
                .recv()
                .map_err(|error| format!("Scan worker failed: {error}"))?;
            let changed = cached_folders
                .get(&folder.folder_path)
                .is_none_or(|previous| previous.set != folder.set);
            if changed {
                if let Some(set) = folder.set.clone() {
                    batch.push(set);
                }
            }
            folders.push(folder);
            if batch.len() >= BATCH_SIZE
                || processed_folders % BATCH_SIZE == 0
                || processed_folders == total_folders
            {
                app.emit(
                    "scan:batch",
                    ScanBatch {
                        scan_id: scan_id.clone(),
                        sets: std::mem::take(&mut batch),
                        processed_folders,
                        total_folders,
                    },
                )
                .map_err(|error| error.to_string())?;
            }
        }
        let sets = sets_from_folders(&folders);
        let complete = ScanComplete {
            scan_id: scan_id.clone(),
            total_sets: sets.len(),
            processed_folders: total_folders,
            total_folders,
            active_set_ids: sets.iter().map(|set| set.id.clone()).collect(),
        };
        write_cache(
            &app,
            &LibraryCache {
                version: CACHE_VERSION,
                songs_folder,
                completed_at_ms: now_ms(),
                folders,
            },
        )?;
        app.emit("scan:complete", complete.clone())
            .map_err(|error| error.to_string())?;
        Ok(complete)
    })
}

#[tauri::command]
pub async fn start_library_scan(
    app: AppHandle,
    path: String,
    scan_id: String,
) -> Result<ScanComplete, String> {
    let worker_app = app.clone();
    let worker_scan_id = scan_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        scan_library(worker_app, path, worker_scan_id)
    })
    .await
    .map_err(|error| format!("Library scan was interrupted: {error}"))?;
    if let Err(message) = &result {
        let _ = app.emit(
            "scan:error",
            ScanError {
                scan_id,
                message: message.clone(),
            },
        );
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_non_empty_unicode_metadata() {
        let file = tempfile::NamedTempFile::new().unwrap();
        fs::write(file.path(), "[General]\nMode:3\n[Metadata]\nArtist:Artist\nArtistUnicode:Artysta\nTitle:Title\nTitleUnicode:Tytuł\nCreator:Mapper\nVersion:Hard").unwrap();
        let parsed = parse_osu(file.path()).unwrap();
        assert_eq!(parsed.artist, "Artysta");
        assert_eq!(parsed.title, "Tytuł");
    }

    #[test]
    fn keeps_regular_metadata_when_unicode_fields_are_empty() {
        let file = tempfile::NamedTempFile::new().unwrap();
        fs::write(file.path(), "[Metadata]\nArtist:Artist\nArtistUnicode:  \nTitle:Title\nTitleUnicode:\nCreator:Mapper\nVersion:Hard").unwrap();
        let parsed = parse_osu(file.path()).unwrap();
        assert_eq!(parsed.artist, "Artist");
        assert_eq!(parsed.title, "Title");
    }

    #[test]
    fn uses_requested_image_before_folder_fallback() {
        let temp = tempfile::tempdir().unwrap();
        let requested = temp.path().join("background.png");
        let fallback = temp.path().join("fallback.jpg");
        fs::write(&requested, []).unwrap();
        fs::write(&fallback, []).unwrap();
        assert_eq!(
            usable_background(
                temp.path(),
                &[fallback, requested.clone()],
                Some(&"background.png".into())
            ),
            Some(requested)
        );
    }

    #[test]
    fn cache_version_mismatch_is_not_usable() {
        let cache = LibraryCache {
            version: CACHE_VERSION + 1,
            songs_folder: "Songs".into(),
            completed_at_ms: 0,
            folders: Vec::new(),
        };
        let parsed: LibraryCache =
            serde_json::from_str(&serde_json::to_string(&cache).unwrap()).unwrap();
        assert_ne!(parsed.version, CACHE_VERSION);
    }

    #[test]
    fn unchanged_sources_reuse_cached_folder() {
        let source = FileFingerprint {
            path: "map.osu".into(),
            size: 12,
            modified_ms: 34,
        };
        let cached = CachedFolder {
            folder_path: "folder".into(),
            sources: vec![source.clone()],
            set: None,
        };
        let snapshot = FolderSnapshot {
            folder: PathBuf::from("folder"),
            osu_files: Vec::new(),
            images: Vec::new(),
            sources: vec![source],
        };
        assert_eq!(
            parse_folder(snapshot, Some(&cached)).sources,
            cached.sources
        );
    }

    fn snapshot_for(folder: &Path) -> FolderSnapshot {
        build_snapshots(folder.parent().unwrap())
            .unwrap()
            .into_iter()
            .next()
            .unwrap()
    }

    #[test]
    fn changed_osu_file_invalidates_cached_metadata() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("123 Artist - Title");
        fs::create_dir(&folder).unwrap();
        let osu = folder.join("map.osu");
        fs::write(
            &osu,
            "[General]\nMode:3\n[Metadata]\nArtist:A\nTitle:T\nCreator:C\nVersion:Easy",
        )
        .unwrap();
        let first = snapshot_for(&folder);
        let cached = parse_folder(first, None);

        fs::write(
            &osu,
            "[General]\nMode:3\n[Metadata]\nArtist:A\nTitle:T\nCreator:C\nVersion:Insane",
        )
        .unwrap();
        let changed = snapshot_for(&folder);
        assert_ne!(cached.sources, changed.sources);
        let updated = parse_folder(changed, Some(&cached));
        assert_eq!(updated.set.unwrap().difficulties[0].version, "Insane");
    }

    #[test]
    fn ignores_non_mania_maps_and_keeps_stable_ids() {
        let root = tempfile::tempdir().unwrap();
        let mania_folder = root.path().join("mania");
        let standard_folder = root.path().join("standard");
        fs::create_dir(&mania_folder).unwrap();
        fs::create_dir(&standard_folder).unwrap();
        let mania = mania_folder.join("map.osu");
        fs::write(&mania, "[General]\nMode:3\n[Metadata]\nVersion:Hard").unwrap();
        fs::write(
            standard_folder.join("map.osu"),
            "[General]\nMode:0\n[Metadata]\nVersion:Hard",
        )
        .unwrap();

        let mut folders = build_snapshots(root.path()).unwrap();
        folders.sort_by(|left, right| left.folder.cmp(&right.folder));
        let parsed = folders
            .into_iter()
            .map(|snapshot| parse_folder(snapshot, None))
            .collect::<Vec<_>>();
        assert_eq!(sets_from_folders(&parsed).len(), 1);
        assert_eq!(stable_id(&mania), stable_id(&mania));
    }

    #[test]
    fn removed_folder_is_absent_from_completed_cache_state() {
        let existing = CachedFolder {
            folder_path: "exists".into(),
            sources: Vec::new(),
            set: Some(BeatmapSet {
                id: "set".into(),
                folder_path: "exists".into(),
                folder_name: "exists".into(),
                artist: "Artist".into(),
                title: "Title".into(),
                creator: "Creator".into(),
                background_path: None,
                difficulties: Vec::new(),
            }),
        };
        let previous = vec![existing];
        assert_eq!(sets_from_folders(&previous).len(), 1);
        let completed_scan: Vec<CachedFolder> = Vec::new();
        assert!(sets_from_folders(&completed_scan).is_empty());
    }

    #[test]
    fn atomic_cache_write_replaces_only_a_complete_temporary_file() {
        let temp = tempfile::tempdir().unwrap();
        let cache = temp.path().join("library-cache.json");
        fs::write(&cache, "old cache").unwrap();

        write_atomically(&cache, b"new cache").unwrap();

        assert_eq!(fs::read_to_string(&cache).unwrap(), "new cache");
        assert!(!temporary_cache_path(&cache).exists());
    }

    #[test]
    fn failed_atomic_cache_write_preserves_previous_cache() {
        let temp = tempfile::tempdir().unwrap();
        let cache = temp.path().join("library-cache.json");
        fs::write(&cache, "old cache").unwrap();
        fs::create_dir(temporary_cache_path(&cache)).unwrap();

        assert!(write_atomically(&cache, b"new cache").is_err());
        assert_eq!(fs::read_to_string(&cache).unwrap(), "old cache");
    }

    #[test]
    fn invalid_cached_background_forces_background_resolution() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("map");
        fs::create_dir(&folder).unwrap();
        fs::write(
            folder.join("map.osu"),
            "[General]\nMode:3\n[Metadata]\nVersion:Hard",
        )
        .unwrap();
        let background = folder.join("background.png");
        fs::write(&background, []).unwrap();
        let snapshot = snapshot_for(&folder);
        let mut cached = parse_folder(snapshot.clone(), None);
        cached.set.as_mut().unwrap().background_path =
            Some(folder.join("missing.png").to_string_lossy().into_owned());

        let refreshed = parse_folder(snapshot, Some(&cached));
        assert_eq!(
            refreshed.set.unwrap().background_path,
            Some(background.to_string_lossy().into_owned())
        );
    }
}
