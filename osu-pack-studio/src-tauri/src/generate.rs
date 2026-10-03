use serde::{Deserialize, Serialize};
use std::{collections::{BTreeMap, HashMap, HashSet}, fs, io::{Read, Write}, path::{Path, PathBuf}, process::Command};
use tempfile::TempDir;
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateItem {
    pub set_id: String, pub folder_path: String, pub artist: String, pub title: String, pub creator: String,
    pub osu_path: String, pub difficulty: String, pub rate: f64, pub pitch: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRequest { pub pack_name: String, pub author: String, pub output_folder: String, pub ffmpeg_path: Option<String>, pub items: Vec<GenerateItem> }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateReport { pub output_path: String, pub mapsets: usize, pub difficulties: usize, pub warnings: Vec<String> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Manifest<'a> { name: &'a str, author: &'a str, created_by: &'static str, mapsets: usize, difficulties: usize }

fn safe_name(input: &str) -> String {
    let value: String = input.chars().map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '_' } else { c }).collect();
    let trimmed = value.trim().trim_end_matches(['.', ' ']);
    if trimmed.is_empty() { "Untitled".into() } else { trimmed.chars().take(120).collect() }
}

fn unique_dir(parent: &Path, name: &str) -> PathBuf {
    let base = parent.join(safe_name(name)); if !base.exists() { return base; }
    for n in 2..1000 { let candidate = parent.join(format!("{} ({n})", safe_name(name))); if !candidate.exists() { return candidate; } }
    parent.join(format!("{}-new", safe_name(name)))
}

fn field(line: &str) -> Option<&str> { line.split_once(':').map(|(_, value)| value.trim()) }
fn audio_name(text: &str) -> Option<String> { text.lines().find(|l| l.trim_start().starts_with("AudioFilename:")).and_then(field).map(str::to_owned) }

fn scale_num(value: &str, rate: f64) -> String {
    value.trim().parse::<f64>().map(|v| format!("{:.0}", v / rate)).unwrap_or_else(|_| value.to_owned())
}

fn rewrite_osu(text: &str, rate: f64, pitch: f64, new_audio: Option<&str>) -> String {
    let mut section = ""; let mut out = Vec::new();
    let suffix = format!("{}{}", if (rate-1.0).abs() > .001 { format!(" {:.2}x", rate) } else { String::new() }, if pitch.abs() > .001 { format!(" {:+.0}st", pitch) } else { String::new() });
    for source in text.lines() {
        let line = source.trim_start_matches('\u{feff}');
        if line.starts_with('[') && line.ends_with(']') { section = line; out.push(line.to_owned()); continue; }
        if section == "[General]" {
            if line.starts_with("AudioFilename:") { out.push(format!("AudioFilename: {}", new_audio.unwrap_or_else(|| field(line).unwrap_or("audio.mp3")))); continue; }
            if line.starts_with("AudioLeadIn:") && (rate-1.0).abs() > .001 { out.push(format!("AudioLeadIn: {}", scale_num(field(line).unwrap_or("0"), rate))); continue; }
            if line.starts_with("PreviewTime:") && (rate-1.0).abs() > .001 { out.push(format!("PreviewTime: {}", scale_num(field(line).unwrap_or("-1"), rate))); continue; }
        }
        if section == "[Editor]" && line.starts_with("Bookmarks:") && (rate-1.0).abs() > .001 {
            let points = field(line).unwrap_or("").split(',').map(|x| scale_num(x, rate)).collect::<Vec<_>>().join(","); out.push(format!("Bookmarks: {points}")); continue;
        }
        if section == "[Metadata]" && line.starts_with("Version:") && !suffix.is_empty() { out.push(format!("Version:{}{}", field(line).unwrap_or("Difficulty"), suffix)); continue; }
        if section == "[TimingPoints]" && !line.is_empty() && !line.starts_with("//") && (rate-1.0).abs() > .001 {
            let mut parts: Vec<String> = line.split(',').map(str::to_owned).collect();
            if let Some(first)=parts.first_mut(){*first=scale_num(first,rate)}
            if parts.len()>1 { if let Ok(beat_length)=parts[1].trim().parse::<f64>() { if beat_length>0.0 { parts[1]=format!("{:.12}",beat_length/rate).trim_end_matches('0').trim_end_matches('.').to_owned(); } } }
            out.push(parts.join(",")); continue;
        }
        if section == "[HitObjects]" && !line.is_empty() && (rate-1.0).abs() > .001 {
            let mut parts: Vec<String> = line.split(',').map(str::to_owned).collect();
            if parts.len()>2 { parts[2]=scale_num(&parts[2],rate); }
            if parts.len()>5 { if let Some((end, rest))=parts[5].split_once(':') { if end.parse::<f64>().is_ok() { parts[5]=format!("{}:{rest}",scale_num(end,rate)); } } else if parts[5].parse::<f64>().is_ok() { parts[5]=scale_num(&parts[5],rate); } }
            out.push(parts.join(",")); continue;
        }
        if section == "[Events]" && (rate-1.0).abs() > .001 {
            let mut parts: Vec<String> = line.split(',').map(str::to_owned).collect();
            if parts.len()>2 && (parts[0].trim()=="2" || parts[0].trim().eq_ignore_ascii_case("Break")) { parts[1]=scale_num(&parts[1],rate); parts[2]=scale_num(&parts[2],rate); out.push(parts.join(",")); continue; }
            if parts.len()>1 && (parts[0].trim()=="1" || parts[0].trim().eq_ignore_ascii_case("Video")) { parts[1]=scale_num(&parts[1],rate); out.push(parts.join(",")); continue; }
        }
        out.push(line.to_owned());
    }
    out.join("\r\n") + "\r\n"
}

