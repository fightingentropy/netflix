use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::time::timeout;
use url::Url;

use crate::config::Config;
use crate::error::{ApiError, AppResult};

const FFMPEG_CAPABILITY_REFRESH_MS: i64 = 5 * 60 * 1000;
const NATIVE_PLAYER_STATUS_REFRESH_MS: i64 = 5 * 60 * 1000;

#[derive(Debug, Clone, Serialize)]
pub struct EncoderFlags {
    pub h264_videotoolbox: bool,
    pub h264_nvenc: bool,
    pub h264_qsv: bool,
}

#[allow(non_snake_case)]
#[derive(Debug, Clone, Serialize)]
pub struct FfmpegSnapshot {
    pub checkedAt: i64,
    pub ffmpegAvailable: bool,
    pub ffprobeAvailable: bool,
    pub ffmpegVersion: String,
    pub ffprobeVersion: String,
    pub requestedHlsHwaccel: String,
    pub effectiveHlsHwaccel: String,
    pub hwaccels: Vec<String>,
    pub encoders: EncoderFlags,
    pub notes: Vec<String>,
}

#[allow(non_snake_case)]
#[derive(Debug, Clone, Serialize)]
pub struct NativePlayerSnapshot {
    pub checkedAt: i64,
    pub mode: String,
    pub mpvBinary: String,
    pub available: bool,
    pub version: String,
    pub notes: Vec<String>,
}

#[derive(Clone)]
pub struct RuntimeServices {
    config: Config,
    ffmpeg_snapshot: Arc<Mutex<FfmpegSnapshot>>,
    native_snapshot: Arc<Mutex<NativePlayerSnapshot>>,
}

impl RuntimeServices {
    pub fn new(config: Config) -> Self {
        Self {
            ffmpeg_snapshot: Arc::new(Mutex::new(FfmpegSnapshot {
                checkedAt: 0,
                ffmpegAvailable: false,
                ffprobeAvailable: false,
                ffmpegVersion: String::new(),
                ffprobeVersion: String::new(),
                requestedHlsHwaccel: config.hls_hwaccel_mode.clone(),
                effectiveHlsHwaccel: "none".to_owned(),
                hwaccels: Vec::new(),
                encoders: EncoderFlags {
                    h264_videotoolbox: false,
                    h264_nvenc: false,
                    h264_qsv: false,
                },
                notes: Vec::new(),
            })),
            native_snapshot: Arc::new(Mutex::new(NativePlayerSnapshot {
                checkedAt: 0,
                mode: config.native_playback_mode.clone(),
                mpvBinary: config.mpv_binary.clone(),
                available: false,
                version: String::new(),
                notes: Vec::new(),
            })),
            config,
        }
    }

    pub async fn get_ffmpeg_capabilities(&self, force_refresh: bool) -> FfmpegSnapshot {
        let snapshot = self.ffmpeg_snapshot.lock().await.clone();
        if !force_refresh
            && snapshot.checkedAt > 0
            && now_ms() - snapshot.checkedAt < FFMPEG_CAPABILITY_REFRESH_MS
        {
            return snapshot;
        }
        let next = probe_ffmpeg_capabilities(&self.config).await;
        *self.ffmpeg_snapshot.lock().await = next.clone();
        next
    }

    pub async fn get_native_player_status(&self, force_refresh: bool) -> NativePlayerSnapshot {
        let snapshot = self.native_snapshot.lock().await.clone();
        if !force_refresh
            && snapshot.checkedAt > 0
            && now_ms() - snapshot.checkedAt < NATIVE_PLAYER_STATUS_REFRESH_MS
        {
            return snapshot;
        }
        let next = probe_native_player_status(&self.config).await;
        *self.native_snapshot.lock().await = next.clone();
        next
    }

