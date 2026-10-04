//! The native menus — app menu, tray menu, and the id grammar that binds them.
//!
//! Both menus are built here on purpose. They share one piece of knowledge: the
//! menu-item ID GRAMMAR (`recent:<sessionId>`, `project:<projectId>`), which the
//! menu-event dispatchers parse back out to a deep link. Splitting the app menu
//! from the tray menu would split that grammar across two files and invite the two
//! halves to drift. What they do NOT share — the tray's icon and click behavior —
//! lives in `tray.rs`.
//!
//! Recents and projects arrive on independent commands (`set_recent_sessions` /
//! `set_projects`), so the last snapshot of both is held in `MenuState` and the
//! whole menu is rebuilt from the merged picture whenever either changes: a menu
//! rebuild needs the complete picture, and AppKit requires it on the main thread.

use std::sync::Mutex;

use tauri::{AppHandle, Manager};

/// Build the native application menu.
///
/// Tauri's `Menu::default` titles the macOS app submenu from the Cargo package
/// name (`desktop-tauri`); we rebuild the same native structure but brand it
/// "Localix" and point About at the real product metadata. The menu also carries
/// the standard Edit items (Undo/Redo/Cut/Copy/Paste/Select-All) so those system
/// shortcuts work reliably inside the webview on every OS.
/// One entry the UI feeds into File ▸ Open Recent (a recent session).
#[derive(Clone, serde::Deserialize)]
pub struct RecentItem {
    id: String,
    title: String,
}

/// One entry the UI feeds into the Project menu (an opened project/folder). The
/// UI pushes these via `set_projects`; clicking one switches to it by id.
#[derive(Clone, serde::Deserialize)]
pub struct ProjectItem {
    id: String,
    name: String,
}

/// The UI-supplied data the native application menu is built from. Recents and
/// projects arrive on independent commands (`set_recent_sessions`/`set_projects`),
/// so we hold both here and rebuild the whole menu from the merged snapshot each
/// time either changes — a menu rebuild needs the complete picture.
#[derive(Default)]
pub(crate) struct MenuData {
    recents: Vec<RecentItem>,
    projects: Vec<ProjectItem>,
    active_project: Option<String>,
}

/// Managed state wrapping the last {@link MenuData} the UI pushed.
pub(crate) struct MenuState(Mutex<MenuData>);
impl Default for MenuState {
    fn default() -> Self {
        Self(Mutex::new(MenuData::default()))
    }
}

/// Trim a session title to a sane menu width (menus shouldn't be a mile wide).
pub(crate) fn ellipsize(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        return t.to_string();
    }
    let head: String = t.chars().take(max.saturating_sub(1)).collect();
    format!("{head}…")
}

/// Build the File ▸ Open Recent submenu from the UI-supplied recents. Each item's
/// id is `recent:<sessionId>` so on_menu_event can dispatch localix://session/<id>
/// (the same tested deep-link path used everywhere else). Empty → a disabled
/// placeholder so the submenu is never blank.
fn build_open_recent<R: tauri::Runtime>(
    handle: &tauri::AppHandle<R>,
    recents: &[RecentItem],
) -> tauri::Result<tauri::menu::Submenu<R>> {
    use tauri::menu::{MenuItem, Submenu};
    let sub = Submenu::new(handle, "Open Recent", true)?;
    if recents.is_empty() {
        let placeholder = MenuItem::with_id(
            handle,
            "recent_none",
            "No Recent Sessions",
            false,
            None::<&str>,
        )?;
        sub.append(&placeholder)?;
    } else {
        for it in recents {
            let item = MenuItem::with_id(
                handle,
                format!("recent:{}", it.id),
                ellipsize(&it.title, 48),
                true,
                None::<&str>,
            )?;
            sub.append(&item)?;
        }
    }
    Ok(sub)
}

