//! What a plugin app bundle records about its host, written as its Info.plist and read back.
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::app_bundle::{EXECUTABLE, HOST_BUILD, ICON};
use crate::app_runner::keys;

/// What a bundle made now would point at: this host, its UI, its runtime descriptor.
pub(crate) struct Host {
    pub(crate) executable: PathBuf,
    pub(crate) location: PathBuf,
    pub(crate) ui: String,
    pub(crate) endpoint: PathBuf,
    /// Where each app's project folder goes (`apps/<plugin>` under the Localix home).
    pub(crate) projects: PathBuf,
    pub(crate) version: String,
    pub(crate) build: String,
}

pub(crate) fn host(app: &AppHandle) -> Result<Host, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    // `<Localix.app>/Contents/MacOS/<binary>` in a bundle; the bare binary in development.
    let location = executable
        .ancestors()
        .nth(3)
        .filter(|bundle| {
            bundle
                .extension()
                .is_some_and(|extension| extension == "app")
        })
        .map_or_else(|| executable.clone(), Path::to_path_buf);
    let ui = if cfg!(debug_assertions) {
        let url = app.config().build.dev_url.as_ref();
        url.map(|url| url.to_string())
            .ok_or("no development UI URL")?
    } else {
        let dir = app
            .path()
            .resource_dir()
            .map_err(|error| error.to_string())?;
        let dir = dir.join("resources").join("ui");
        if !dir.join("index.html").is_file() {
            return Err(format!("this build has no UI at {}", dir.display()));
        }
        dir.to_string_lossy().into_owned()
    };
    let stamp = std::fs::metadata(&executable)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_secs());
    let version = app.package_info().version.to_string();
    Ok(Host {
        endpoint: crate::instance::data_dir().join("localix.db.api-runtime.json"),
        projects: crate::instance::data_dir().join("apps"),
        build: format!("{version}+{stamp}"),
        executable,
        location,
        ui,
        version,
    })
}

pub(crate) fn info_plist(id: &str, name: &str, plugin: &str, host: &Host) -> String {
    let project = host.projects.join(plugin).to_string_lossy().into_owned();
    let strings = [
        ("CFBundleDevelopmentRegion", "en"),
        ("CFBundleExecutable", EXECUTABLE),
        ("CFBundleIdentifier", id),
        ("CFBundleName", name),
        ("CFBundleDisplayName", name),
        ("CFBundleIconFile", ICON),
        ("CFBundlePackageType", "APPL"),
        ("CFBundleShortVersionString", &host.version),
        ("CFBundleVersion", &host.version),
        ("LSMinimumSystemVersion", "13.0"),
        (
            "NSMicrophoneUsageDescription",
            "The plugin may record audio when you ask it to.",
        ),
        (keys::PLUGIN, plugin),
        (keys::UI, &host.ui),
        (keys::ENDPOINT, &host.endpoint.to_string_lossy()),
        (keys::HOST, &host.location.to_string_lossy()),
        (keys::PROJECT, &project),
        (HOST_BUILD, &host.build),
    ];
    let mut plist = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n",
    );
    for (key, value) in strings {
        plist.push_str(&format!(
            "\t<key>{}</key>\n\t<string>{}</string>\n",
            escape(key),
            escape(value)
        ));
    }
    plist.push_str("\t<key>NSHighResolutionCapable</key>\n\t<true/>\n</dict>\n</plist>\n");
    plist
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// One `<string>` value from a plist this module wrote: `<key>K</key>` then its `<string>`.
pub(crate) fn plist_string(plist: &str, key: &str) -> Option<String> {
    let after = &plist[plist.find(&format!("<key>{}</key>", escape(key)))?..];
    let value = &after[after.find("<string>")? + "<string>".len()..];
    let value = &value[..value.find("</string>")?];
    Some(
        value
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&amp;", "&"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_host() -> Host {
        Host {
            executable: PathBuf::from("/Applications/Localix.app/Contents/MacOS/Localix"),
            location: PathBuf::from("/Applications/Localix.app"),
            ui: "/Applications/Localix.app/Contents/Resources/resources/ui".into(),
            endpoint: PathBuf::from("/Users/me/.localix/localix.db.api-runtime.json"),
            projects: PathBuf::from("/Users/me/.localix/apps"),
            version: "1.2.3".into(),
            build: "1.2.3+42".into(),
        }
    }

    #[test]
    fn a_written_plist_reads_back_every_value() {
        let plist = info_plist(
            "ai.localix.tauri.app.kanban",
            "Q&A <board>",
            "kanban",
            &sample_host(),
        );
        assert_eq!(
            plist_string(&plist, "CFBundleName").as_deref(),
            Some("Q&A <board>")
        );
        assert_eq!(
            plist_string(&plist, keys::PLUGIN).as_deref(),
            Some("kanban")
        );
        assert_eq!(
            plist_string(&plist, HOST_BUILD).as_deref(),
            Some("1.2.3+42")
        );
        assert_eq!(
            plist_string(&plist, keys::HOST).as_deref(),
            Some("/Applications/Localix.app")
        );
        assert_eq!(
            plist_string(&plist, keys::PROJECT).as_deref(),
            Some("/Users/me/.localix/apps/kanban")
        );
        assert!(
            !plist.contains("Q&A <board>"),
            "values are escaped in the XML"
        );
        assert_eq!(plist_string(&plist, "Missing"), None);
    }
}
