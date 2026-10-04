use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
};
use tempfile::TempDir;
use uuid::Uuid;
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Overlay {
    #[serde(rename = "id")]
    pub _id: String,
    pub path: String,
    pub opacity: f64,
    pub scale: f64,
    pub x: f64,
    pub y: f64,
}
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Effects {
    pub brightness: Option<f64>,
    pub contrast: Option<f64>,
    pub saturation: Option<f64>,
    pub blur: Option<f64>,
    pub hue: Option<f64>,
    pub vignette: Option<f64>,
    pub glitch: Option<f64>,
    pub grain: Option<f64>,
    pub sharpen: Option<f64>,
    pub pixelate: Option<f64>,
    pub sepia: Option<f64>,
    pub invert: Option<bool>,
}
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Trainer {
    pub hp: Option<f64>,
    pub cs: Option<f64>,
    pub ar: Option<f64>,
    pub od: Option<f64>,
    pub hr_circle_size: Option<bool>,
    pub scale_ar: Option<bool>,
    pub scale_od: Option<bool>,
    pub change_pitch: Option<bool>,
    pub no_spinners: Option<bool>,
    pub high_quality: Option<bool>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateItem {
    pub set_id: String,
    pub folder_path: String,
    pub artist: String,
    pub title: String,
    pub creator: String,
    pub osu_path: String,
    pub difficulty: String,
    pub rate: f64,
    pub pitch: f64,
    #[serde(default)]
    pub trainer: Trainer,
    pub custom_background_path: Option<String>,
    #[serde(default)]
    pub background_effects: Effects,
    #[serde(default)]
    pub overlays: Vec<Overlay>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRequest {
    pub pack_name: String,
    pub author: String,
    pub output_folder: String,
    pub ffmpeg_path: Option<String>,
    pub items: Vec<GenerateItem>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateReport {
    pub output_path: String,
    pub mapsets: usize,
    pub difficulties: usize,
    pub warnings: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SizeItem {
    pub folder_path: String,
    pub osu_path: String,
    pub custom_background_path: Option<String>,
    #[serde(default)]
    pub overlays: Vec<Overlay>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewItem {
    pub folder_path: String,
    pub osu_path: String,
    pub rate: f64,
    pub pitch: f64,
    #[serde(default)]
    pub trainer: Trainer,
    pub ffmpeg_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarathonItem {
    pub folder_path: String,
    pub osu_path: String,
    pub artist: String,
    pub title: String,
    pub creator: String,
    pub difficulty: String,
    #[serde(default = "one")]
    pub rate: f64,
    #[serde(default)]
    pub pitch: f64,
    pub background_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarathonRequest {
    pub pack_name: String,
    pub artist: String,
    pub author: String,
    pub version: String,
    pub symbol: String,
    pub output_folder: String,
    pub ffmpeg_path: Option<String>,
    pub items: Vec<MarathonItem>,
    #[serde(default)]
    pub breaks: Vec<f64>,
    #[serde(default = "enabled_by_default")]
    pub trim_silent_intros: bool,
}

fn one() -> f64 {
    1.0
}

fn enabled_by_default() -> bool {
    true
}

fn safe_name(input: &str) -> String {
    let value: String = input
        .chars()
        .map(|c| {
            if "<>:\"/\\|?*".contains(c) || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let value = value.trim().trim_end_matches(['.', ' ']);
    if value.is_empty() {
        "Untitled".into()
    } else {
        value.chars().take(120).collect()
    }
}
fn unique_file(parent: &Path, name: &str) -> PathBuf {
    let base = parent.join(name);
    if !base.exists() {
        return base;
    }
    for n in 2..1000 {
        let p = parent.join(format!("{} ({n}).osz", name.trim_end_matches(".osz")));
        if !p.exists() {
            return p;
        }
    }
    parent.join(format!("{}-new.osz", name.trim_end_matches(".osz")))
}
fn field(line: &str) -> Option<&str> {
    line.split_once(':').map(|(_, v)| v.trim())
}
fn audio_name(text: &str) -> Option<String> {
    text.lines()
        .find(|line| line.trim_start().starts_with("AudioFilename:"))
        .and_then(field)
        .map(|s| s.trim_matches('"').to_owned())
}
fn bg_name(text: &str) -> Option<String> {
    let mut section = "";
    text.lines().find_map(|line| {
        let l = line.trim_start();
        if l.starts_with('[') && l.ends_with(']') {
            section = l;
            return None;
        }
        if section == "[Events]"
            && (l.starts_with('0') || l.to_ascii_lowercase().starts_with("background"))
        {
            let parts: Vec<_> = l.split(',').collect();
            if parts.len() >= 3 {
                return Some(parts[2].trim().trim_matches('"').to_owned());
            }
        }
        None
    })
}

fn selected_marathon_background(item: &MarathonItem, raw: &str) -> Option<PathBuf> {
    let folder = Path::new(&item.folder_path);
    // The .osu event belongs to this exact difficulty. Prefer it over the
    // cached/library field, which may have originated from another difficulty
    // in the same beatmapset before the library cache was refreshed.
    resolve_asset(folder, bg_name(raw))
        .or_else(|| {
            item.background_path
                .as_ref()
                .map(PathBuf::from)
                .filter(|path| path.is_file())
        })
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_none_or(|extension| !extension.eq_ignore_ascii_case("svg"))
        })
}
fn resolve_asset(folder: &Path, name: Option<String>) -> Option<PathBuf> {
    let name = name?;
    let candidate = folder.join(name.replace('/', "\\"));
    let root = folder.canonicalize().ok()?;
    let path = candidate.canonicalize().ok()?;
    path.starts_with(root).then_some(path)
}
fn scale_num(value: &str, rate: f64) -> String {
    value
        .trim()
        .parse::<f64>()
        .map(|v| format!("{:.0}", v / rate))
        .unwrap_or_else(|_| value.into())
}
fn scale_ar(value: f64, rate: f64) -> f64 {
    let pre = if value < 5. {
        1800. - 120. * value
    } else {
        1200. - 150. * (value - 5.)
    };
    let scaled = pre / rate;
    if scaled > 1200. {
        ((1800. - scaled) / 120.).clamp(0., 10.)
    } else {
        (5. + (1200. - scaled) / 150.).clamp(0., 10.)
    }
}
fn scale_od(value: f64, rate: f64) -> f64 {
    ((80. - (80. - 6. * value) / rate) / 6.).clamp(0., 10.)
}
fn rewrite_osu(
    text: &str,
    item: &GenerateItem,
    audio: &str,
    background: Option<&str>,
    author: &str,
    pack_name: &str,
    final_pitch: f64,
) -> String {
    let changed = (item.rate - 1.).abs() > 0.001 || final_pitch.abs() > 0.001;
    let suffix = format!(
        "{}{}",
        if (item.rate - 1.).abs() > 0.001 {
            format!(" {:.2}x", item.rate)
        } else {
            "".into()
        },
        if final_pitch.abs() > 0.001 {
            format!(" {:+.0}st", final_pitch)
        } else {
            "".into()
        }
    );
    let mut section = "";
    let mut written = false;
    let mut out = Vec::new();
    for raw in text.lines() {
        let line = raw.trim_start_matches('\u{feff}');
        if line.starts_with('[') && line.ends_with(']') {
            section = line;
            out.push(line.into());
            continue;
        }
        if section == "[General]" && line.starts_with("AudioFilename:") {
            out.push(format!("AudioFilename: {audio}"));
            continue;
        }
        if section == "[General]"
            && changed
            && (line.starts_with("AudioLeadIn:") || line.starts_with("PreviewTime:"))
        {
            out.push(format!(
                "{} {}",
                line.split_once(':')
                    .map(|(a, _)| a)
                    .unwrap_or("PreviewTime:"),
                scale_num(field(line).unwrap_or("0"), item.rate)
            ));
            continue;
        }
        if section == "[Editor]" && line.starts_with("Bookmarks:") && changed {
            out.push(format!(
                "Bookmarks: {}",
                field(line)
                    .unwrap_or("")
                    .split(',')
                    .map(|v| scale_num(v, item.rate))
                    .collect::<Vec<_>>()
                    .join(",")
            ));
            continue;
        }
        if section == "[Metadata]" {
            if line.starts_with("Title:") || line.starts_with("TitleUnicode:") {
                out.push(format!(
                    "{}{}",
                    line.split_once(':')
                        .map(|(a, _)| format!("{a}: "))
                        .unwrap_or_default(),
                    pack_name
                ));
                continue;
            }
            if line.starts_with("Creator:") {
                out.push(format!("Creator:{author}"));
                continue;
            }
            if line.starts_with("BeatmapID:") {
                out.push("BeatmapID:0".into());
                continue;
            }
            if line.starts_with("BeatmapSetID:") {
                out.push("BeatmapSetID:-1".into());
                continue;
            }
            if line.starts_with("Version:") {
                out.push(format!(
                    "Version:({}) {} - {}{}",
                    item.creator,
                    item.title,
                    field(line).unwrap_or(&item.difficulty),
                    suffix
                ));
                continue;
            }
        }
        if section == "[Difficulty]" {
            let t = &item.trainer;
            if line.starts_with("HPDrainRate:") {
                if let Some(v) = t.hp {
                    out.push(format!("HPDrainRate:{v}"));
                    continue;
                }
            }
            if line.starts_with("CircleSize:") {
                if let Some(v) = t.cs {
                    out.push(format!(
                        "CircleSize:{}",
                        if t.hr_circle_size.unwrap_or(false) {
                            (v * 1.3).min(10.)
                        } else {
                            v
                        }
                    ));
                    continue;
                }
            }
            if line.starts_with("ApproachRate:") {
                if let Some(v) = t.ar {
                    out.push(format!(
                        "ApproachRate:{}",
                        if t.scale_ar.unwrap_or(false) {
                            scale_ar(v, item.rate)
                        } else {
                            v
                        }
                    ));
                    continue;
                }
            }
            if line.starts_with("OverallDifficulty:") {
                if let Some(v) = t.od {
                    out.push(format!(
                        "OverallDifficulty:{}",
                        if t.scale_od.unwrap_or(false) {
                            scale_od(v, item.rate)
                        } else {
                            v
                        }
                    ));
                    continue;
                }
            }
        }
        if section == "[TimingPoints]" && !line.is_empty() && changed {
            let mut p: Vec<String> = line.split(',').map(str::to_owned).collect();
            if p.len() > 1 {
                p[0] = scale_num(&p[0], item.rate);
                if let Ok(v) = p[1].parse::<f64>() {
                    if v > 0. {
                        p[1] = format!("{}", v / item.rate)
                    }
                }
                out.push(p.join(","));
                continue;
            }
        }
        if section == "[HitObjects]"
            && !line.is_empty()
            && ((changed) || item.trainer.no_spinners.unwrap_or(false))
        {
            let mut p: Vec<String> = line.split(',').map(str::to_owned).collect();
            if item.trainer.no_spinners.unwrap_or(false)
                && p.get(3)
                    .and_then(|x| x.parse::<i32>().ok())
                    .is_some_and(|v| v & 8 != 0)
            {
                continue;
            }
            if changed && p.len() > 2 {
                p[2] = scale_num(&p[2], item.rate)
            }
            if changed && p.len() > 5 {
                if let Some((end, rest)) = p[5].split_once(':') {
                    p[5] = format!("{}:{rest}", scale_num(end, item.rate))
                }
            }
            out.push(p.join(","));
            continue;
        }
        if section == "[Events]"
            && background.is_some()
            && (line.trim_start().starts_with('0')
                || line
                    .trim_start()
                    .to_ascii_lowercase()
                    .starts_with("background"))
        {
            out.push(format!("0,0,\"{}\",0,0", background.unwrap()));
            written = true;
            continue;
        }
        out.push(line.into())
    }
    if let Some(background) = background {
        if !written {
            if let Some(i) = out.iter().position(|line| line.trim() == "[Events]") {
                out.insert(i + 1, format!("0,0,\"{background}\",0,0"));
            }
        }
    }
    out.join("\r\n") + "\r\n"
}
fn atempo_chain(mut v: f64) -> String {
    let mut p = Vec::new();
    while v > 2. {
        p.push("atempo=2".to_owned());
        v /= 2.
    }
    while v < 0.5 {
        p.push("atempo=0.5".to_owned());
        v /= 0.5;
    }
    p.push(format!("atempo={v:.8}"));
    p.join(",")
}
fn ffmpeg(custom: Option<&str>) -> String {
    if let Some(path) = custom
        .filter(|path| !path.trim().is_empty())
        .filter(|path| Path::new(path).is_file())
    {
        return path.to_owned();
    }
    let mut candidates = Vec::new();
    if let Ok(executable) = std::env::current_exe() {
        if let Some(folder) = executable.parent() {
            candidates.push(folder.join("ffmpeg.exe"));
            candidates.push(folder.join("resources").join("ffmpeg.exe"));
        }
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(local)
                .join("Microsoft")
                .join("WinGet")
                .join("Links")
                .join("ffmpeg.exe"),
        );
    }
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        candidates.push(
            PathBuf::from(program_files)
                .join("ffmpeg")
                .join("bin")
                .join("ffmpeg.exe"),
        );
    }
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        candidates.push(PathBuf::from(profile).join("Downloads").join("ffmpeg.exe"));
    }
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| "ffmpeg".into())
}
fn run_hidden(command: &mut Command) -> std::io::Result<std::process::Output> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.output()
}
fn command_error(result: std::process::Output, label: &str) -> Result<(), String> {
    if result.status.success() {
        Ok(())
    } else {
        Err(format!(
            "{label}: {}",
            String::from_utf8_lossy(&result.stderr).trim()
        ))
    }
}

fn audio_duration_ms(exe: &str, audio: &Path) -> Result<f64, String> {
    let mut command = Command::new(exe);
    command
        .args(["-hide_banner", "-i"])
        .arg(audio)
        .args(["-f", "null", "-"]);
    let output = run_hidden(&mut command)
        .map_err(|error| format!("Cannot inspect generated audio: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Generated audio inspection: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let duration = stderr
        .split("Duration: ")
        .nth(1)
        .and_then(|value| value.split(',').next())
        .ok_or_else(|| "Generated audio has no readable duration.".to_string())?;
    let values = duration
        .split(':')
        .map(|value| value.trim().parse::<f64>().map_err(|_| "Generated audio has an invalid duration.".to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    if values.len() != 3 {
        return Err("Generated audio has an invalid duration.".into());
    }
    Ok((values[0] * 3600.0 + values[1] * 60.0 + values[2]) * 1000.0)
}
fn transform_audio(
    exe: &str,
    input: &Path,
    output: &Path,
    rate: f64,
    pitch: f64,
    quality: bool,
) -> Result<(), String> {
    let pitch_rate = 2f64.powf(pitch / 12.);
    let filter = format!(
        "aresample=48000,asetrate=48000*{pitch_rate:.10},aresample=48000,{},asetpts=PTS-STARTPTS",
        atempo_chain(rate / pitch_rate)
    );
    let mut command = Command::new(exe);
    command
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(input)
        .args([
            "-vn",
            "-filter:a",
            &filter,
            "-c:a",
            "libvorbis",
            "-q:a",
            if quality { "8" } else { "5" },
        ])
        .arg(output);
    command_error(
        run_hidden(&mut command).map_err(|e| format!("Cannot start FFmpeg ({exe}): {e}"))?,
        "FFmpeg audio conversion",
    )
}
fn effect_filters(e: &Effects) -> Vec<String> {
    let mut f = vec![format!(
        "eq=brightness={:.3}:contrast={:.3}:saturation={:.3}",
        (e.brightness.unwrap_or(1.) - 1.).clamp(-1., 1.),
        e.contrast.unwrap_or(1.).clamp(0., 2.),
        e.saturation.unwrap_or(1.).clamp(0., 3.)
    )];
    if e.hue.unwrap_or(0.).abs() > 0.001 {
        f.push(format!(
            "hue=h={:.1}",
            e.hue.unwrap_or(0.).clamp(-180., 180.)
        ))
    }
    if e.blur.unwrap_or(0.) > 0. {
        f.push(format!(
            "boxblur={:.1}:1",
            e.blur.unwrap_or(0.).clamp(0.1, 12.)
        ))
    }
    if e.pixelate.unwrap_or(0.) > 0. {
        let n = e.pixelate.unwrap_or(0.).clamp(2., 24.).round();
        f.push(format!(
            "scale=trunc(iw/{n}):trunc(ih/{n}):flags=neighbor,scale=iw*{n}:ih*{n}:flags=neighbor"
        ))
    }
    if e.sharpen.unwrap_or(0.) > 0. {
        f.push(format!(
            "unsharp=5:5:{:.2}",
            e.sharpen.unwrap_or(0.).clamp(0., 2.)
        ))
    }
    if e.sepia.unwrap_or(0.) > 0. {
        f.push(
            "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131:0:0:0:0:1".into(),
        )
    }
    let noise = (e.grain.unwrap_or(0.) + e.glitch.unwrap_or(0.)).clamp(0., 30.);
    if noise > 0. {
        f.push(format!("noise=alls={noise:.0}:allf=u"))
    }
    if e.invert.unwrap_or(false) {
        f.push("negate".into())
    }
    if e.vignette.unwrap_or(0.) > 0. {
        f.push(format!(
            "vignette=PI/{:.1}",
            (12. - e.vignette.unwrap_or(0.).clamp(0., 1.) * 8.).max(2.)
        ))
    }
    f
}
fn has_effects(e: &Effects) -> bool {
    (e.brightness.unwrap_or(1.) - 1.).abs() > 0.001
        || (e.contrast.unwrap_or(1.) - 1.).abs() > 0.001
        || (e.saturation.unwrap_or(1.) - 1.).abs() > 0.001
        || e.blur.unwrap_or(0.) > 0.
        || e.hue.unwrap_or(0.) != 0.
        || e.vignette.unwrap_or(0.) > 0.
        || e.glitch.unwrap_or(0.) > 0.
        || e.grain.unwrap_or(0.) > 0.
        || e.sharpen.unwrap_or(0.) > 0.
        || e.pixelate.unwrap_or(0.) > 0.
        || e.sepia.unwrap_or(0.) > 0.
        || e.invert.unwrap_or(false)
}
fn transform_background(
    exe: &str,
    input: &Path,
    output: &Path,
    e: &Effects,
    overlays: &[Overlay],
) -> Result<(), String> {
    let mut args = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-y".into(),
        "-i".into(),
        input.to_string_lossy().into_owned(),
    ];
    for overlay in overlays {
        args.push("-i".into());
        args.push(overlay.path.clone())
    }
    let filters = effect_filters(e).join(",");
    if overlays.is_empty() {
        args.extend([
            "-vf".into(),
            filters,
            "-frames:v".into(),
            "1".into(),
            output.to_string_lossy().into_owned(),
        ]);
    } else {
        let mut graph = format!("[0:v]{filters}[base0]");
        for (i, o) in overlays.iter().enumerate() {
            let n = i + 1;
            let opacity = o.opacity.clamp(0., 1.);
            let scale = o.scale.clamp(0.01, 3.);
            graph.push_str(&format!(";[{n}:v]format=rgba,colorchannelmixer=aa={opacity:.3}[layer{i}];[layer{i}][base{i}]scale2ref=w=iw*{scale:.3}:h=ow/mdar[over{i}][ref{i}];[ref{i}][over{i}]overlay=x=(main_w-overlay_w)*{:.3}:y=(main_h-overlay_h)*{:.3}[base{}]",o.x.clamp(0.,1.),o.y.clamp(0.,1.),i+1));
        }
        args.extend([
            "-filter_complex".into(),
            graph,
            "-map".into(),
            format!("[base{}]", overlays.len()),
            "-frames:v".into(),
            "1".into(),
            output.to_string_lossy().into_owned(),
        ]);
    }
    let mut command = Command::new(exe);
    command.args(args);
    command_error(
        run_hidden(&mut command).map_err(|e| format!("Cannot start FFmpeg ({exe}): {e}"))?,
        "FFmpeg background conversion",
    )
}
fn zip_dir(source: &Path, destination: &Path) -> Result<(), String> {
    let file = fs::File::create(destination).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);
    let mut buffer = Vec::new();
    for entry in WalkDir::new(source)
        .min_depth(1)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
    {
        let name = entry
            .path()
            .strip_prefix(source)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        zip.start_file(name, options).map_err(|e| e.to_string())?;
        fs::File::open(entry.path())
            .map_err(|e| e.to_string())?
            .read_to_end(&mut buffer)
            .map_err(|e| e.to_string())?;
        zip.write_all(&buffer).map_err(|e| e.to_string())?;
        buffer.clear()
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn generate_pack(request: GenerateRequest) -> Result<GenerateReport, String> {
    if request.pack_name.trim().is_empty() || request.items.is_empty() {
        return Err("Add a pack name and at least one map.".into());
    }
    let parent = PathBuf::from(&request.output_folder);
    if !parent.is_dir() {
        return Err("Output folder does not exist.".into());
    }
    let work = TempDir::new().map_err(|e| e.to_string())?;
    let exe = ffmpeg(request.ffmpeg_path.as_deref());
    let mut sets = HashSet::new();
    for (index, item) in request.items.iter().enumerate() {
        if !item.rate.is_finite() || !(0.1..=3.).contains(&item.rate) {
            return Err(format!("Invalid rate for {}.", item.difficulty));
        }
        sets.insert(&item.set_id);
        let raw =
            fs::read_to_string(&item.osu_path).map_err(|e| format!("Cannot read map: {e}"))?;
        let folder = Path::new(&item.folder_path);
        let source_audio = resolve_asset(folder, audio_name(&raw))
            .ok_or_else(|| format!("Audio not found for {}.", item.difficulty))?;
        let final_pitch = item.pitch
            + if item.trainer.change_pitch.unwrap_or(false) {
                12. * item.rate.log2()
            } else {
                0.
            };
        let changed = (item.rate - 1.).abs() > 0.001 || final_pitch.abs() > 0.001;
        let prefix = format!("m{:03}", index + 1);
        let audio = if changed {
            let name = format!("{prefix}_audio.ogg");
            transform_audio(
                &exe,
                &source_audio,
                &work.path().join(&name),
                item.rate,
                final_pitch,
                item.trainer.high_quality.unwrap_or(true),
            )?;
            name
        } else {
            let ext = source_audio
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("mp3");
            let name = format!("{prefix}_audio.{ext}");
            fs::copy(source_audio, work.path().join(&name)).map_err(|e| e.to_string())?;
            name
        };
        let original_bg = resolve_asset(folder, bg_name(&raw));
        let source_bg = item
            .custom_background_path
            .as_ref()
            .map(PathBuf::from)
            .filter(|p| p.is_file())
            .or(original_bg);
        let bg = if let Some(source) = source_bg {
            let changed_bg = has_effects(&item.background_effects) || !item.overlays.is_empty();
            let name = if changed_bg {
                format!("{prefix}_background.png")
            } else {
                format!(
                    "{prefix}_background.{}",
                    source.extension().and_then(|s| s.to_str()).unwrap_or("jpg")
                )
            };
            if changed_bg {
                transform_background(
                    &exe,
                    &source,
                    &work.path().join(&name),
                    &item.background_effects,
                    &item.overlays,
                )?
            } else {
                fs::copy(source, work.path().join(&name)).map_err(|e| e.to_string())?;
            }
            Some(name)
        } else {
            None
        };
        let rewritten = rewrite_osu(
            &raw,
            item,
            &audio,
            bg.as_deref(),
            &request.author,
            &request.pack_name,
            final_pitch,
        );
        let filename = format!(
            "{prefix}_{} - {} [{}].osu",
            safe_name(&item.artist),
            safe_name(&item.title),
            safe_name(&item.difficulty)
        );
        fs::write(work.path().join(filename), rewritten).map_err(|e| e.to_string())?;
    }
    let output = unique_file(&parent, &format!("{}.osz", safe_name(&request.pack_name)));
    zip_dir(work.path(), &output)?;
    Ok(GenerateReport {
        output_path: output.to_string_lossy().into_owned(),
        mapsets: sets.len(),
        difficulties: request.items.len(),
        warnings: vec![],
    })
}

fn audio_lead_in_ms(text: &str) -> f64 {
    text.lines()
        .find(|line| line.trim_start().starts_with("AudioLeadIn:"))
        .and_then(field)
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(0.0)
}

const DAN_INTRO_FADE_MS: f64 = 1_500.0;

fn first_hit_ms(text: &str) -> Option<f64> {
    section_text(text, "[HitObjects]")
        .into_iter()
        .filter_map(|line| line.split(',').nth(2)?.parse::<f64>().ok())
        .filter(|time| time.is_finite() && *time >= 0.0)
        .min_by(|left, right| left.total_cmp(right))
}

fn silent_intro_trim_ms(text: &str, enabled: bool) -> f64 {
    if !enabled {
        return 0.0;
    }
    first_hit_ms(text)
        .map(|first_hit| (first_hit - DAN_INTRO_FADE_MS).max(0.0))
        .unwrap_or(0.0)
}

fn transform_marathon_audio(
    exe: &str,
    input: &Path,
    output: &Path,
    rate: f64,
    pitch: f64,
    duration_ms: f64,
    source_start_ms: f64,
    fade_in: bool,
) -> Result<(), String> {
    let pitch_rate = 2f64.powf(pitch / 12.);
    let mut filter = format!(
        "aresample=48000,asetrate=48000*{pitch_rate:.10},aresample=48000,{},asetpts=PTS-STARTPTS",
        atempo_chain(rate / pitch_rate)
    );
    if fade_in {
        filter.push_str(",afade=t=in:st=0:d=1.5");
    }
    let mut command = Command::new(exe);
    command
        .args(["-hide_banner", "-loglevel", "error", "-y", "-ss"])
        .arg((source_start_ms.max(0.0) / 1000.0).to_string())
        .arg("-i")
        .arg(input)
        .args([
            "-t",
            &(duration_ms.max(1.) / 1000.).to_string(),
            "-vn",
            "-filter:a",
            &filter,
            "-c:a",
            "libvorbis",
            "-q:a",
            "8",
            "-avoid_negative_ts",
            "make_zero",
        ])
        .arg(output);
    command_error(
        run_hidden(&mut command).map_err(|e| format!("Cannot start FFmpeg ({exe}): {e}"))?,
        "Marathon audio conversion",
    )
}

fn section_text(text: &str, wanted: &str) -> Vec<String> {
    let mut section = String::new();
    text.lines()
        .filter_map(|line| {
            let trimmed = line.trim_start_matches('\u{feff}').trim();
            if trimmed.starts_with('[') && trimmed.ends_with(']') {
                section = trimmed.to_string();
                return None;
            }
            if section == wanted && !trimmed.is_empty() && !trimmed.starts_with("//") {
                Some(trimmed.to_string())
            } else {
                None
            }
        })
        .collect()
}

fn map_end_ms(text: &str) -> f64 {
    section_text(text, "[HitObjects]")
        .iter()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split(',').collect();
            let start = fields
                .get(2)
                .and_then(|v| v.parse::<f64>().ok())
                .unwrap_or(0.);
            let end = fields
                .get(5)
                .and_then(|v| v.split(':').next())
                .and_then(|v| v.parse::<f64>().ok())
                .unwrap_or(start);
            Some(start.max(end))
        })
        .fold(0., f64::max)
        + 1000.
}

fn highest_bpm(text: &str) -> Option<f64> {
    section_text(text, "[TimingPoints]")
        .into_iter()
        .filter_map(|line| {
            let beat_length = line
                .split(',')
                .nth(1)
                .and_then(|value| value.trim().parse::<f64>().ok())?;
            (beat_length > 0.0).then_some(60_000.0 / beat_length)
        })
        .filter(|bpm| bpm.is_finite() && *bpm > 0.0)
        .max_by(|left, right| left.total_cmp(right))
}

fn shifted_section(text: &str, wanted: &str, offset: f64) -> Vec<String> {
    section_text(text, wanted)
        .into_iter()
        .map(|line| {
            let mut fields: Vec<String> = line.split(',').map(str::to_owned).collect();
            let time_index = if wanted == "[HitObjects]" { 2 } else { 0 };
            if let Some(value) = fields.get_mut(time_index) {
                if let Ok(time) = value.parse::<f64>() {
                    let adjusted = time + offset;
                    *value = format!(
                        "{:.0}",
                        if wanted == "[HitObjects]" {
                            adjusted.max(0.)
                        } else {
                            adjusted
                        }
                    );
                }
            }
            // A mania hold stores its release time in field 5 as
            // `end_time:sample_set:...`. Its start and release must move by
            // exactly the same amount when this map becomes a later Dan stage.
            let is_hold = wanted == "[HitObjects]"
                && fields
                    .get(3)
                    .and_then(|value| value.parse::<u32>().ok())
                    .is_some_and(|kind| kind & 128 != 0);
            if is_hold {
                if let Some(value) = fields.get_mut(5) {
                    if let Some((end, suffix)) = value.split_once(':') {
                        if let Ok(end_time) = end.parse::<f64>() {
                            *value = format!("{:.0}:{suffix}", (end_time + offset).max(0.0));
                        }
                    }
                }
            }
            line.split_once(',')
                .map(|_| fields.join(","))
                .unwrap_or(line)
        })
        .collect()
}

fn marathon_audio_plan(clips: usize, lead_ins: &[f64], breaks: &[f64]) -> (String, Vec<f64>) {
    let mut graph = String::new();
    let mut inputs = String::new();
    let mut silences = Vec::new();
    let mut segments = 0;
    for index in 0..clips {
        let lead_in = lead_ins.get(index).copied().unwrap_or(0.0).max(0.0);
        if lead_in > 0.0 {
            let silence_index = clips + silences.len();
            graph.push_str(&format!(
                "[{silence_index}:a]aresample=48000[l{index}];"
            ));
            inputs.push_str(&format!("[l{index}]"));
            silences.push(lead_in);
            segments += 1;
        }
        graph.push_str(&format!(
            "[{index}:a]aresample=48000,asetpts=PTS-STARTPTS[a{index}];"
        ));
        inputs.push_str(&format!("[a{index}]"));
        segments += 1;
        let seconds = breaks.get(index).copied().unwrap_or(0.).max(0.);
        if index + 1 < clips && seconds > 0. {
            let silence_index = clips + silences.len();
            graph.push_str(&format!(
                "[{silence_index}:a]aresample=48000[s{}];",
                silences.len()
            ));
            inputs.push_str(&format!("[s{}]", silences.len()));
            silences.push(seconds);
            segments += 1;
        }
    }
    graph.push_str(&format!("{inputs}concat=n={segments}:v=0:a=1[out]"));
    (graph, silences)
}

fn marathon_audio(
    exe: &str,
    clips: &[PathBuf],
    lead_ins: &[f64],
    breaks: &[f64],
    output: &Path,
) -> Result<(), String> {
    if clips.is_empty() {
        return Err("Marathon has no audio clips.".into());
    }
    let mut command = Command::new(exe);
    command.args(["-hide_banner", "-loglevel", "error", "-y"]);
    for clip in clips {
        command.args(["-i"]).arg(clip);
    }
    let (graph, silences) = marathon_audio_plan(clips.len(), lead_ins, breaks);
    for seconds in silences {
        command.args([
            "-f",
            "lavfi",
            "-i",
            &format!("anullsrc=channel_layout=stereo:sample_rate=48000:d={seconds}"),
        ]);
    }
    command
        .args([
            "-filter_complex",
            &graph,
            "-map",
            "[out]",
            "-c:a",
            "libvorbis",
            "-q:a",
            "5",
        ])
        .arg(output);
    command_error(
        run_hidden(&mut command).map_err(|e| format!("Cannot start FFmpeg: {e}"))?,
        "Marathon audio",
    )
}

fn marathon_background(
    exe: &str,
    images: &[PathBuf],
    symbol: &str,
    output: &Path,
    _work: &Path,
) -> Result<(), String> {
    if images.is_empty() {
        let mut fallback = Command::new(exe);
        fallback
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=0x101018:s=1920x1080:d=1",
                "-frames:v",
                "1",
            ])
            .arg(output);
        return command_error(
            run_hidden(&mut fallback).map_err(|e| format!("Cannot start FFmpeg: {e}"))?,
            "Marathon background",
        );
    }
    let mut command = Command::new(exe);
    command.args(["-hide_banner", "-loglevel", "error", "-y"]);
    for image in images.iter().take(4) {
        command.args(["-i"]).arg(image);
    }
    let n = images.len().min(4);
    let layout = match n {
        1 => "0_0",
        2 => "0_0|w0_0",
        _ => "0_0|w0_0|0_h0|w0_h0",
    };
    let mut graph = String::new();
    for i in 0..n {
        graph.push_str(&format!("[{i}:v]scale=960:540:flags=lanczos:force_original_aspect_ratio=increase,crop=960:540[v{i}];"));
    }
    let tiles = (0..n).map(|i| format!("[v{i}]")).collect::<String>();
    if n == 1 {
        graph.push_str("[v0]scale=1920:1080[base];");
    } else {
        graph.push_str(&format!(
            "{tiles}xstack=inputs={n}:layout={layout}:fill=black[base];"
        ));
    }
    let escaped = symbol
        .replace('\\', "\\\\")
        .replace(':', "\\:")
        .replace('\'', "\\'");
    graph.push_str(&format!("color=c=0x63d8ff:s=320x320,format=rgba,geq=r='99':g='216':b='255':a='if(lte((X-160)*(X-160)+(Y-160)*(Y-160),160*160),255,0)'[outer];color=c=black@0.94:s=294x294,format=rgba,geq=r='0':g='0':b='0':a='if(lte((X-147)*(X-147)+(Y-147)*(Y-147),147*147),240,0)'[inner];[outer][inner]overlay=13:13,drawtext=text='{escaped}':x=(w-text_w)/2:y=(h-text_h)/2:fontcolor=white:fontsize=140:borderw=2:bordercolor=0x63d8ff[badge];[base][badge]overlay=(W-w)/2:(H-h)/2[out]"));
    command
        .args(["-filter_complex", &graph, "-map", "[out]", "-frames:v", "1"])
        .arg(output);
    command_error(
        run_hidden(&mut command).map_err(|e| format!("Cannot start FFmpeg: {e}"))?,
        "Marathon background",
    )
}

#[tauri::command]
pub async fn generate_marathon(request: MarathonRequest) -> Result<GenerateReport, String> {
    tauri::async_runtime::spawn_blocking(move || generate_marathon_inner(request))
        .await
        .map_err(|error| format!("Dan generation was interrupted: {error}"))?
}

/// Uses the exact same resolver as .osz generation so the Dan preview remains
/// correct when one beatmapset has different backgrounds per difficulty.
#[tauri::command]
pub fn resolve_marathon_backgrounds(items: Vec<MarathonItem>) -> Vec<Option<String>> {
    items
        .iter()
        .map(|item| {
            fs::read_to_string(&item.osu_path)
                .ok()
                .and_then(|raw| selected_marathon_background(item, &raw))
                .map(|path| path.to_string_lossy().into_owned())
        })
        .collect()
}

fn generate_marathon_inner(request: MarathonRequest) -> Result<GenerateReport, String> {
    if request.items.is_empty() {
        return Err("Add at least one map to the marathon.".into());
    }
    let parent = PathBuf::from(&request.output_folder);
    if !parent.is_dir() {
        return Err("Output folder does not exist.".into());
    }
    let work = TempDir::new().map_err(|e| e.to_string())?;
    let exe = ffmpeg(request.ffmpeg_path.as_deref());
    let mut clips = Vec::new();
    let mut lead_ins = Vec::new();
    let mut raws = Vec::new();
    let mut trims = Vec::new();
    let mut backgrounds = Vec::new();
    let mut offsets = Vec::new();
    let mut offset = 0.0;
    let mut warnings = Vec::new();
    for (index, item) in request.items.iter().enumerate() {
        let raw =
            fs::read_to_string(&item.osu_path).map_err(|e| format!("Cannot read map: {e}"))?;
        let folder = Path::new(&item.folder_path);
        let source = resolve_asset(folder, audio_name(&raw))
            .ok_or_else(|| format!("Audio not found for {}", item.difficulty))?;
        let clip = work.path().join(format!("clip-{index}.ogg"));
        // AudioLeadIn is part of osu!'s chart/audio relationship. Keep it in the
        // generated stage, even though the merged .osu itself has AudioLeadIn: 0.
        let lead_in_ms = audio_lead_in_ms(&raw);
        let trim_ms = silent_intro_trim_ms(&raw, request.trim_silent_intros);
        let remaining_lead_in_ms = (lead_in_ms - trim_ms).max(0.0);
        let source_start_ms = (trim_ms - lead_in_ms).max(0.0);
        let gameplay_duration = (map_end_ms(&raw) - trim_ms).max(1.0) / item.rate.max(0.1);
        transform_marathon_audio(
            &exe,
            &source,
            &clip,
            item.rate,
            item.pitch,
            gameplay_duration,
            source_start_ms,
            trim_ms > 0.0,
        )?;
        let clip_duration = audio_duration_ms(&exe, &clip)?;
        clips.push(clip);
        lead_ins.push(remaining_lead_in_ms / 1000.0);
        raws.push(raw.clone());
        trims.push(trim_ms);
        offsets.push(offset);
        offset += remaining_lead_in_ms + clip_duration;
        if index < request.items.len() - 1 {
            offset += request.breaks.get(index).copied().unwrap_or(0.).max(0.) * 1000.;
        }
        if let Some(bg) = selected_marathon_background(item, &raw) {
            backgrounds.push(bg);
        }
    }
    let audio_name_out = "marathon.ogg";
    marathon_audio(
        &exe,
        &clips,
        &lead_ins,
        &request.breaks,
        &work.path().join(audio_name_out),
    )?;
    let bg_name_out = "marathon-bg.png";
    if backgrounds.is_empty() {
        warnings.push("No source background was found; using a generated fallback.".into());
    }
    marathon_background(
        &exe,
        &backgrounds,
        &request.symbol,
        &work.path().join(bg_name_out),
        work.path(),
    )?;
    let merged = raws[0].clone();
    let dan_bpm = raws
        .iter()
        .filter_map(|raw| highest_bpm(raw))
        .max_by(|left, right| left.total_cmp(right))
        .unwrap_or(120.0);
    let beat_length = 60_000.0 / dan_bpm;
    let mut lines = Vec::new();
    let mut section = String::new();
    for raw in merged.lines() {
        let t = raw.trim_start_matches('\u{feff}');
        if t == "[HitObjects]" || t == "[TimingPoints]" {
            break;
        }
        if section == "[General]" {
            if t.starts_with("AudioFilename:") {
                lines.push(format!("AudioFilename: {audio_name_out}"));
                continue;
            }
            if t.starts_with("AudioLeadIn:") {
                lines.push("AudioLeadIn: 0".into());
                continue;
            }
        }
        if section == "[Events]"
            && (t.starts_with("0,0,") || t.to_ascii_lowercase().starts_with("background"))
        {
            continue;
        }
        if t.starts_with('[') && t.ends_with(']') {
            section = t.to_string();
        }
        if section == "[Metadata]" {
            if t.starts_with("Title:") || t.starts_with("TitleUnicode:") {
                let key = if t.starts_with("TitleUnicode:") {
                    "TitleUnicode"
                } else {
                    "Title"
                };
                lines.push(format!("{key}: {}", request.pack_name));
                continue;
            }
            if t.starts_with("Artist:") || t.starts_with("ArtistUnicode:") {
                let key = if t.starts_with("ArtistUnicode:") {
                    "ArtistUnicode"
                } else {
                    "Artist"
                };
                lines.push(format!("{key}: {}", request.artist));
                continue;
            }
            if t.starts_with("Creator:") {
                lines.push(format!("Creator: {}", request.author));
                continue;
            }
            if t.starts_with("Version:") {
                lines.push(format!("Version: {}", request.version));
                continue;
            }
            if t.starts_with("Source:") {
                lines.push("Source: osu!mania Dan".into());
                continue;
            }
            if t.starts_with("Tags:") {
                lines.push("Tags: dan".into());
                continue;
            }
            if t.starts_with("BeatmapID:") {
                lines.push("BeatmapID: 0".into());
                continue;
            }
            if t.starts_with("BeatmapSetID:") {
                lines.push("BeatmapSetID: -1".into());
                continue;
            }
        }
        if section == "[Difficulty]" {
            if t.starts_with("HPDrainRate:") {
                lines.push("HPDrainRate: 8.5".into());
                continue;
            }
            if t.starts_with("CircleSize:") {
                lines.push("CircleSize: 4".into());
                continue;
            }
            if t.starts_with("OverallDifficulty:") {
                lines.push("OverallDifficulty: 9".into());
                continue;
            }
        }
        lines.push(t.to_string());
    }
    lines.push(format!("0,0,{bg_name_out}"));
    lines.push("".into());
    lines.push("[TimingPoints]".into());
    lines.push(format!("0,{beat_length:.8},4,2,0,100,1,0"));
    lines.push("".into());
    lines.push("[HitObjects]".into());
    for ((raw, shift), trim) in raws.iter().zip(offsets.iter()).zip(trims.iter()) {
        lines.extend(shifted_section(raw, "[HitObjects]", *shift - *trim));
    }
    let osu_name = format!(
        "{} - {} [{}].osu",
        safe_name(&request.artist),
        safe_name(&request.pack_name),
        safe_name(&request.version)
    );
    fs::write(work.path().join(&osu_name), lines.join("\n") + "\n").map_err(|e| e.to_string())?;
    let output = unique_file(&parent, &format!("{}.osz", safe_name(&request.pack_name)));
    zip_dir(work.path(), &output)?;
    Ok(GenerateReport {
        output_path: output.to_string_lossy().into_owned(),
        mapsets: 1,
        difficulties: 1,
        warnings,
    })
}
#[tauri::command]
pub fn estimate_pack_size(items: Vec<SizeItem>) -> u64 {
    items
        .into_iter()
        .flat_map(|item| {
            let raw = fs::read_to_string(&item.osu_path).unwrap_or_default();
            let folder = PathBuf::from(item.folder_path);
            let mut paths = vec![PathBuf::from(item.osu_path)];
            if let Some(p) = resolve_asset(&folder, audio_name(&raw)) {
                paths.push(p)
            }
            if let Some(p) = item
                .custom_background_path
                .map(PathBuf::from)
                .filter(|p| p.is_file())
                .or_else(|| resolve_asset(&folder, bg_name(&raw)))
            {
                paths.push(p)
            }
            paths.extend(item.overlays.into_iter().map(|o| PathBuf::from(o.path)));
            paths
        })
        .filter_map(|p| fs::metadata(p).ok().map(|m| m.len()))
        .sum()
}
#[tauri::command]
pub fn create_audio_preview(item: PreviewItem) -> Result<String, String> {
    let raw = fs::read_to_string(&item.osu_path).map_err(|e| e.to_string())?;
    let source = resolve_asset(Path::new(&item.folder_path), audio_name(&raw))
        .ok_or_else(|| "Audio file not found.".to_string())?;
    let preview = raw
        .lines()
        .find(|l| l.starts_with("PreviewTime:"))
        .and_then(field)
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(0.)
        .max(0.)
        / 1000.;
    let pitch = item.pitch
        + if item.trainer.change_pitch.unwrap_or(false) {
            12. * item.rate.log2()
        } else {
            0.
        };
    let path = std::env::temp_dir().join("osu-pack-studio-preview");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let output = path.join(format!("{}.ogg", Uuid::new_v4()));
    let pitch_rate = 2f64.powf(pitch / 12.);
    let filter = format!(
        "aresample=48000,asetrate=48000*{pitch_rate:.10},aresample=48000,{},asetpts=PTS-STARTPTS",
        atempo_chain(item.rate / pitch_rate)
    );
    let mut command = Command::new(ffmpeg(item.ffmpeg_path.as_deref()));
    command
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            &preview.to_string(),
            "-i",
        ])
        .arg(source)
        .args([
            "-t",
            "25",
            "-vn",
            "-filter:a",
            &filter,
            "-c:a",
            "libvorbis",
            "-q:a",
            "4",
        ])
        .arg(&output);
    command_error(
        run_hidden(&mut command).map_err(|e| format!("Cannot start FFmpeg: {e}"))?,
        "Audio preview",
    )?;
    Ok(output.to_string_lossy().into_owned())
}
#[cfg(test)]
mod tests {
    use super::*;