/// Build the Project submenu: "Open Folder…" (native picker → find-or-create a
/// project, handled in the UI via the menu bridge) above the list of opened
/// projects (most-recent first), the active one checkmarked. Each project item's
/// id is `project:<id>` so on_menu_event dispatches localix://project/<id> — the
/// same switch path the deep link + quick-switcher use. Empty → a disabled
/// placeholder so the list is never blank.
fn build_project_menu<R: tauri::Runtime>(
    handle: &tauri::AppHandle<R>,
    projects: &[ProjectItem],
    active: &Option<String>,
) -> tauri::Result<tauri::menu::Submenu<R>> {
    use tauri::menu::{CheckMenuItem, MenuItem, PredefinedMenuItem, Submenu};
    let sub = Submenu::new(handle, "Project", true)?;
    // "Open Folder…" opens the native directory picker in the UI and switches to
    // (or creates) the matching project — routed through the menu bridge.
    sub.append(&MenuItem::with_id(
        handle,
        "open_project",
        "Open Folder…",
        true,
        None::<&str>,
    )?)?;
    sub.append(&PredefinedMenuItem::separator(handle)?)?;
    if projects.is_empty() {
        sub.append(&MenuItem::with_id(
            handle,
            "project_none",
            "No Projects",
            false,
            None::<&str>,
        )?)?;
    } else {
        for p in projects {
            let is_active = active.as_deref() == Some(p.id.as_str());
            // A checkmarked entry marks the active project (radio-style: only one
            // is ever checked). Clicking any entry switches to it.
            let item = CheckMenuItem::with_id(
                handle,
                format!("project:{}", p.id),
                ellipsize(&p.name, 48),
                true,
                is_active,
                None::<&str>,
            )?;
            sub.append(&item)?;
        }
    }
    Ok(sub)
}

/// The menu id of Quit, routed to `app.exit(0)` by the app's menu handler.
pub(crate) const QUIT_MENU_ID: &str = "quit";

