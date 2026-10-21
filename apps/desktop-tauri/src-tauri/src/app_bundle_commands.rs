//! The workspace's commands for plugin apps. Each checks that a trusted workspace is calling.
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
    plugin: String,
    name: String,
    icons: Vec<IconRendition>,
}

#[tauri::command]
pub(crate) fn plugin_apps(caller: Webview) -> Result<Vec<InstalledApp>, String> {
    require_workspace(&caller)?;
    Ok(crate::app_bundle::installed())
}

/// Install (or reinstall) a plugin as its own app, then open it.
#[tauri::command]
pub(crate) async fn plugin_app_install(
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
        let installed = crate::app_bundle::install(&app, &request.plugin, &request.name, &icon)?;
        crate::app_bundle::open(&installed.plugin)?;
        Ok(installed)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn plugin_app_open(caller: Webview, plugin: String) -> Result<(), String> {
    require_workspace(&caller)?;
    crate::app_bundle::open(&plugin)
}

#[tauri::command]
pub(crate) async fn plugin_app_uninstall(caller: Webview, plugin: String) -> Result<(), String> {
    require_workspace(&caller)?;
    tauri::async_runtime::spawn_blocking(move || crate::app_bundle::uninstall(&plugin))
        .await
        .map_err(|error| error.to_string())?
}
