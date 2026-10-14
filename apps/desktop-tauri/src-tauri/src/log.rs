//! Boot/crash log for the packaged shell.
//!
//! A bundled app has no console, so every diagnostic the shell emits lands in one
//! file. Owning the path here means no caller ever names it.
//!
//! ONE log directory, ONE line format, ONE launch id. The shell used to write plain text to
//! `$TMPDIR/localix-tauri.log` — a directory the OS empties, shared by every user on Linux —
//! while the API wrote JSON to `~/.localix/localix-api.log`, and nothing tied a line in one to
//! the launch it belonged to in the other. So a startup could not be followed across the
//! processes that make it up. Every line is now one JSON object under `~/.localix/logs/`
//! carrying `source` (`shell`, or `ui` for what the page reports) and the `launch` id the
//! shell also hands the API (`LOCALIX_LAUNCH_ID`), which stamps it on its own lines in
//! `api.log`. `bun run logs` merges them into one timeline.

use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// Process start, as close to it as the first caller gets.
///
/// The log already carries the two milestones the WEB side owns (`shell.paint`,
/// `workspace.ready`) and the one the sidecar owns (`runtime ready after …`), but
/// nothing timed the native half. Measured on the packaged build, launch → first
/// paint is 1.7s while the sidecar is ready in 0.65s alongside it — so the whole
/// remaining startup cost lives in shell init + webview creation, and it was the
/// one span with no number on it. This makes it a permanent, zero-cost readout
/// instead of something that has to be re-measured by hand.
static PROCESS_START: OnceLock<Instant> = OnceLock::new();

/// Milliseconds since the first call to this module. Call once at the top of
/// `run()` so the origin is the process, not whichever milestone logged first.
pub(crate) fn elapsed_ms() -> u128 {
    PROCESS_START
        .get_or_init(Instant::now)
        .elapsed()
        .as_millis()
}

/// This launch's id: epoch milliseconds and the shell's pid, in base 36. Unique per launch on
/// one machine, sortable by time, and short enough to read in a log line.
pub(crate) fn launch_id() -> &'static str {
    static LAUNCH_ID: OnceLock<String> = OnceLock::new();
    LAUNCH_ID.get_or_init(|| {
        let epoch_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        format!(
            "{}-{}",
            base36(epoch_ms),
            base36(std::process::id() as u128)
        )
    })
}

fn base36(mut value: u128) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while value > 0 {
        out.push(DIGITS[(value % 36) as usize]);
        value /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

/// The directory every Localix log lives in: `~/.localix/logs`, the same home the API resolves
/// (`HOME`, `USERPROFILE` on Windows). Without a home the temp dir still gets the log.
pub(crate) fn log_dir() -> PathBuf {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .filter(|home| !home.is_empty())
        .map(PathBuf::from);
    match home {
        Some(home) => home.join(".localix").join("logs"),
        None => std::env::temp_dir().join("localix-logs"),
    }
}

/// One log line: a JSON object with the fields every Localix log shares.
fn json_line(level: &str, source: &str, extra: serde_json::Value, msg: &str) -> String {
    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let mut line = serde_json::json!({
        "time": time,
        "level": level,
        "source": source,
        "launch": launch_id(),
        "sinceStartMs": elapsed_ms() as u64,
        "msg": msg,
    });
    if let (Some(line), serde_json::Value::Object(extra)) = (line.as_object_mut(), extra) {
        line.extend(extra);
    }
    line.to_string()
}

/// Append a line stamped with milliseconds since process start.
pub(crate) fn logln_at(msg: impl AsRef<str>) {
    logln(msg);
}

/// Append a line the PAGE reported (`frontend_log`), tagged `source: "ui"` with its scope.
pub(crate) fn log_ui(scope: &str, msg: &str) {
    write_raw(&json_line(
        "info",
        "ui",
        serde_json::json!({ "scope": scope }),
        msg,
    ));
}

/// Rotate the log once it passes this size (~2 MiB). A menu-bar app can run for
/// days, and the log was append-only with no bound — over a long session it would
/// grow without limit. One generation is kept as `<name>.old`.
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;

struct LogFile {
    path: PathBuf,
    writer: Option<BufWriter<File>>,
    bytes: u64,
    flush_each_line: bool,
}

impl LogFile {
    fn new() -> Self {
        let dir = log_dir();
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("desktop.log");
        let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        Self {
            path,
            writer: None,
            bytes,
            flush_each_line: false,
        }
    }

    fn write_line(&mut self, msg: &str) {
        // Cap unbounded growth: when the file exceeds the limit, rotate it to
        // `<name>.old` (overwriting the previous generation) and start fresh. All of
        // this is best-effort — any failure just falls through to the append below.
        if self.bytes > MAX_LOG_BYTES {
            self.writer.take();
            let _ = std::fs::rename(&self.path, self.path.with_extension("log.old"));
            self.bytes = std::fs::metadata(&self.path).map(|m| m.len()).unwrap_or(0);
        }
        if self.writer.is_none() {
            self.writer = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)
                .ok()
                .map(BufWriter::new);
        }
        if let Some(writer) = self.writer.as_mut() {
            if writeln!(writer, "{msg}").is_ok() {
                self.bytes = self.bytes.saturating_add(msg.len() as u64 + 1);
            }
            if self.flush_each_line {
                let _ = writer.flush();
            }
        }
    }

    fn flush_startup(&mut self) {
        if let Some(writer) = self.writer.as_mut() {
            let _ = writer.flush();
        }
        self.flush_each_line = true;
    }
}

