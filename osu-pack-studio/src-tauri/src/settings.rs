use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_language")]
    pub language: String,
    pub songs_folder: String,
    pub output_folder: String,
    pub ffmpeg_path: String,
    pub pack_name: String,
    pub author: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub background_image: String,
    #[serde(default = "default_background_opacity")]
    pub background_opacity: f64,
}

fn default_language() -> String {
    "en".into()
}
fn default_theme() -> String {
    "rose".into()
}
fn default_background_opacity() -> f64 {
    0.16
}
fn default_downloads(app: &AppHandle) -> String {
    app.path()
        .download_dir()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default()
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
        return Ok(AppSettings {
            pack_name: "My pack".into(),
            language: default_language(),
            theme: default_theme(),
            background_opacity: default_background_opacity(),
            output_folder: default_downloads(&app),
            ..Default::default()
        });
    }
    let data = fs::read_to_string(path).map_err(|e| format!("Nie można odczytać ustawień: {e}"))?;
    let mut settings: AppSettings =
        serde_json::from_str(&data).map_err(|e| format!("Ustawienia są uszkodzone: {e}"))?;
    if settings.output_folder.trim().is_empty() {
        settings.output_folder = default_downloads(&app);
    }
    Ok(settings)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let data = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(path(&app)?, data).map_err(|e| format!("Nie można zapisać ustawień: {e}"))
}
