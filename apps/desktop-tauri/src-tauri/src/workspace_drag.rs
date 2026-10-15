//! Provisional native tear-out: prepare once, follow the pointer, commit only on an accepted drop.
use crate::workspace_drag_state::validate_id;
#[cfg(target_os = "macos")]
use crate::workspace_drag_state::{Key, WorkspaceDrags, TTL};
use crate::workspace_transfer;
#[cfg(target_os = "macos")]
use crate::workspace_transfer::WorkspaceTransfers;
use serde_json::Value;
use tauri::{AppHandle, Manager, Webview};

#[tauri::command]
pub(crate) async fn workspace_drag_prepare(
    app: AppHandle,
    caller: Webview,
    id: String,
    route: String,
    payload: Value,
    anchor: Option<[f64; 2]>,
    snapshot: Option<crate::workspace_drag_snapshot::DragSnapshot>,
) -> Result<String, String> {
    crate::workspace_windows::require_workspace(&caller)?;
    validate_id(&id)?;
    workspace_transfer::validate(&route, &payload)?;
    if anchor.is_some_and(|point| {
        point
            .iter()
            .any(|value| !value.is_finite() || *value < 0.0 || *value > 10000.0)
    }) {
        return Err("Invalid workspace drag anchor".into());
    }
    if let Some(snapshot) = &snapshot {
        snapshot.validate()?;
    }
    #[cfg(target_os = "macos")]
    {
        let key = (caller.label().into(), id);
        if let Some(destination) = app.state::<WorkspaceDrags>().reserve(&key)? {
            return Ok(destination);
        }
        let handle = app.clone();
        let preparation_key = key.clone();
        let result = crate::native_browser_lifecycle::on_ui(move || {
            let destination = crate::workspace_windows::new_label()?;
            let title = payload
                .get("item")
                .and_then(|item| item.get("title"))
                .and_then(Value::as_str)
                .unwrap_or("Moving tab")
                .to_string();
            handle.state::<WorkspaceTransfers>().insert(
                destination.clone(),
                preparation_key.0.clone(),
                payload,
                None,
            );
            if let Err(error) =
                crate::workspace_windows::open_provisional(&handle, destination.clone(), route)
            {
                handle.state::<WorkspaceTransfers>().cancel(&destination);
                return Err(error);
            }
            if !handle
                .state::<WorkspaceDrags>()
                .prepared(&preparation_key, destination.clone())
            {
                handle.state::<WorkspaceTransfers>().cancel(&destination);
                destroy(&handle, &destination);
                return Err("Workspace drag was cancelled".into());
            }
            let zoom = *handle.state::<crate::prefs::ZoomState>().0.lock().unwrap();
            let anchor = anchor.map(|[x, y]| [x * zoom, y * zoom]);
            let snapshot = snapshot.map(|snapshot| snapshot.scaled(zoom));
            if let Err(error) = crate::workspace_drag_tracking::start(
                &handle,
                preparation_key.clone(),
                destination.clone(),
                anchor,
                snapshot.as_ref().map(|snapshot| snapshot.rect),
            ) {
                cancel_ui(&handle, &preparation_key);
                return Err(error);
            }
            if let Err(error) = crate::workspace_drag_image::install(
                &handle,
                preparation_key.clone(),
                &destination,
                &title,
                snapshot,
            ) {
                cancel_ui(&handle, &preparation_key);
                return Err(error);
            }
            Ok(destination)
        })
        .await;
        if result.is_err() {
            let handle = app.clone();
            let key = key.clone();
            crate::macos_tabs::defer(move || cancel_ui(&handle, &key));
        }
        crate::main_queue::after(TTL, move || cancel_ui(&app, &key));
        result
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Native workspace drags are available on macOS".into())
    }
}

