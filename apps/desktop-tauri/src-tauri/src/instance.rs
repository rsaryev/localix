//! One Localix per data folder, whichever copy of the app is launched.
//!
//! THE DEFECT. macOS LaunchServices keeps an app single-instance per BUNDLE PATH, not per bundle
//! id, and `tauri-plugin-single-instance` is not registered on macOS (lib.rs explains why). With
//! two copies installed under one id — `/Applications/Localix.app` and a local build in
//! `target/release/bundle/macos` — a screen recorder that "activated `ai.localix.tauri`" launched
//! the copy that was not running. Each copy then started its own runtime over `~/.localix`, each
//! runtime stopped the other's as an incompatible build, each shell restarted its own, and the two
//! took the database from each other every few seconds.
//!
//! THE GUARD. The first shell takes an exclusive advisory lock on `~/.localix/desktop-shell.lock`
//! for its whole life (the kernel drops it when the process ends, however it ends). A shell that
//! cannot take it hands off to the owner (`instance_handoff`) and leaves before it starts a runtime
//! or touches the database. A shell from before this guard holds no lock, so its live desktop
//! runtime (named in the endpoint descriptor) identifies it too.

#[path = "instance_handoff.rs"]
pub(crate) mod handoff;

use std::fs::{File, OpenOptions, TryLockError};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use crate::log::logln;
use crate::runtime_contract::DESKTOP_RUNTIME_ARG;

/// What this launch of the shell is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Role {
    /// Owns the data folder: starts the runtime and serves hand-offs.
    Primary,
    /// Another shell owns it: forward what this launch was asked to open, focus it, leave.
    Secondary { owner: Option<u32> },
}

/// What trying the lock found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LockState {
    Acquired,
    HeldBy(Option<u32>),
    /// The lock file could not be opened or locked at all: fail open, as before this guard.
    Unavailable,
}

/// What to do about it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Decision {
    Primary,
    /// The holder is the shell that spawned this one: tauri's restart starts the new process
    /// before the old one exits, so wait for the old one to leave instead of handing off to it.
    WaitForParent,
    HandOff(Option<u32>),
}

pub(crate) fn decide(lock: LockState, parent_pid: u32, legacy_owner: Option<u32>) -> Decision {
    match lock {
        LockState::HeldBy(Some(holder)) if holder == parent_pid => Decision::WaitForParent,
        LockState::HeldBy(holder) => Decision::HandOff(holder),
        LockState::Acquired | LockState::Unavailable => match legacy_owner {
            Some(shell) => Decision::HandOff(Some(shell)),
            None => Decision::Primary,
        },
    }
}

/// From `ps -o ppid=,command=` for a runtime pid: the shell that owns it when it is a desktop
/// runtime whose parent is another live shell — not launchd (an orphan), us, or our parent.
pub(crate) fn shell_owning_runtime(ps_line: &str, self_pid: u32, parent_pid: u32) -> Option<u32> {
    let line = ps_line.trim();
    let (ppid, command) = line.split_once(char::is_whitespace)?;
    let ppid: u32 = ppid.parse().ok()?;
    let is_desktop_runtime = command
        .split_whitespace()
        .any(|arg| arg == DESKTOP_RUNTIME_ARG);
    (is_desktop_runtime && ppid > 1 && ppid != self_pid && ppid != parent_pid).then_some(ppid)
}

/// `~/.localix`, the folder the runtime and its database live in (the parent of `log_dir`).
pub(crate) fn data_dir() -> PathBuf {
    let logs = crate::log::log_dir();
    logs.parent().map(Path::to_path_buf).unwrap_or(logs)
}

/// The held lock. Never dropped: releasing it is the process ending.
static LOCK: OnceLock<File> = OnceLock::new();

fn try_lock(dir: &Path) -> LockState {
    if std::fs::create_dir_all(dir).is_err() {
        return LockState::Unavailable;
    }
    // Not truncated on open: the holder's pid is in it, and is what a hand-off focuses.
    let Ok(mut file) = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(dir.join("desktop-shell.lock"))
    else {
        return LockState::Unavailable;
    };
    match file.try_lock() {
        Ok(()) => {
            let _ = file.set_len(0);
            let _ = file.seek(SeekFrom::Start(0));
            let _ = write!(file, "{}", std::process::id());
            let _ = file.flush();
            let _ = LOCK.set(file);
            LockState::Acquired
        }
        Err(TryLockError::WouldBlock) => {
            let mut text = String::new();
            let _ = file.read_to_string(&mut text);
            LockState::HeldBy(text.trim().parse().ok())
        }
        Err(TryLockError::Error(_)) => LockState::Unavailable,
    }
}