    pub async fn launch_mpv(
        &self,
        source_url: String,
        subtitle_url: String,
        title: String,
        start_seconds: i64,
        audio_sync_ms: i64,
    ) -> AppResult<()> {
        if source_url.trim().is_empty() {
            return Err(ApiError::bad_request("Missing source URL."));
        }
        let safe_start_seconds = start_seconds.max(0);
        let safe_audio_sync_ms = normalize_audio_sync_ms(audio_sync_ms);

        let mut command = Command::new("/bin/sh");
        let mut args = vec![
            self.config.mpv_binary.clone(),
            "--force-window=yes".to_owned(),
            "--idle=no".to_owned(),
            "--keep-open=no".to_owned(),
        ];
        if !title.trim().is_empty() {
            args.push(format!("--title={title}"));
        }
        if safe_start_seconds > 0 {
            args.push(format!("--start={safe_start_seconds}"));
        }
        if safe_audio_sync_ms != 0 {
            args.push(format!(
                "--audio-delay={:.3}",
                safe_audio_sync_ms as f64 / 1000.0
            ));
        }
        if !subtitle_url.trim().is_empty() {
            args.push(format!("--sub-file={subtitle_url}"));
        }
        args.push(source_url);
        let quoted = args
            .into_iter()
            .map(shell_quote)
            .collect::<Vec<_>>()
            .join(" ");
        command
            .arg("-lc")
            .arg(format!("nohup {quoted} >/dev/null 2>&1 &"))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let status = command
            .status()
            .await
            .map_err(|error| ApiError::internal(error.to_string()))?;
        if !status.success() {
            return Err(ApiError::internal("Failed to launch mpv."));
        }
        Ok(())
    }
}

pub fn normalize_audio_sync_ms(value: i64) -> i64 {
    value.clamp(-2_500, 2_500)
}

#[cfg(test)]
pub fn is_loopback_hostname(value: &str) -> bool {
    matches!(
        value.trim().to_lowercase().as_str(),
        "127.0.0.1" | "::1" | "[::1]" | "localhost"
    )
}

pub fn to_absolute_playback_url(value: &str, request_url: &Url) -> String {
    let raw = value.trim();
    if raw.is_empty() {
        return String::new();
    }
    Url::parse(raw)
        .or_else(|_| request_url.join(raw))
        .map(|url| url.to_string())
        .unwrap_or_default()
}

pub fn resolve_effective_remux_hwaccel_mode(
    snapshot: &FfmpegSnapshot,
    requested_mode: &str,
) -> String {
    if can_use_hwaccel_mode(snapshot, requested_mode) {
        requested_mode.to_owned()
    } else {
        "none".to_owned()
    }
}

async fn probe_ffmpeg_capabilities(config: &Config) -> FfmpegSnapshot {
    let mut snapshot = FfmpegSnapshot {
        checkedAt: now_ms(),
        ffmpegAvailable: false,
        ffprobeAvailable: false,
        ffmpegVersion: String::new(),
        ffprobeVersion: String::new(),
        requestedHlsHwaccel: config.hls_hwaccel_mode.clone(),
        effectiveHlsHwaccel: "none".to_owned(),
        hwaccels: Vec::new(),
        encoders: EncoderFlags {
            h264_videotoolbox: false,
            h264_nvenc: false,
            h264_qsv: false,
        },
        notes: Vec::new(),
    };

    match run_process_capture(["ffmpeg", "-hide_banner", "-version"], 5_000).await {
        Ok(output) => {
            snapshot.ffmpegAvailable = true;
            snapshot.ffmpegVersion = output
                .lines()
                .find(|line| line.to_lowercase().starts_with("ffmpeg version"))
                .unwrap_or_default()
                .trim()
                .to_owned();
        }
        Err(message) => snapshot
            .notes
            .push(format!("ffmpeg unavailable: {message}")),
    }

    match run_process_capture(["ffprobe", "-hide_banner", "-version"], 5_000).await {
        Ok(output) => {
            snapshot.ffprobeAvailable = true;
            snapshot.ffprobeVersion = output
                .lines()
                .find(|line| line.to_lowercase().starts_with("ffprobe version"))
                .unwrap_or_default()
                .trim()
                .to_owned();
        }
        Err(message) => snapshot
            .notes
            .push(format!("ffprobe unavailable: {message}")),
    }

    if snapshot.ffmpegAvailable {
        match run_process_capture(["ffmpeg", "-hide_banner", "-hwaccels"], 5_000).await {
            Ok(output) => {
                snapshot.hwaccels = output
                    .lines()
                    .map(|line| line.trim().to_lowercase())
                    .filter(|line| {
                        !line.is_empty()
                            && line != "hardware acceleration methods:"
                            && !line.starts_with("ffmpeg version")
                    })
                    .collect();
            }
            Err(_) => snapshot
                .notes
                .push("Unable to read ffmpeg hwaccels.".to_owned()),
        }
        match run_process_capture(["ffmpeg", "-hide_banner", "-encoders"], 8_000).await {
            Ok(output) => {
                let lowered = output.to_lowercase();
                snapshot.encoders.h264_videotoolbox = lowered.contains("h264_videotoolbox");
                snapshot.encoders.h264_nvenc = lowered.contains("h264_nvenc");
                snapshot.encoders.h264_qsv = lowered.contains("h264_qsv");
            }
            Err(_) => snapshot
                .notes
                .push("Unable to read ffmpeg encoders.".to_owned()),
        }
    }

    if can_use_hwaccel_mode(&snapshot, &config.hls_hwaccel_mode) {
        snapshot.effectiveHlsHwaccel = config.hls_hwaccel_mode.clone();
    } else if config.hls_hwaccel_mode != "none" {
        snapshot.notes.push(format!(
            "Requested HLS hwaccel ({}) is not supported; software fallback will be used.",
            config.hls_hwaccel_mode
        ));
    }

    snapshot
}

