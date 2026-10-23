//! The workspace's commands for standalone mini apps. Each checks that a trusted workspace is
//! calling.
use base64::Engine;
use tauri::{AppHandle, Webview};

use crate::app_bundle::InstalledApp;
use crate::workspace_windows::require_workspace;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IconRendition {
    size: u32,
    /// Base64 PNG.
    png: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallRequest {
    mini_app: String,
    name: String,
    icons: Vec<IconRendition>,
}

#[tauri::command]
pub(crate) fn mini_app_apps(caller: Webview) -> Result<Vec<InstalledApp>, String> {
    require_workspace(&caller)?;
    Ok(crate::app_bundle::installed())
}

/// Install (or reinstall) a mini app as its own app. The workspace makes its project, then opens
/// it.
#[tauri::command]
pub(crate) async fn mini_app_install(
    app: AppHandle,
    caller: Webview,
    request: InstallRequest,
) -> Result<InstalledApp, String> {
    require_workspace(&caller)?;
    let renditions = request
        .icons
        .iter()
        .map(|icon| {
            base64::engine::general_purpose::STANDARD
                .decode(&icon.png)
                .map(|png| (icon.size, png))
                .map_err(|error| format!("icon {}px: {error}", icon.size))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let icon = crate::app_icon::icns(&renditions)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::app_bundle::install(&app, &request.mini_app, &request.name, &icon)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn mini_app_open(caller: Webview, mini_app: String) -> Result<(), String> {
    require_workspace(&caller)?;
    crate::app_bundle::open(&mini_app)
}

#[tauri::command]
pub(crate) async fn mini_app_uninstall(caller: Webview, mini_app: String) -> Result<(), String> {
    require_workspace(&caller)?;
    tauri::async_runtime::spawn_blocking(move || crate::app_bundle::uninstall(&mini_app))
        .await
        .map_err(|error| error.to_string())?
}