    fn write_silent_wav(path: &Path) {
        let sample_rate = 48_000u32;
        let channels = 2u16;
        let bits_per_sample = 16u16;
        let samples = sample_rate * 2;
        let data_len = samples * channels as u32 * (bits_per_sample as u32 / 8);
        let mut wav = Vec::with_capacity(44 + data_len as usize);
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data_len).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&channels.to_le_bytes());
        wav.extend_from_slice(&sample_rate.to_le_bytes());
        wav.extend_from_slice(
            &(sample_rate * channels as u32 * (bits_per_sample as u32 / 8)).to_le_bytes(),
        );
        wav.extend_from_slice(&(channels * (bits_per_sample / 8)).to_le_bytes());
        wav.extend_from_slice(&bits_per_sample.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data_len.to_le_bytes());
        wav.resize(44 + data_len as usize, 0);
        fs::write(path, wav).unwrap();
    }

    fn write_marathon_fixture(
        root: &Path,
        name: &str,
        beat_length: f64,
        audio_lead_in_ms: u32,
        hit_time_ms: u32,
    ) -> MarathonItem {
        let folder = root.join(name);
        fs::create_dir_all(&folder).unwrap();
        write_silent_wav(&folder.join("audio.wav"));
        let osu_path = folder.join("map.osu");
        let hold_end_ms = hit_time_ms + 300;
        fs::write(
            &osu_path,
            format!("osu file format v14\n\n[General]\nAudioFilename: audio.wav\nAudioLeadIn: {audio_lead_in_ms}\nMode: 3\n\n[Metadata]\nTitle: {name}\nTitleUnicode: {name} Unicode\nArtist: Test\nArtistUnicode: Test Unicode\nCreator: Test\nVersion: Hard\nSource: Original source\nTags: original tags\nBeatmapID: 123\nBeatmapSetID: 456\n\n[Difficulty]\nHPDrainRate: 5\nCircleSize: 7\nOverallDifficulty: 6\n\n[Events]\n\n[TimingPoints]\n0,{beat_length},4,2,0,100,1,0\n400,-100,4,2,0,100,0,0\n\n[HitObjects]\n256,192,{hit_time_ms},1,0,0:0:0:0:\n128,192,{hit_time_ms},128,0,{hold_end_ms}:0:0:0:0:\n"),
        )
        .unwrap();
        MarathonItem {
            folder_path: folder.to_string_lossy().into_owned(),
            osu_path: osu_path.to_string_lossy().into_owned(),
            artist: "Test".into(),
            title: name.into(),
            creator: "Test".into(),
            difficulty: "Hard".into(),
            rate: 1.0,
            pitch: 0.0,
            background_path: None,
        }
    }

    fn audio_duration_seconds(ffmpeg: &Path, audio: &Path) -> f64 {
        let output = Command::new(ffmpeg)
            .args(["-hide_banner", "-i"])
            .arg(audio)
            .args(["-f", "null", "-"])
            .output()
            .unwrap();
        assert!(output.status.success());
        let stderr = String::from_utf8_lossy(&output.stderr);
        let duration = stderr
            .split("Duration: ")
            .nth(1)
            .unwrap()
            .split(',')
            .next()
            .unwrap();
        let values = duration
            .split(':')
            .map(|value| value.trim().parse::<f64>().unwrap())
            .collect::<Vec<_>>();
        values[0] * 3600.0 + values[1] * 60.0 + values[2]
    }

    #[test]
    fn safe_names() {
        assert_eq!(safe_name("a:b?"), "a_b_")
    }
    #[test]
    fn tempo() {
        assert_eq!(atempo_chain(4.), "atempo=2,atempo=2.00000000")
    }

    #[test]
    fn dan_background_prefers_the_exact_osu_event_over_a_cached_set_path() {
        let temp = tempfile::tempdir().unwrap();
        let event_background = temp.path().join("difficulty-background.jpg");
        let stale_background = temp.path().join("set-background.jpg");
        fs::write(&event_background, []).unwrap();
        fs::write(&stale_background, []).unwrap();
        let item = MarathonItem {
            folder_path: temp.path().to_string_lossy().into_owned(),
            osu_path: temp.path().join("map.osu").to_string_lossy().into_owned(),
            artist: String::new(),
            title: String::new(),
            creator: String::new(),
            difficulty: String::new(),
            rate: 1.0,
            pitch: 0.0,
            background_path: Some(stale_background.to_string_lossy().into_owned()),
        };
        let raw = "[Events]\n0,0,\"difficulty-background.jpg\",0,0\n";
        assert_eq!(
            selected_marathon_background(&item, raw).unwrap(),
            event_background.canonicalize().unwrap()
        );
    }

    #[test]
    fn shifting_a_dan_stage_keeps_mania_hold_duration_intact() {
        let source = "[HitObjects]\n256,192,100,1,0,0:0:0:0:\n128,192,200,128,0,800:0:0:0:0:\n";
        assert_eq!(
            shifted_section(source, "[HitObjects]", 2_000.0),
            vec![
                "256,192,2100,1,0,0:0:0:0:",
                "128,192,2200,128,0,2800:0:0:0:0:"
            ]
        );
    }

    #[test]
    fn silent_intro_trim_places_the_first_note_after_the_fade() {
        let source = "[HitObjects]\n256,192,10000,1,0,0:0:0:0:\n";
        assert_eq!(silent_intro_trim_ms(source, true), 8_500.0);
        assert_eq!(silent_intro_trim_ms(source, false), 0.0);
    }

    #[test]
    fn marathon_audio_graph_uses_only_existing_silence_segments() {
        let (without_breaks, silences) = marathon_audio_plan(4, &[], &[]);
        assert!(silences.is_empty());
        assert!(without_breaks.contains("[a0][a1][a2][a3]concat=n=4:v=0:a=1[out]"));
        assert!(!without_breaks.contains("[s0]"));

        let (with_breaks, silences) = marathon_audio_plan(4, &[1.2, 0.0, 0.5], &[2.5, 0.0, 1.0]);
        assert_eq!(silences, vec![1.2, 2.5, 0.5, 1.0]);
        assert!(with_breaks.contains("[l0][a0][s1][a1][l2][a2][s3][a3]concat=n=8:v=0:a=1[out]"));
    }

    #[test]
    fn marathon_generation_creates_a_playable_osz_with_merged_assets() {
        let ffmpeg = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("ffmpeg.exe");
        if !ffmpeg.is_file() {
            return;
        }
        let temp = tempfile::tempdir().unwrap();
        let maps = temp.path().join("maps");
        let output = temp.path().join("output");
        fs::create_dir_all(&output).unwrap();
        let request = MarathonRequest {
            pack_name: "Dan Test".into(),
            artist: "Various Artists".into(),
            author: "Pack Studio".into(),
            version: "Dan".into(),
            symbol: "Ω".into(),
            output_folder: output.to_string_lossy().into_owned(),
            ffmpeg_path: Some(ffmpeg.to_string_lossy().into_owned()),
            items: vec![
                write_marathon_fixture(&maps, "first", 500.0, 0, 0),
                // The second stage has the lead-in that was previously lost,
                // producing an offset chart when seeking in the editor.
                write_marathon_fixture(&maps, "second", 250.0, 1_200, 1_200),
            ],
            breaks: vec![0.25],
            trim_silent_intros: false,
        };

        let report = generate_marathon_inner(request).unwrap();
        let archive = fs::File::open(report.output_path).unwrap();
        let mut zip = zip::ZipArchive::new(archive).unwrap();
        let names = zip.file_names().map(str::to_owned).collect::<Vec<_>>();
        assert!(names.iter().any(|name| name == "marathon.ogg"));
        assert!(
            names.iter().any(|name| name == "marathon-bg.png"),
            "archive entries: {names:?}"
        );
        let osu_name = names
            .iter()
            .find(|name| name.ends_with(".osu"))
            .unwrap()
            .clone();
        let mut audio = zip.by_name("marathon.ogg").unwrap();
        let extracted_audio = temp.path().join("marathon.ogg");
        let mut audio_bytes = Vec::new();
        audio.read_to_end(&mut audio_bytes).unwrap();
        drop(audio);
        fs::write(&extracted_audio, audio_bytes).unwrap();
        let mut osu = String::new();
        zip.by_name(&osu_name)
            .unwrap()
            .read_to_string(&mut osu)
            .unwrap();
        assert!(osu.contains("AudioFilename: marathon.ogg"));
        assert!(osu.contains("0,0,marathon-bg.png"));
        assert!(osu.contains("Title: Dan Test"));
        assert!(osu.contains("TitleUnicode: Dan Test"));
        assert!(osu.contains("Artist: Various Artists"));
        assert!(osu.contains("ArtistUnicode: Various Artists"));
        assert!(osu.contains("Creator: Pack Studio"));
        assert!(osu.contains("Version: Dan"));
        assert!(osu.contains("HPDrainRate: 8.5"));
        assert!(osu.contains("CircleSize: 4"));
        assert!(osu.contains("OverallDifficulty: 9"));
        assert!(osu.contains("AudioLeadIn: 0"));
        assert!(osu.contains("256,192,2750,1,0"));
        assert!(osu.contains("128,192,2750,128,0,3050:0:0:0:0:"));
        assert_eq!(
            section_text(&osu, "[TimingPoints]"),
            vec!["0,250.00000000,4,2,0,100,1,0"]
        );
        // first stage (1.3s including its hold) + configured break (0.25s) + second stage
        // (1.2s lead-in + 2s source audio)
        let generated_duration = audio_duration_seconds(&ffmpeg, &extracted_audio);
        assert!(
            (generated_duration - 4.75).abs() < 0.15,
            "expected 4.75s, got {generated_duration}s"
        );
    }
}