fn atempo_chain(mut value: f64) -> String {
    let mut parts = Vec::new();
    while value > 2.0 { parts.push("atempo=2.0".to_owned()); value /= 2.0; }
    while value < 0.5 { parts.push("atempo=0.5".to_owned()); value /= 0.5; }
    parts.push(format!("atempo={value:.8}")); parts.join(",")
}

fn transform_audio(ffmpeg: &str, input: &Path, output: &Path, rate: f64, semitones: f64) -> Result<(), String> {
    let pitch = 2f64.powf(semitones / 12.0);
    let filter = format!("aresample=48000,asetrate=48000*{pitch:.10},aresample=48000,{}", atempo_chain(rate / pitch));
    let result = Command::new(ffmpeg).args(["-hide_banner","-loglevel","error","-y","-i"]).arg(input).args(["-vn","-filter:a",&filter,"-c:a","libvorbis","-q:a","6"]).arg(output).output().map_err(|e| format!("Nie można uruchomić FFmpeg ({ffmpeg}): {e}"))?;
    if !result.status.success() { return Err(format!("FFmpeg nie przetworzył {}: {}", input.display(), String::from_utf8_lossy(&result.stderr).trim())); }
    Ok(())
}

fn zip_dir(source: &Path, destination: &Path) -> Result<(), String> {
    let file = fs::File::create(destination).map_err(|e| e.to_string())?; let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated).unix_permissions(0o644);
    let mut buffer=Vec::new();
    for entry in WalkDir::new(source).min_depth(1).into_iter().filter_map(Result::ok).filter(|e|e.file_type().is_file()) {
        let name=entry.path().strip_prefix(source).map_err(|e|e.to_string())?.to_string_lossy().replace('\\',"/"); zip.start_file(name,options).map_err(|e|e.to_string())?;
        let mut input=fs::File::open(entry.path()).map_err(|e|e.to_string())?; input.read_to_end(&mut buffer).map_err(|e|e.to_string())?; zip.write_all(&buffer).map_err(|e|e.to_string())?; buffer.clear();
    }
    zip.finish().map_err(|e|e.to_string())?; Ok(())
}

