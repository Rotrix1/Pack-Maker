use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub songs_folder: String,
    pub output_folder: String,
    pub ffmpeg_path: String,
    pub pack_name: String,
    pub author: String,
}

fn path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| format!("Nie można utworzyć folderu ustawień: {e}"))?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    let path = path(&app)?;
    if !path.exists() {
        return Ok(AppSettings { pack_name: "Moja paczka".into(), ..Default::default() });
    }
    let data = fs::read_to_string(path).map_err(|e| format!("Nie można odczytać ustawień: {e}"))?;
    serde_json::from_str(&data).map_err(|e| format!("Ustawienia są uszkodzone: {e}"))
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let data = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(path(&app)?, data).map_err(|e| format!("Nie można zapisać ustawień: {e}"))
}