#[tauri::command]
pub(crate) async fn workspace_drag_commit(
    app: AppHandle,
    caller: Webview,
    id: String,
    as_tab: bool,
) -> Result<String, String> {
    crate::workspace_windows::require_workspace(&caller)?;
    validate_id(&id)?;
    #[cfg(target_os = "macos")]
    {
        let key = (caller.label().into(), id);
        let handle = app.clone();
        let destination = crate::native_browser_lifecycle::on_ui(move || {
            let destination = handle.state::<WorkspaceDrags>().commit(&key)?;
            let placement = crate::workspace_drag_tracking::stop(&key);
            crate::workspace_drag_tracking::interactive(&handle, &destination, placement);
            {
                let mut windows = crate::workspace_windows::workspaces(&handle);
                let entry = windows
                    .entries
                    .get_mut(&destination)
                    .ok_or("Prepared workspace disappeared")?;
                entry.provisional = false;
                entry.host = as_tab.then(|| key.0.clone());
            }
            crate::workspace_windows::reveal(&handle, &destination);
            Ok(destination)
        })
        .await?;
        // reveal queues the actual AppKit join/show. Queue acceptance after it, so an early
        // destination ACK never retires the source before that prepared window is revealed.
        let handle = app.clone();
        let target = destination.clone();
        let outcome = crate::native_browser_lifecycle::on_ui(move || {
            handle.state::<WorkspaceTransfers>().commit(&target)
        })
        .await?;
        let result =
            workspace_transfer::await_outcome(app.clone(), destination.clone(), outcome).await;
        if result.is_err() {
            let handle = app.clone();
            crate::macos_tabs::defer(move || {
                crate::workspace_drag_image::remove(&destination);
                if let Some(entry) = crate::workspace_windows::workspaces(&handle)
                    .entries
                    .get_mut(&destination)
                {
                    entry.transfer_pending = false;
                }
                crate::workspace_windows::reveal(&handle, &destination);
            });
        }
        result
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, as_tab);
        Err("Native workspace drags are available on macOS".into())
    }
}

#[tauri::command]
pub(crate) async fn workspace_drag_cancel(
    app: AppHandle,
    caller: Webview,
    id: String,
) -> Result<(), String> {
    crate::workspace_windows::require_workspace(&caller)?;
    validate_id(&id)?;
    #[cfg(target_os = "macos")]
    {
        let key = (caller.label().into(), id);
        // Reserve the tombstone before queuing, so a pending builder cannot publish after cancel.
        let destination = app.state::<WorkspaceDrags>().cancel(&key);
        let handle = app.clone();
        crate::main_queue::after(TTL, move || handle.state::<WorkspaceDrags>().prune());
        crate::native_browser_lifecycle::on_ui(move || {
            crate::workspace_drag_tracking::stop(&key);
            if let Some(destination) = destination {
                app.state::<WorkspaceTransfers>().cancel(&destination);
                destroy(&app, &destination);
            }
            Ok(())
        })
        .await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Native workspace drags are available on macOS".into())
    }
}

#[cfg(target_os = "macos")]
fn destroy(app: &AppHandle, destination: &str) {
    crate::workspace_drag_image::remove(destination);
    if let Some(window) = app.get_window(destination) {
        let _ = window.destroy();
    }
}

#[cfg(target_os = "macos")]
fn cancel_ui(app: &AppHandle, key: &Key) {
    crate::workspace_drag_tracking::stop(key);
    if let Some(destination) = app.state::<WorkspaceDrags>().cancel(key) {
        app.state::<WorkspaceTransfers>().cancel(&destination);
        destroy(app, &destination);
    }
    let handle = app.clone();
    crate::main_queue::after(TTL, move || handle.state::<WorkspaceDrags>().prune());
}

#[cfg(target_os = "macos")]
pub(crate) fn cancel_owner(app: &AppHandle, owner: &str) {
    app.state::<WorkspaceTransfers>().cancel(owner);
    app.state::<WorkspaceTransfers>().cancel_source(owner);
    let keys = app.state::<WorkspaceDrags>().related(owner);
    let app = app.clone();
    crate::macos_tabs::defer(move || {
        for key in keys {
            cancel_ui(&app, &key);
        }
    });
}

#[tauri::command]
pub(crate) async fn workspace_transfer_presented(
    app: AppHandle,
    caller: Webview,
) -> Result<(), String> {
    crate::workspace_windows::require_workspace(&caller)?;
    crate::native_browser_lifecycle::on_ui(move || {
        #[cfg(target_os = "macos")]
        crate::workspace_drag_image::remove(caller.label());
        if let Some(entry) = crate::workspace_windows::workspaces(&app)
            .entries
            .get_mut(caller.label())
        {
            entry.transfer_presented = true;
            entry.transfer_pending = false;
        }
        crate::workspace_windows::reveal(&app, caller.label());
        Ok(())
    })
    .await
}
