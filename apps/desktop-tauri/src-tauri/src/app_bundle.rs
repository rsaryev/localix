//! Standalone mini apps on disk: `~/Applications/Localix Apps/<Name>.app`, one per mini app the
//! person installed as an app. The bundles are the only record, so the list is whatever is there: a
//! bundle someone deleted in Finder is simply gone, and nothing else needs reconciling.
use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::AppHandle;

use crate::app_bundle_host::{host, info_plist, plist_string, Host};
pub(crate) use crate::app_bundle_names::valid_mini_app;
use crate::app_bundle_names::{bundle_id_part, bundle_name};
use crate::app_runner::keys;

/// The executable inside every standalone mini app: a clone of the host binary (`app_runner.rs`).
pub(crate) const EXECUTABLE: &str = "localix-app";
pub(crate) const ICON: &str = "app";
/// Which host build a bundle was made from; a different build re-clones its binary.
pub(crate) const HOST_BUILD: &str = "LocalixHostBuild";

/// One change to the apps folder at a time: an install from the workspace can meet the refresh a
/// launch runs, and both stage, remove and rename the same bundle paths.
static CHANGES: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledApp {
    pub(crate) mini_app: String,
    pub(crate) name: String,
    pub(crate) path: PathBuf,
    /// The app's project folder; the workspace makes the project for it at install.
    pub(crate) project_dir: Option<PathBuf>,
    #[serde(skip)]
    pub(crate) bundle_id: String,
    #[serde(skip)]
    host_build: Option<String>,
}

/// Development builds keep their own folder and bundle ids, so they never replace a release
/// build's apps (or point them at a development server).
fn apps_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").filter(|home| !home.is_empty())?;
    let folder = if cfg!(debug_assertions) {
        "Localix Dev Apps.localized"
    } else {
        "Localix Apps.localized"
    };
    Some(PathBuf::from(home).join("Applications").join(folder))
}

fn bundle_id(app: &AppHandle, mini_app: &str) -> String {
    let flavour = if cfg!(debug_assertions) {
        "dev.app"
    } else {
        "app"
    };
    format!(
        "{}.{flavour}.{}",
        app.config().identifier,
        bundle_id_part(mini_app)
    )
}

/// Every standalone mini app in the folder, read back from the bundles themselves.
pub(crate) fn installed() -> Vec<InstalledApp> {
    let Some(entries) = apps_dir().and_then(|dir| std::fs::read_dir(dir).ok()) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "app"))
        .filter_map(|path| read_bundle(&path))
        .collect()
}

fn read_bundle(path: &Path) -> Option<InstalledApp> {
    let plist = std::fs::read_to_string(path.join("Contents/Info.plist")).ok()?;
    let read = |key: &str| plist_string(&plist, key);
    let mini_app = read(keys::MINI_APP).filter(|mini_app| valid_mini_app(mini_app))?;
    Some(InstalledApp {
        name: read("CFBundleName").unwrap_or_else(|| mini_app.clone()),
        bundle_id: read("CFBundleIdentifier")?,
        host_build: read(HOST_BUILD),
        project_dir: read(keys::PROJECT).map(PathBuf::from),
        path: path.to_path_buf(),
        mini_app,
    })
}

/// Make (or remake) the bundle for `mini_app`, then swap it in whole: a half-written app is never
/// visible to Finder, Spotlight or the Dock. `icon` is the finished `.icns`.
pub(crate) fn install(
    app: &AppHandle,
    mini_app: &str,
    title: &str,
    icon: &[u8],
) -> Result<InstalledApp, String> {
    if !valid_mini_app(mini_app) {
        return Err(format!("invalid mini app name {mini_app:?}"));
    }
    let _change = CHANGES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let name = bundle_name(title).ok_or("the app needs a name")?;
    let dir = apps_dir().ok_or("no home folder")?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let previous = installed()
        .into_iter()
        .find(|entry| entry.mini_app == mini_app);
    // Another mini app's app may already use this title; keep both.
    let taken =
        |path: &Path| path.exists() && previous.as_ref().is_none_or(|entry| entry.path != path);
    let mut target = dir.join(format!("{name}.app"));
    if taken(&target) {
        target = dir.join(format!("{name} ({mini_app}).app"));
    }
    let host = host(app)?;
    // The app's project lives in this folder; the workspace finds or creates the project for it
    // right after, so the app always opens into a project of its own.
    let project = host.projects.join(mini_app);
    std::fs::create_dir_all(&project).map_err(|error| format!("{}: {error}", project.display()))?;
    let id = bundle_id(app, mini_app);
    let staged = dir.join(format!(".{mini_app}.{}.app", std::process::id()));
    let _ = std::fs::remove_dir_all(&staged);
    let built = build(&staged, &id, &name, mini_app, &host, icon);
    if let Err(error) = built {
        let _ = std::fs::remove_dir_all(&staged);
        return Err(error);
    }
    if let Some(previous) = &previous {
        let _ = std::fs::remove_dir_all(&previous.path);
    }
    let _ = std::fs::remove_dir_all(&target);
    std::fs::rename(&staged, &target).map_err(|error| error.to_string())?;
    register(&target);
    read_bundle(&target).ok_or_else(|| "the new app could not be read back".into())
}