async fn probe_native_player_status(config: &Config) -> NativePlayerSnapshot {
    let mut snapshot = NativePlayerSnapshot {
        checkedAt: now_ms(),
        mode: config.native_playback_mode.clone(),
        mpvBinary: config.mpv_binary.clone(),
        available: false,
        version: String::new(),
        notes: Vec::new(),
    };

    if config.native_playback_mode == "off" {
        snapshot
            .notes
            .push("Native playback is disabled by configuration.".to_owned());
        return snapshot;
    }

    match run_process_capture([config.mpv_binary.as_str(), "--version"], 5_000).await {
        Ok(output) => {
            let version_line = output
                .lines()
                .find(|line| line.to_lowercase().starts_with("mpv "))
                .unwrap_or_default()
                .trim()
                .to_owned();
            if version_line.is_empty() {
                snapshot
                    .notes
                    .push("mpv was found but version output was unexpected.".to_owned());
            } else {
                snapshot.available = true;
                snapshot.version = version_line;
            }
        }
        Err(message) => snapshot.notes.push(format!("mpv unavailable: {message}")),
    }

    snapshot
}

pub async fn run_process_capture_text(
    command: &[String],
    timeout_ms: u64,
) -> Result<String, String> {
    let output = run_process_capture_output(command, timeout_ms).await?;
    Ok(String::from_utf8_lossy(&output).to_string())
}

#[allow(dead_code)]
pub async fn run_process_capture_bytes(
    command: &[String],
    timeout_ms: u64,
) -> Result<Vec<u8>, String> {
    run_process_capture_output(command, timeout_ms).await
}

async fn run_process_capture<const N: usize>(
    command: [&str; N],
    timeout_ms: u64,
) -> Result<String, String> {
    let owned = command
        .iter()
        .map(|item| (*item).to_owned())
        .collect::<Vec<_>>();
    let output = run_process_capture_output(&owned, timeout_ms).await?;
    Ok(String::from_utf8_lossy(&output).to_string())
}

async fn run_process_capture_output(
    command: &[String],
    timeout_ms: u64,
) -> Result<Vec<u8>, String> {
    let mut iter = command.iter();
    let Some(program) = iter.next() else {
        return Err("Missing executable.".to_owned());
    };
    let mut child = Command::new(program);
    child
        .args(iter)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = timeout(Duration::from_millis(timeout_ms.max(1_000)), child.output())
        .await
        .map_err(|_| "Request timed out.".to_owned())?
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(if stderr.is_empty() {
            format!("Process exited with code {:?}", output.status.code())
        } else {
            stderr
        });
    }

    Ok(output.stdout)
}

fn can_use_hwaccel_mode(snapshot: &FfmpegSnapshot, mode: &str) -> bool {
    let safe_mode = mode.trim().to_lowercase();
    if safe_mode.is_empty() || safe_mode == "auto" {
        return false;
    }
    if safe_mode == "none" {
        return true;
    }
    if !snapshot.ffmpegAvailable {
        return false;
    }
    match safe_mode.as_str() {
        "videotoolbox" => {
            snapshot.encoders.h264_videotoolbox
                && snapshot.hwaccels.iter().any(|item| item == "videotoolbox")
        }
        "cuda" => {
            snapshot.encoders.h264_nvenc && snapshot.hwaccels.iter().any(|item| item == "cuda")
        }
        "qsv" => snapshot.encoders.h264_qsv && snapshot.hwaccels.iter().any(|item| item == "qsv"),
        _ => false,
    }
}

fn shell_quote(value: String) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{is_loopback_hostname, normalize_audio_sync_ms};

    #[test]
    fn clamps_audio_sync() {
        assert_eq!(normalize_audio_sync_ms(99_000), 2_500);
    }

    #[test]
    fn detects_loopback_hosts() {
        assert!(is_loopback_hostname("localhost"));
        assert!(!is_loopback_hostname("example.com"));
    }
}