static LOG_FILE: OnceLock<Mutex<LogFile>> = OnceLock::new();

/// Append a shell line to the crash/boot log, `~/.localix/logs/desktop.log` (read it with
/// `bun run logs`). Best-effort: a logging failure is never allowed to fail the operation
/// being logged.
pub(crate) fn logln(msg: impl AsRef<str>) {
    write_raw(&json_line(
        "info",
        "shell",
        serde_json::Value::Null,
        msg.as_ref(),
    ));
}

fn write_raw(line: &str) {
    if let Ok(mut log) = LOG_FILE.get_or_init(|| Mutex::new(LogFile::new())).lock() {
        log.write_line(line);
    }
}

/// Flush the buffered cold-start milestones after the window is revealed. Later
/// lines flush immediately so crash diagnostics keep their previous durability.
pub(crate) fn flush_startup_log() {
    if let Some(file) = LOG_FILE.get() {
        if let Ok(mut log) = file.lock() {
            log.flush_startup();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_line_is_one_json_object_with_the_shared_fields() {
        let line = json_line(
            "info",
            "shell",
            serde_json::Value::Null,
            "setup \"entered\"\nnext",
        );
        assert!(!line.contains('\n'), "a line must not break: {line}");
        let parsed: serde_json::Value = serde_json::from_str(&line).expect("valid JSON");
        assert_eq!(parsed["source"], "shell");
        assert_eq!(parsed["level"], "info");
        assert_eq!(parsed["launch"], launch_id());
        assert_eq!(parsed["msg"], "setup \"entered\"\nnext");
        assert!(parsed["time"].as_u64().unwrap_or(0) > 0);
    }

    #[test]
    fn a_page_line_carries_its_scope_as_a_field() {
        let line = json_line(
            "info",
            "ui",
            serde_json::json!({ "scope": "plugins.ready" }),
            "uiMs=440",
        );
        let parsed: serde_json::Value = serde_json::from_str(&line).expect("valid JSON");
        assert_eq!(parsed["source"], "ui");
        assert_eq!(parsed["scope"], "plugins.ready");
    }

    #[test]
    fn the_launch_id_is_stable_within_a_process_and_readable() {
        assert_eq!(launch_id(), launch_id());
        assert!(launch_id().contains('-'));
        assert!(launch_id()
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-'));
    }

    #[test]
    fn logs_live_under_the_localix_home() {
        let dir = log_dir();
        assert!(
            dir.ends_with(std::path::Path::new(".localix").join("logs"))
                || dir.ends_with("localix-logs")
        );
    }

    #[test]
    fn base36_round_trips_small_values() {
        assert_eq!(base36(0), "0");
        assert_eq!(base36(35), "z");
        assert_eq!(base36(36), "10");
    }
}
