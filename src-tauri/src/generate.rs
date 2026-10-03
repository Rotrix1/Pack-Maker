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
    text.lines().find_map(|line| {
        let l = line.trim_start();
        if l.starts_with('0') || l.to_ascii_lowercase().starts_with("background") {
            let parts: Vec<_> = l.split(',').collect();
            if parts.len() >= 3 {
                return Some(parts[2].trim().trim_matches('"').to_owned());
            }
        }
        None
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
        "aresample=48000,asetrate=48000*{pitch_rate:.10},aresample=48000,{}",
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
        "aresample=48000,asetrate=48000*{pitch_rate:.10},aresample=48000,{}",
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
    #[test]
    fn safe_names() {
        assert_eq!(safe_name("a:b?"), "a_b_")
    }
    #[test]
    fn tempo() {
        assert_eq!(atempo_chain(4.), "atempo=2,atempo=2.00000000")
    }
}