/// A shell from before this lock, found through the runtime it is running.
fn legacy_owner(dir: &Path, self_pid: u32, parent_pid: u32) -> Option<u32> {
    ["localix.db.api-runtime.json", "api-runtime.json"]
        .iter()
        .filter_map(|name| std::fs::read_to_string(dir.join(name)).ok())
        .filter_map(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .filter_map(|value| value.get("pid")?.as_u64())
        .find_map(|pid| {
            let output = std::process::Command::new("ps")
                .args(["-o", "ppid=,command=", "-p", &pid.to_string()])
                .stderr(std::process::Stdio::null())
                .output()
                .ok()?;
            shell_owning_runtime(
                &String::from_utf8_lossy(&output.stdout),
                self_pid,
                parent_pid,
            )
        })
}

/// How long a restarted shell waits for the one that spawned it to let go.
const PARENT_EXIT_WAIT: Duration = Duration::from_secs(15);

/// Decide this launch's role. Runs before tauri builds anything.
pub(crate) fn claim() -> Role {
    let dir = data_dir();
    let self_pid = std::process::id();
    let parent_pid = std::os::unix::process::parent_id();
    let mut lock = try_lock(&dir);
    let legacy = || legacy_owner(&dir, self_pid, parent_pid);
    let decision = match lock {
        LockState::Acquired | LockState::Unavailable => decide(lock, parent_pid, legacy()),
        held => decide(held, parent_pid, None),
    };
    let decision = if decision == Decision::WaitForParent {
        let until = Instant::now() + PARENT_EXIT_WAIT;
        while Instant::now() < until {
            std::thread::sleep(Duration::from_millis(100));
            lock = try_lock(&dir);
            if lock == LockState::Acquired {
                break;
            }
        }
        match lock {
            LockState::Acquired => decide(lock, parent_pid, legacy()),
            _ => Decision::HandOff(Some(parent_pid)),
        }
    } else {
        decision
    };
    logln(format!("instance: lock={lock:?} decision={decision:?}"));
    match decision {
        Decision::HandOff(owner) => Role::Secondary { owner },
        _ => Role::Primary,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_free_lock_makes_this_shell_the_owner() {
        assert_eq!(decide(LockState::Acquired, 10, None), Decision::Primary);
        // No lock at all is the old behaviour, not a reason to refuse to start.
        assert_eq!(decide(LockState::Unavailable, 10, None), Decision::Primary);
    }

    #[test]
    fn a_held_lock_hands_off_to_its_holder() {
        assert_eq!(
            decide(LockState::HeldBy(Some(42)), 10, None),
            Decision::HandOff(Some(42))
        );
        assert_eq!(
            decide(LockState::HeldBy(None), 10, None),
            Decision::HandOff(None)
        );
    }

    #[test]
    fn a_restart_waits_for_the_shell_that_spawned_it() {
        assert_eq!(
            decide(LockState::HeldBy(Some(10)), 10, None),
            Decision::WaitForParent
        );
    }

    #[test]
    fn a_shell_from_before_the_lock_is_found_through_its_runtime() {
        assert_eq!(
            decide(LockState::Acquired, 10, Some(77)),
            Decision::HandOff(Some(77))
        );
    }

    #[test]
    fn only_a_live_other_shells_desktop_runtime_names_an_owner() {
        let runtime =
            "  777 /Applications/Localix.app/Contents/MacOS/bun server.js --desktop-runtime";
        assert_eq!(shell_owning_runtime(runtime, 1, 2), Some(777));
        // Orphaned (its shell is gone), ours, or our parent's: not another copy.
        let orphan = "1 bun server.js --desktop-runtime";
        assert_eq!(shell_owning_runtime(orphan, 5, 6), None);
        assert_eq!(shell_owning_runtime(runtime, 777, 2), None);
        assert_eq!(shell_owning_runtime(runtime, 1, 777), None);
        // A dev server or daemon, or a pid that no longer exists.
        assert_eq!(shell_owning_runtime("777 bun src/index.ts", 1, 2), None);
        assert_eq!(shell_owning_runtime("", 1, 2), None);
    }

    #[test]
    fn the_lock_is_exclusive_across_handles() {
        let dir = std::env::temp_dir().join(format!("localix-instance-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("desktop-shell.lock");
        let first = File::create(&path).unwrap();
        first.try_lock().unwrap();
        let second = OpenOptions::new().write(true).open(&path).unwrap();
        assert!(matches!(second.try_lock(), Err(TryLockError::WouldBlock)));
        drop(first);
        assert!(second.try_lock().is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
