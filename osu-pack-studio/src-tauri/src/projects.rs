use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInput {
    pub name: String,
    pub kind: String,
    pub pack: Value,
    pub settings: Value,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSave {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub saved_at: u64,
    pub pack: Value,
    pub settings: Value,
}

fn file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("pack-project-saves.json"))
}
fn read(app: &AppHandle) -> Result<Vec<ProjectSave>, String> {
    let path = file(app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    serde_json::from_str(&fs::read_to_string(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Project saves are damaged: {e}"))
}
fn write(app: &AppHandle, saves: &[ProjectSave]) -> Result<(), String> {
    fs::write(
        file(app)?,
        serde_json::to_string_pretty(saves).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn save_project(app: AppHandle, input: ProjectInput) -> Result<ProjectSave, String> {
    let mut saves = read(&app)?;
    let project = ProjectSave {
        id: Uuid::new_v4().to_string(),
        name: input.name.trim().to_string(),
        kind: input.kind,
        saved_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis() as u64,
        pack: input.pack,
        settings: input.settings,
    };
    if project.name.is_empty() {
        return Err("Project name cannot be empty.".into());
    }
    saves.push(project.clone());
    // Autosaves are history, but keep the app data bounded.
    let auto_indices: Vec<usize> = saves
        .iter()
        .enumerate()
        .filter_map(|(i, p)| (p.kind == "auto").then_some(i))
        .collect();
    let extra_autos = auto_indices.len().saturating_sub(30);
    if extra_autos > 0 {
        for i in auto_indices.into_iter().take(extra_autos).rev() {
            saves.remove(i);
        }
    }
    write(&app, &saves)?;
    Ok(project)
}
#[tauri::command]
pub fn list_projects(app: AppHandle) -> Result<Vec<ProjectSave>, String> {
    let mut saves = read(&app)?;
    saves.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));
    Ok(saves)
}
#[tauri::command]
pub fn load_project(app: AppHandle, id: String) -> Result<ProjectSave, String> {
    read(&app)?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "Saved project no longer exists.".into())
}
#[tauri::command]
pub fn delete_project(app: AppHandle, id: String) -> Result<(), String> {
    let mut saves = read(&app)?;
    saves.retain(|p| p.id != id);
    write(&app, &saves)
}