/// Quit as a CUSTOM item, never `PredefinedMenuItem::quit`.
///
/// The predefined item skips the one event that stops the runtime gracefully: on macOS it sends
/// `terminate:` and on Windows it posts `WM_QUIT`, and both end the event loop with `Exit` only —
/// `ExitRequested`, where the shell sends `shutdown` and waits, is never raised, so the runtime
/// was killed mid-write. On Linux the predefined item is unsupported and File ▸ Quit did nothing.
/// A custom item routed to `app.exit(0)` takes the graceful path on every OS.
fn quit_item<R: tauri::Runtime>(
    handle: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::MenuItem<R>> {
    tauri::menu::MenuItem::with_id(handle, QUIT_MENU_ID, QUIT_LABEL, true, QUIT_ACCELERATOR)
}

/// Each platform's own name and key for the item: macOS names the app on Cmd+Q, GNOME quits on
/// Ctrl+Q, and Windows says Exit with NO accelerator.
///
/// Windows quits with Alt+F4, which is a window close, not this item — and a Ctrl+Q menu
/// accelerator would be taken before the webview sees the key, stealing it from the terminal.
/// Alt+F4 still reaches the graceful stop: the main window's `CloseRequested` handler (lib.rs)
/// either hides it to the tray, where the app and its runtime keep running, or — with no tray
/// to come back through — turns the close into this item's own `app.exit(0)`, so both reach the
/// same before-quit handshake (`quit::on_exit_requested`) while the page can still flush.
#[cfg(target_os = "macos")]
const QUIT_LABEL: &str = "Quit Localix";
#[cfg(target_os = "macos")]
const QUIT_ACCELERATOR: Option<&str> = Some("Cmd+Q");
#[cfg(windows)]
const QUIT_LABEL: &str = "Exit";
#[cfg(windows)]
const QUIT_ACCELERATOR: Option<&str> = None;
#[cfg(not(any(target_os = "macos", windows)))]
const QUIT_LABEL: &str = "Quit";
#[cfg(not(any(target_os = "macos", windows)))]
const QUIT_ACCELERATOR: Option<&str> = Some("Ctrl+Q");

#[cfg(target_os = "macos")]
const REDO_ACCELERATOR: Option<&str> = Some("CmdOrCtrl+Shift+Z");
#[cfg(not(target_os = "macos"))]
const REDO_ACCELERATOR: Option<&str> = Some("Ctrl+Y");

/// The stage shown beside the version in the About panel, quietly. It matches the label on the
/// landing page and the channel named in `release.yml`; change them together when beta ends.
const RELEASE_CHANNEL: &str = "beta";

pub(crate) fn build_app_menu<R: tauri::Runtime>(
    handle: &tauri::AppHandle<R>,
    data: &MenuData,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
    let recents = &data.recents;

    let cfg = handle.config();
    let about = AboutMetadata {
        name: Some("Localix".into()),
        version: Some(format!(
            "{} {RELEASE_CHANNEL}",
            cfg.version.clone().unwrap_or_else(|| "0.0.0".into())
        )),
        copyright: cfg.bundle.copyright.clone(),
        authors: cfg.bundle.publisher.clone().map(|p| vec![p]),
        // website/comments/license render in the Tauri-drawn About dialog on
        // Windows/Linux (macOS's native panel shows only name/version/copyright).
        website: cfg.bundle.homepage.clone(),
        website_label: Some("localix.ai".into()),
        comments: Some("Open-source Agentic Development Environment".into()),
        license: Some("MIT".into()),
        ..Default::default()
    };

    let mut items: Vec<&dyn tauri::menu::IsMenuItem<R>> = Vec::new();

    // "Settings…" (Cmd+, native convention) — dispatches to the UI via
    // on_menu_event → window.__localixOpenSettings(). Lives in the macOS app menu,
    // else in File.
    let settings_item = MenuItem::with_id(
        handle,
        "open_settings",
        "Settings…",
        true,
        Some("CmdOrCtrl+Comma"),
    )?;
    // File ▸ New Chat (Cmd+N native convention) — reuses the localix://new deep
    // link. The app's own in-webview binding (Cmd+Alt+N) still works alongside it.
    let new_chat_item =
        MenuItem::with_id(handle, "new_chat", "New Chat", true, Some("CmdOrCtrl+N"))?;
    // File ▸ New File — start an inline new-file entry at the project root (routed
    // through the menu bridge to the file tree). No accelerator: Cmd+Alt+N is the
    // app's in-webview New-Chat chord and must not be shadowed.
    let new_file_item = MenuItem::with_id(handle, "new_file", "New File", true, None::<&str>)?;
    // File ▸ Open File… (Cmd+O — free, no in-app chord) → native file picker in the
    // UI, then open the chosen file in an editor tab.
    let open_file_item =
        MenuItem::with_id(handle, "open_file", "Open File…", true, Some("CmdOrCtrl+O"))?;
    // File ▸ Save (Cmd+S) → save the focused editor. Additive over the editor's
    // autosave; Cmd+S is otherwise unbound in the webview so there's no conflict.
    let save_item = MenuItem::with_id(handle, "save_file", "Save", true, Some("CmdOrCtrl+S"))?;
    // Cmd+W must close the active workspace tab, not the native window. A
    // predefined `close_window` item registers Cmd+W with AppKit before the
    // webview can see the key event, so route the accelerator through our menu
    // bridge instead. Native window close remains available as Cmd+Shift+W.
    let close_tab_item =
        MenuItem::with_id(handle, "close_tab", "Close Tab", true, Some("CmdOrCtrl+W"))?;
    let close_window_item = MenuItem::with_id(
        handle,
        "close_window",
        "Close Window",
        true,
        Some("CmdOrCtrl+Shift+W"),
    )?;
    // File ▸ Open Recent — populated from the UI via the set_recent_sessions command.
    let open_recent = build_open_recent(handle, recents)?;

    // macOS app menu (bold, first) — About / Settings / Services / Hide / Quit.
    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_items(
        handle,
        "Localix",
        true,
        &[
            &PredefinedMenuItem::about(handle, None, Some(about.clone()))?,
            &PredefinedMenuItem::separator(handle)?,
            &settings_item,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::services(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::hide(handle, None)?,
            &PredefinedMenuItem::hide_others(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &quit_item(handle)?,
        ],
    )?;
    #[cfg(target_os = "macos")]
    items.push(&app_menu);

    let file_menu = Submenu::with_items(
        handle,
        "File",
        true,
        &[
            &new_chat_item,
            &new_file_item,
            &open_file_item,
            &open_recent,
            &PredefinedMenuItem::separator(handle)?,
            &save_item,
            &close_tab_item,
            &PredefinedMenuItem::separator(handle)?,
            #[cfg(not(target_os = "macos"))]
            &settings_item,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::separator(handle)?,
            #[cfg(not(target_os = "macos"))]
            &quit_item(handle)?,
        ],
    )?;
    items.push(&file_menu);

    let edit_menu = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            // Native selectors edit Monaco's hidden textarea instead of its model.
            // Custom items keep the accelerators and route through the focused editor.
            &MenuItem::with_id(handle, "undo", "Undo", true, Some("CmdOrCtrl+Z"))?,
            &MenuItem::with_id(handle, "redo", "Redo", true, REDO_ACCELERATOR)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &MenuItem::with_id(
                handle,
                "select_all",
                "Select All",
                true,
                Some("CmdOrCtrl+A"),
            )?,
        ],
    )?;
    items.push(&edit_menu);

    // Project menu — opened folders + switch, populated by set_projects.
    let project_menu = build_project_menu(handle, &data.projects, &data.active_project)?;
    items.push(&project_menu);

    // View ▸ Command palette + panel openers + layout toggles (routed through the
    // menu bridge to the same actions the rail buttons / palette run), then zoom
    // (all platforms) + fullscreen (macOS). Accelerators mirror the in-app default
    // chords; the native item and the webview binding drive the identical action,
    // so a user rebind stays harmless.
    let cmd_palette = MenuItem::with_id(
        handle,
        "command_palette",
        "Command Palette…",
        true,
        Some("CmdOrCtrl+Shift+P"),
    )?;
    let toggle_sidebar = MenuItem::with_id(
        handle,
        "toggle_sidebar",
        "Toggle Sidebar",
        true,
        Some("CmdOrCtrl+B"),
    )?;
    let view_stats = MenuItem::with_id(handle, "view_stats", "Usage & Spend", true, None::<&str>)?;
    // View ▸ zoom items dispatch to the app-level on_menu_event handler, which
    // drives the webview zoom factor.
    let zoom_in = MenuItem::with_id(handle, "zoom_in", "Zoom In", true, Some("CmdOrCtrl+Equal"))?;
    let zoom_out = MenuItem::with_id(
        handle,
        "zoom_out",
        "Zoom Out",
        true,
        Some("CmdOrCtrl+Minus"),
    )?;
    let zoom_reset = MenuItem::with_id(
        handle,
        "zoom_reset",
        "Actual Size",
        true,
        Some("CmdOrCtrl+0"),
    )?;
    // macOS uses the native full-screen predefined item (Spaces); win/linux get a
    // custom F11 toggle handled in on_menu_event.
    #[cfg(not(target_os = "macos"))]
    let fullscreen_toggle = MenuItem::with_id(
        handle,
        "toggle_fullscreen",
        "Toggle Full Screen",
        true,
        Some("F11"),
    )?;
    let view_menu = Submenu::with_items(
        handle,
        "View",
        true,
        &[
            &cmd_palette,
            &PredefinedMenuItem::separator(handle)?,
            &toggle_sidebar,
            &PredefinedMenuItem::separator(handle)?,
            &view_stats,
            &PredefinedMenuItem::separator(handle)?,
            &zoom_in,
            &zoom_out,
            &zoom_reset,
            &PredefinedMenuItem::separator(handle)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::fullscreen(handle, None)?,
            #[cfg(not(target_os = "macos"))]
            &fullscreen_toggle,
        ],
    )?;
    items.push(&view_menu);

    // Terminal is a first-class workspace surface, so expose it as a native
    // top-level menu instead of burying its only action under View. "New" always
    // creates a fresh PTY; "Show" reveals the most recent one (or creates the
    // first), matching the two distinct in-app terminal actions.
    let new_terminal =
        MenuItem::with_id(handle, "new_terminal", "New Terminal", true, None::<&str>)?;
    let show_terminal = MenuItem::with_id(
        handle,
        "toggle_terminal",
        "Show Terminal",
        true,
        None::<&str>,
    )?;
    let terminal_menu =
        Submenu::with_items(handle, "Terminal", true, &[&new_terminal, &show_terminal])?;
    items.push(&terminal_menu);

    let window_menu = Submenu::with_items(
        handle,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(handle, None)?,
            &PredefinedMenuItem::maximize(handle, None)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::separator(handle)?,
            &close_window_item,
        ],
    )?;
    // Designate it as the macOS Window menu so AppKit auto-adds the open-window
    // list + "Bring All to Front" and enables native window cycling (best-effort).
    #[cfg(target_os = "macos")]
    let _ = window_menu.set_as_windows_menu_for_nsapp();
    items.push(&window_menu);

    // Product-specific Help menu. In-app destinations go through the menu bridge;
    // web destinations open in the system browser. About repeats here on
    // Windows/Linux (on macOS it already lives in the app menu).
    let help_shortcuts = MenuItem::with_id(
        handle,
        "help_shortcuts",
        "Keyboard Shortcuts",
        true,
        None::<&str>,
    )?;
    let help_diagnostics = MenuItem::with_id(
        handle,
        "help_diagnostics",
        "Diagnostics…",
        true,
        None::<&str>,
    )?;
    let help_docs = MenuItem::with_id(
        handle,
        "help_docs",
        "Localix Documentation",
        true,
        None::<&str>,
    )?;
    let help_report_issue = MenuItem::with_id(
        handle,
        "help_report_issue",
        "Report an Issue…",
        true,
        None::<&str>,
    )?;
    let help_releases =
        MenuItem::with_id(handle, "help_releases", "Release Notes", true, None::<&str>)?;
    let help_website = MenuItem::with_id(
        handle,
        "help_website",
        "Localix Website",
        true,
        None::<&str>,
    )?;
    #[cfg(not(target_os = "macos"))]
    let help_sep = PredefinedMenuItem::separator(handle)?;
    #[cfg(not(target_os = "macos"))]
    let help_about = PredefinedMenuItem::about(handle, None, Some(about.clone()))?;
    let help_menu = Submenu::with_items(
        handle,
        "Help",
        true,
        &[
            &help_shortcuts,
            &help_diagnostics,
            &PredefinedMenuItem::separator(handle)?,
            &help_docs,
            &help_report_issue,
            &help_releases,
            &help_website,
            #[cfg(not(target_os = "macos"))]
            &help_sep,
            #[cfg(not(target_os = "macos"))]
            &help_about,
        ],
    )?;
    // Designate it as the macOS Help menu so AppKit adds the native Help search
    // field at the top (best-effort).
    #[cfg(target_os = "macos")]
    let _ = help_menu.set_as_help_menu_for_nsapp();
    items.push(&help_menu);

    Menu::with_items(handle, &items)
}

