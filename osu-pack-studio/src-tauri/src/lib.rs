mod generate;
mod scanner;
mod settings;

use generate::{generate_pack, GenerateRequest, GenerateReport};
use scanner::{scan_songs_folder, BeatmapSet};
use settings::{load_settings, save_settings, AppSettings};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            scan_songs_folder,
            generate_pack,
            load_settings,
            save_settings
        ])
        .run(tauri::generate_context!())
        .expect("failed to run osu! Pack Studio");
}