fn build(
    bundle: &Path,
    id: &str,
    name: &str,
    mini_app: &str,
    host: &Host,
    icon: &[u8],
) -> Result<(), String> {
    let contents = bundle.join("Contents");
    let write = |path: PathBuf, bytes: &[u8]| {
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|error| error.to_string())?;
        std::fs::write(&path, bytes).map_err(|error| format!("{}: {error}", path.display()))
    };
    // `fs::copy` clones on APFS, so every app shares the host binary's blocks on disk.
    let executable = contents.join("MacOS").join(EXECUTABLE);
    std::fs::create_dir_all(executable.parent().unwrap()).map_err(|error| error.to_string())?;
    std::fs::copy(&host.executable, &executable).map_err(|error| error.to_string())?;
    write(
        contents.join("Info.plist"),
        info_plist(id, name, mini_app, host).as_bytes(),
    )?;
    write(contents.join("PkgInfo"), b"APPL????")?;
    // A refresh of a bundle whose icon went missing keeps the generic one, not an empty file.
    if !icon.is_empty() {
        write(
            contents.join("Resources").join(format!("{ICON}.icns")),
            icon,
        )?;
    }
    sign(bundle)
}

/// An ad-hoc signature over the new Info.plist; Apple silicon refuses to run an unsigned or
/// mismatched bundle. A bundle made on this Mac carries no quarantine, so Gatekeeper lets it run.
fn sign(bundle: &Path) -> Result<(), String> {
    let output = Command::new("/usr/bin/codesign")
        .args(["--force", "--sign", "-"])
        .arg(bundle)
        .output()
        .map_err(|error| format!("codesign: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    Err(format!(
        "codesign failed: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    ))
}

/// Tell LaunchServices now, so Spotlight and Launchpad list the app without waiting for a scan.
fn register(bundle: &Path) {
    const LSREGISTER: &str = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
    let _ = Command::new(LSREGISTER).arg("-f").arg(bundle).output();
}

/// Remake every bundle a different host build made, keeping its name and icon, so an updated
/// Localix never leaves its apps on an old binary, UI path or runtime descriptor.
pub(crate) fn refresh(app: &AppHandle) {
    let Ok(current) = host(app) else {
        return;
    };
    for entry in installed() {
        if entry.host_build.as_deref() == Some(current.build.as_str()) {
            continue;
        }
        let icon_file = entry
            .path
            .join("Contents/Resources")
            .join(format!("{ICON}.icns"));
        let icon = std::fs::read(icon_file).unwrap_or_default();
        if let Err(error) = install(app, &entry.mini_app, &entry.name, &icon) {
            crate::log::logln(format!(
                "standalone mini app {}: refresh failed: {error}",
                entry.mini_app
            ));
        }
    }
}

/// Move a mini app's app to the Trash, quitting it first.
pub(crate) fn uninstall(mini_app: &str) -> Result<(), String> {
    let _change = CHANGES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(entry) = installed()
        .into_iter()
        .find(|entry| entry.mini_app == mini_app)
    else {
        return Ok(());
    };
    terminate(&entry.bundle_id);
    let url = objc2_foundation::NSURL::fileURLWithPath(&objc2_foundation::NSString::from_str(
        &entry.path.to_string_lossy(),
    ));
    objc2_foundation::NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, None)
        .map_err(|error| error.localizedDescription().to_string())
}

/// Launch (or bring forward) a mini app's app.
pub(crate) fn open(mini_app: &str) -> Result<(), String> {
    let entry = installed()
        .into_iter()
        .find(|entry| entry.mini_app == mini_app)
        .ok_or("this mini app is not installed as an app")?;
    Command::new("/usr/bin/open")
        .arg(&entry.path)
        .spawn()
        .map(drop)
        .map_err(|error| error.to_string())
}

/// The apps cannot work without their host. Quitting Localix quits them, as quitting Chrome
/// quits its installed web apps.
pub(crate) fn quit_running() {
    for entry in installed() {
        terminate(&entry.bundle_id);
    }
}

fn terminate(bundle_id: &str) {
    use objc2_app_kit::NSRunningApplication;
    let id = objc2_foundation::NSString::from_str(bundle_id);
    for running in NSRunningApplication::runningApplicationsWithBundleIdentifier(&id) {
        running.terminate();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bundle_is_found_by_its_mini_app_key() {
        let app = std::env::temp_dir().join(format!("localix-bundle-{}.app", std::process::id()));
        std::fs::create_dir_all(app.join("Contents")).unwrap();
        std::fs::write(
            app.join("Contents/Info.plist"),
            "<plist><dict><key>CFBundleIdentifier</key><string>ai.localix.tauri.app.board</string>\
             <key>LocalixMiniApp</key><string>board</string></dict></plist>",
        )
        .unwrap();
        let found = read_bundle(&app).map(|entry| entry.mini_app);
        std::fs::remove_dir_all(&app).unwrap();
        assert_eq!(found.as_deref(), Some("board"));
    }
}