/// Install the system-tray icon (macOS menu-bar item / Windows-Linux tray). The
/// menu offers Show / New Chat / Quit; left-clicking the icon reveals the window.
/// "New Chat" reuses the deep-link path (localix://new) so there's one code path
/// for minting a fresh chat.
/// The tray (menu-bar) menu: a Recent section (when present) above
/// New Chat / Show / Quit. Recent items carry id `recent:<sessionId>` so the tray
/// on_menu_event dispatches localix://session/<id>, same as File ▸ Open Recent.
/// Rebuilt by set_recent_sessions whenever the UI's recent list changes.
pub(crate) fn build_tray_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    recents: &[RecentItem],
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    let menu = Menu::new(app)?;
    if !recents.is_empty() {
        // A disabled "Recent" caption, then the sessions.
        menu.append(&MenuItem::with_id(
            app,
            "tray_recent_header",
            "Recent",
            false,
            None::<&str>,
        )?)?;
        for it in recents {
            menu.append(&MenuItem::with_id(
                app,
                format!("recent:{}", it.id),
                ellipsize(&it.title, 44),
                true,
                None::<&str>,
            )?)?;
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    menu.append(&MenuItem::with_id(
        app,
        "tray_new",
        "New Chat",
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        "tray_show",
        "Show Localix",
        true,
        None::<&str>,
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        "tray_quit",
        "Quit Localix",
        true,
        None::<&str>,
    )?)?;
    Ok(menu)
}

/// File ▸ Open Recent — the UI pushes its most-recent sessions here whenever the
/// list changes. We rebuild the app menu (cheap, and it happens rarely) on the
/// main thread — required for AppKit menu mutation — and swap it in. Clicking an
/// entry dispatches localix://session/<id> via on_menu_event.
#[tauri::command]
pub(crate) fn set_recent_sessions(app: AppHandle, items: Vec<RecentItem>) {
    {
        let state = app.state::<MenuState>();
        state.0.lock().unwrap().recents = items;
    }
    rebuild_menus(&app);
}

/// Project menu — the UI pushes its opened projects (most-recent first) plus the
/// active project id whenever either changes. We rebuild the app menu so the
/// Project submenu lists them (active one checkmarked); clicking an entry
/// dispatches localix://project/<id> via on_menu_event (the same tested switch
/// path the deep link uses). The tray menu is project-free, so it isn't rebuilt.
#[tauri::command]
pub(crate) fn set_projects(app: AppHandle, items: Vec<ProjectItem>, active: Option<String>) {
    {
        let state = app.state::<MenuState>();
        let mut data = state.0.lock().unwrap();
        data.projects = items;
        data.active_project = active;
    }
    rebuild_menus(&app);
}

/// Rebuild the native app menu (and the tray's recents) from the current
/// {@link MenuData}. AppKit menu mutation must happen on the main thread, so this
/// hops there; it's cheap and happens rarely (only when recents/projects change).
pub(crate) fn rebuild_menus(app: &AppHandle) {
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let state = app2.state::<MenuState>();
        let data = state.0.lock().unwrap();
        if let Ok(menu) = build_app_menu(&app2, &data) {
            let _ = app2.set_menu(menu);
        }
        // Mirror the recents into the tray (menu-bar) menu too.
        if let Some(tray) = app2.tray_by_id("main-tray") {
            if let Ok(menu) = build_tray_menu(&app2, &data.recents) {
                let _ = tray.set_menu(Some(menu));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn model_editing_never_uses_native_textarea_selectors() {
        let source = include_str!("menu.rs");
        let compact: String = source.chars().filter(|c| !c.is_whitespace()).collect();
        for command in ["undo", "redo", "select_all"] {
            let predefined = format!("PredefinedMenuItem::{command}(");
            assert!(
                !source.contains(&predefined),
                "{predefined} bypasses Monaco"
            );
            let custom = format!("MenuItem::with_id(handle,\"{command}\"");
            assert!(compact.contains(&custom), "missing custom {command} item");
        }
    }

    #[test]
    fn redo_takes_the_platforms_editor_key() {
        let expected = if cfg!(target_os = "macos") {
            Some("CmdOrCtrl+Shift+Z")
        } else {
            Some("Ctrl+Y")
        };
        assert_eq!(super::REDO_ACCELERATOR, expected);
    }

    /// A menu cannot be built without a running app, so this reads the source instead: the
    /// predefined Quit coming back is exactly the regression, and it compiles without a warning.
    #[test]
    fn quit_is_never_the_predefined_item() {
        let source = include_str!("menu.rs");
        // Both needles are split so this test's own text is not a match.
        let predefined = concat!("PredefinedMenuItem::", "quit(");
        assert!(
            !source.contains(predefined),
            "{predefined} skips ExitRequested"
        );
        // Positive control: both menus that carry Quit still build the custom item.
        let custom = concat!("&quit_item", "(handle)?");
        assert_eq!(source.matches(custom).count(), 2);
    }

    /// Cmd+Q on macOS, Ctrl+Q on Linux, and no key on Windows, where Ctrl+Q belongs to the
    /// terminal and Alt+F4 (a window close) is how the app is quit.
    #[test]
    fn quit_takes_each_platforms_own_key() {
        let expected = if cfg!(target_os = "macos") {
            Some("Cmd+Q")
        } else if cfg!(windows) {
            None
        } else {
            Some("Ctrl+Q")
        };
        assert_eq!(super::QUIT_ACCELERATOR, expected);
        // No shared Cmd-or-Ctrl binding left behind to hand Windows the key again (the needle is
        // split so this test's own text is not a match).
        let source = include_str!("menu.rs");
        assert!(!source.contains(concat!("CmdOrCtrl", "+Q")));
    }
}
