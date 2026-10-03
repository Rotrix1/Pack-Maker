mod generate;
mod projects;
mod scanner;
mod settings;

use generate::{create_audio_preview, estimate_pack_size, generate_pack};
use projects::{delete_project, list_projects, load_project, save_project};
use scanner::scan_songs_folder;
use settings::{load_settings, save_settings};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            scan_songs_folder,
            generate_pack,
            estimate_pack_size,
            create_audio_preview,
            load_settings,
            save_settings,
            save_project,
            list_projects,
            load_project,
            delete_project
        ])
        .run(tauri::generate_context!())
        .expect("failed to run osu! Pack Studio");
}
