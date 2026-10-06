//! Native workspace actions have distinct names/shortcuts from editor tabs and New Chat.
use tauri::menu::MenuItem;
pub(crate) fn items<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> tauri::Result<Vec<MenuItem<R>>> {
    [
        ("new_workspace_tab", "New Workspace Tab", Some("Cmd+T")),
        (
            "new_workspace_window",
            "New Workspace Window",
            Some("Cmd+Alt+Shift+N"),
        ),
        ("native_next_tab", "Next Workspace Tab", None),
        ("native_previous_tab", "Previous Workspace Tab", None),
        ("close_workspace_tab", "Close Workspace Tab", None),
        (
            "native_detach_tab",
            "Move Workspace Tab to New Window",
            None,
        ),
        ("native_merge_windows", "Merge All Workspace Windows", None),
        ("native_toggle_tab_bar", "Show/Hide Workspace Tab Bar", None),
    ]
    .iter()
    .map(|(id, title, shortcut)| MenuItem::with_id(app, *id, *title, true, *shortcut))
    .collect()
}