#[tauri::command]
pub fn generate_pack(request: GenerateRequest) -> Result<GenerateReport, String> {
    if request.pack_name.trim().is_empty() { return Err("Podaj nazwę paczki.".into()); }
    if request.items.is_empty() { return Err("Dodaj co najmniej jedną mapę.".into()); }
    let parent=PathBuf::from(&request.output_folder); if !parent.is_dir(){return Err("Folder docelowy nie istnieje.".into())}
    let output=unique_dir(&parent,&request.pack_name); fs::create_dir_all(&output).map_err(|e|format!("Nie można utworzyć paczki: {e}"))?;
    for item in &request.items {
        if !item.rate.is_finite() || !(0.25..=4.0).contains(&item.rate) { return Err(format!("Nieprawidłowy rate dla mapy {}.", item.difficulty)); }
        if !item.pitch.is_finite() || !(-24.0..=24.0).contains(&item.pitch) { return Err(format!("Nieprawidłowy pitch dla mapy {}.", item.difficulty)); }
    }
    let mut grouped:BTreeMap<String,Vec<&GenerateItem>>=BTreeMap::new(); for item in &request.items { grouped.entry(item.set_id.clone()).or_default().push(item); }
    let mut warnings=Vec::new(); let mut archive_names=HashSet::new();
    for (_set_id,items) in &grouped {
        let first=items[0]; let temp=TempDir::new().map_err(|e|e.to_string())?; let work=temp.path(); let source=PathBuf::from(&first.folder_path);
        if !source.is_dir(){return Err(format!("Brak folderu źródłowego: {}",source.display()))}
        for entry in WalkDir::new(&source).follow_links(false).into_iter().filter_map(Result::ok).filter(|e|e.file_type().is_file()) {
            let path=entry.path();
            if !path.extension().and_then(|x|x.to_str()).is_some_and(|x|x.eq_ignore_ascii_case("osu")) {
                let relative=path.strip_prefix(&source).map_err(|e|e.to_string())?; let destination=work.join(relative);
                if let Some(parent)=destination.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?}
                fs::copy(path,destination).map_err(|e|format!("Nie można skopiować {}: {e}",path.display()))?;
            }
        }
        let mut audio_cache:HashMap<String,String>=HashMap::new();
        for item in items {
            let osu_path=PathBuf::from(&item.osu_path); let raw=fs::read(&osu_path).map_err(|e|format!("Nie można odczytać {}: {e}",osu_path.display()))?; let text=String::from_utf8_lossy(&raw);
            let changed=(item.rate-1.0).abs()>.001 || item.pitch.abs()>.001;
            let generated_audio=if changed {
                let key=format!("{:.4}_{:.2}",item.rate,item.pitch);
                if let Some(name)=audio_cache.get(&key){Some(name.clone())}else{
                    let original=audio_name(&text).ok_or_else(||format!("Mapa {} nie podaje AudioFilename.",item.difficulty))?; let source_audio=source.join(&original); if !source_audio.is_file(){return Err(format!("Brak pliku audio: {}",source_audio.display()))}
                    let name=format!("audio_{}x_{:+.0}st.ogg",item.rate,item.pitch).replace('+',"p").replace('-',"m");
                    let ffmpeg=request.ffmpeg_path.as_deref().filter(|x|!x.trim().is_empty()).unwrap_or("ffmpeg"); transform_audio(ffmpeg,&source_audio,&work.join(&name),item.rate,item.pitch)?; audio_cache.insert(key,name.clone()); Some(name)
                }
            } else {None};
            let updated=rewrite_osu(&text,item.rate,item.pitch,generated_audio.as_deref());
            let name=format!("{} - {} ({}) [{}].osu",safe_name(&item.artist),safe_name(&item.title),safe_name(&item.creator),safe_name(&format!("{}{}",item.difficulty,if changed{format!(" {:.2}x {:+.0}st",item.rate,item.pitch)}else{String::new()})));
            fs::write(work.join(name),updated).map_err(|e|e.to_string())?;
        }
        let base_name=format!("{} - {} ({})",safe_name(&first.artist),safe_name(&first.title),safe_name(&first.creator));
        let mut archive_name=format!("{base_name}.osz"); let mut suffix=2;
        while !archive_names.insert(archive_name.to_lowercase()) { archive_name=format!("{base_name} ({suffix}).osz"); suffix+=1; }
        zip_dir(work,&output.join(archive_name))?;
    }
    let manifest=Manifest{name:&request.pack_name,author:&request.author,created_by:"osu! Pack Studio 1.0",mapsets:grouped.len(),difficulties:request.items.len()};
    fs::write(output.join("pack.json"),serde_json::to_string_pretty(&manifest).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    fs::write(output.join("README.txt"),format!("{}\r\nAutor: {}\r\n\r\nKliknij dwukrotnie pliki .osz, aby zaimportować mapy do osu!.\r\n",request.pack_name,request.author)).map_err(|e|e.to_string())?;
    if request.author.trim().is_empty(){warnings.push("Nie podano autora paczki.".into())}
    Ok(GenerateReport{output_path:output.to_string_lossy().into_owned(),mapsets:grouped.len(),difficulties:request.items.len(),warnings})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_windows_file_names() {
        assert_eq!(safe_name("Artist: title?*"), "Artist_ title__");
        assert_eq!(safe_name("..."), "Untitled");
    }

    #[test]
    fn rewrites_timing_and_audio_without_touching_coordinates() {
        let input = "osu file format v14\n\n[General]\nAudioFilename: song.mp3\nPreviewTime: 10000\n\n[Metadata]\nVersion:Hard\n\n[TimingPoints]\n1000,500,4,2,1,50,1,0\n\n[HitObjects]\n256,192,2000,1,0,0:0:0:0:\n";
        let result = rewrite_osu(input, 2.0, 0.0, Some("fast.ogg"));
        assert!(result.contains("AudioFilename: fast.ogg"));
        assert!(result.contains("PreviewTime: 5000"));
        assert!(result.contains("Version:Hard 2.00x"));
        assert!(result.contains("500,250,4,2,1,50,1,0"));
        assert!(result.contains("256,192,1000,1,0,0:0:0:0:"));
    }

    #[test]
    fn builds_valid_atempo_chain_for_large_ratios() {
        assert_eq!(atempo_chain(4.0), "atempo=2.0,atempo=2.00000000");
        assert_eq!(atempo_chain(0.25), "atempo=0.5,atempo=0.50000000");
    }
}
