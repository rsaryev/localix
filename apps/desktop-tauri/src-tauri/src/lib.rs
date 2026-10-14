// ─────────────────────────────────────────────────────────────────────────────
// desktop-tauri native shell. What is wired:
//
//   ✓ Native folder/file picker  → `pick_directory` / `pick_files` commands over
//                                   tauri-plugin-dialog (every Tauri target, no
//                                   external binary). The API's osascript /
//                                   PowerShell / zenity picker is the BROWSER-only
//                                   fallback now.
//   ✓ macOS native workspace tabs → Native titlebar + NSWindow tab groups;
//                                   Cmd+T and the native + action create workspaces.
//   ✓ Window geometry persistence → tauri-plugin-window-state + native group frames.
//   ✓ Native application menu    → build_app_menu (branded "Localix").
//   ✓ Native notifications       → tauri-plugin-notification + `notify` command
//                                   (UI invokes it; unfocused-only).
//   ✓ single-instance            → tauri-plugin-single-instance (focus running win).
//   ✓ Deep links `localix://…`   → tauri-plugin-deep-link + DeepLinks buffer +
//                                   `deep_link_ready` flush (grammar lives in the
//                                   UI's shared/lib/deepLink.ts).
//   ✓ Window-title-follows-session → `set_title` command (UI's useDocumentTitle).
//   ✓ System tray / menu-bar item → setup_tray (Show / New Chat / Quit; left-click
//                                   reveals window; "New Chat" reuses localix://new).
//   ✓ Dock/taskbar badge          → `set_badge` command (background HITL count;
//                                   UI useDockBadge from the hitlInbox size).
//   ✓ Native theme sync           → `set_theme` command (UI useTheme; traffic
//                                   lights + native menus follow the app theme).
//   ✓ External links → system browser → on_navigation + on_new_window guards
//                                   (window.open/target=_blank incl. OAuth popup),
//                                   plus the `open_external` command the UI calls
//                                   for anchor clicks the webview swallows.
//   ✓ Webview zoom (Cmd +/-/0)    → View menu items + on_menu_event (ZoomState).
//   ✓ Native file drop            → native drag-drop DISABLED (it swallows ALL
//                                   webview drops, incl. in-page HTML5 DnD); the
//                                   HTML5 guard handles drops, and the
//                                   `dragged_paths` command recovers the dropped
//                                   files' REAL paths from the macOS drag
//                                   pasteboard so they open editable in place.
//   ✓ Auto-updater               → tauri-plugin-updater + updater_check/
//                                   updater_install cmds; UI useDesktopUpdate polls
//                                   via invoke when window.__LOCALIX_UPDATER is set.
//                                   Release builds only (`UPDATER_ENABLED`): the key and
//                                   endpoint come from the overlay that
//                                   scripts/build-release-config.mjs generates.
//   ✓ Zoom persistence            → save_zoom/load_zoom (app_config_dir/zoom).
//   ✓ Settings… (Cmd+,)           → menu item → window.__localixOpenSettings.
//   ✓ File ▸ New Chat (Cmd+N)     → menu item → dispatch_deep_link(localix://new).
//   ✓ File ▸ Open Recent          → set_recent_sessions cmd (UI pushes recents) →
//                                   rebuild menu; item → localix://session/<id>.
//   ✓ File ▸ New File / Open File… (Cmd+O) / Save (Cmd+S) + View ▸ Command Palette
//                                   / Toggle Sidebar / Terminal / panel openers →
//                                   forward_menu_command → window.__localixMenu(id)
//                                   → shared/lib/menuBus → ChatPage dispatcher.
//   ✓ Project menu                → set_projects cmd (UI pushes projects + active)
//                                   → rebuild menu; Open Folder… via the bridge,
//                                   each project item → localix://project/<id>.
//   ✓ Full screen: macOS native / win-linux F11 toggle (set_fullscreen).
//   ✓ Help menu (all platforms)  → "Localix Website" (help_website → opener) + About.
//   ✓ Native save dialog         → `save_file` command (exports; WKWebView ignores
//                                   the download attr on blob: URLs).
//   ✓ Branded app icon + About/app metadata (publisher/copyright/category/homepage).
//   ✓ No startup white flash     → window background_color + native .theme() from
//                                   the persisted resolved theme (save_theme/
//                                   load_theme_is_dark), built hidden and revealed
//                                   by deep_link_ready at first paint (+ watchdog).
//   ✓ macOS tray template icon   → inverts with the menu-bar theme.
//   ✓ Titlebar strip is macOS-only → win/linux keep the native OS titlebar (no
//                                   double bar); gated IS_MAC in WorkspaceShell.
//
// Still to port (need the user — keys/endpoint or a visual pass):
//
//   • Vibrancy (macOS translucent sidebar) / Windows 11 Mica — all-or-nothing,
//     needs a visual pass.
//   • Custom frameless win/linux titlebar with in-app window controls.
//
// See apps/desktop-tauri/README.md and the [[desktop-tauri-migration]] note.
// ─────────────────────────────────────────────────────────────────────────────

use tauri::{Manager, RunEvent};

mod commands;
mod deeplink;
mod frontend_flush;
mod log;
#[cfg(target_os = "macos")]
mod macos_tabs;
#[cfg(target_os = "macos")]
mod main_queue;
mod menu;
mod native_browser;
#[cfg(target_os = "linux")]
mod native_browser_gtk;
mod native_browser_lifecycle;
#[cfg(target_os = "macos")]
mod native_chrome;
#[cfg(target_os = "macos")]
mod native_header;
mod native_notifications;
#[cfg(target_os = "macos")]
mod native_tab_controls;
#[cfg(target_os = "macos")]
mod native_titlebar_backdrop;
mod prefs;
mod process_tree;
mod quit;
mod runtime_contract;
mod sidecar;
mod supervisor;
mod tray;
mod updater;
#[cfg(target_os = "macos")]
mod webcrypto_key;
mod window_material;
mod workspace_builder;
mod workspace_drag;
#[cfg(target_os = "macos")]
mod workspace_drag_capture;
#[cfg(target_os = "macos")]
mod workspace_drag_image;
mod workspace_drag_snapshot;
mod workspace_drag_state;
#[cfg(target_os = "macos")]
mod workspace_drag_tracking;
mod workspace_lifecycle;
#[cfg(target_os = "macos")]
mod workspace_menu;
#[cfg(all(debug_assertions, target_os = "macos"))]
mod workspace_probe;
#[cfg(all(debug_assertions, target_os = "macos"))]
mod workspace_probe_lifecycle;
mod workspace_session;
mod workspace_session_model;
mod workspace_tab_drop;
mod workspace_transfer;
#[cfg(target_os = "macos")]
mod workspace_visibility;
mod workspace_windows;

use crate::commands::{
    dragged_paths, focus_app, frontend_log, notify, open_external, pick_directory, pick_files,
    restart_app, save_file, set_badge, set_theme, set_title,
};
#[cfg(target_os = "macos")]
use crate::deeplink::open_path_deep_link;
use crate::deeplink::{
    deep_link_ready, dispatch_deep_link, forward_edit_command, forward_menu_command,
    open_path_args, show_main_window, DeepLinks,
};
use crate::frontend_flush::quit_ready;
use crate::log::{logln, logln_at};
use crate::menu::{
    build_app_menu, set_projects, set_recent_sessions, MenuData, MenuState, QUIT_MENU_ID,
};
use crate::native_browser::{
    browser_bounds, browser_close_many, browser_eval, browser_go, browser_inject, browser_navigate,
    browser_navigation_state, browser_open, browser_placeholder, browser_reload, browser_snapshot,
    browser_tab_menu, handle_browser_menu_event, workbench_snapshot,
};
use crate::prefs::{apply_zoom_menu, is_zoom_menu_id, restore_zoom, ZoomState};
use crate::quit::{on_exit_requested, window_state_flags, QuitState};
use crate::sidecar::{
    prepare_api, resync_runtime_status, start_api, stop_api_blocking, ApiSidecar, EXIT_GRACE,
};

use crate::updater::{updater_check, updater_install, PendingUpdate};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Auto-updater: checks the `latest.json` endpoint and verifies the download's minisign signature
/// before installing. Registered only in a release build (`build.rs`, `localix_updater`), because
/// its endpoint and public key come from the release overlay (`scripts/build-release-config.mjs`);
/// the base `tauri.conf.json` has none, and the plugin refuses to start without them. The UI drives
/// it through `updater_check` / `updater_install` and only when `updater::UPDATER_ENABLED`.
#[cfg(localix_updater)]
fn with_updater(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.plugin(tauri_plugin_updater::Builder::new().build())
}

#[cfg(not(localix_updater))]
fn with_updater(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
}

pub fn run() {
    // Anchor the startup clock to the process, not to whichever milestone logs
    // first. Every `logln_at` below is relative to this.
    let _ = crate::log::elapsed_ms();
    let builder = tauri::Builder::default();
    // Windows/Linux document opens arrive in argv. macOS LaunchServices owns the
    // singleton and delivers documents through Apple events AFTER setup. The
    // plugin exits a second bundle during setup, before that event arrives (e.g.
    // an installed app opened while `tauri dev` holds its socket), losing the file
    // and forwarding only focus. Let the macOS bundle receive its own documents.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        show_main_window(app);
        // A second launch (double-click an associated file / `localix <path>`
        // on Windows+Linux) hands its argv here. argv[0] is the exe — skip it.
        // A `localix://` URL in argv (warm deep link on Windows/Linux) is
        // forwarded to the deep-link plugin by the crate's `deep-link`
        // feature BEFORE this callback runs; open_path_args skips those.
        // A relative path is relative to the SECOND launch's directory, which
        // is `cwd` — not this process's, which was fixed at its own launch.
        if argv.len() > 1 {
            open_path_args(app, &argv[1..], std::path::Path::new(&cwd));
        }
    }));
    let builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        // Remember the window's size + position across launches (native app feel).
        // Saves on `Exit` and in the before-quit handshake (`quit.rs`), restores on the
        // window we build below in setup(). VISIBLE is excluded: the window is built
        // hidden and revealed by deep_link_ready at first paint — the plugin's restore
        // would otherwise re-show it early (white flash).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags())
                // Native Mac workspace sessions own all secondary windows, including drag previews.
                .with_filter(|label| !cfg!(target_os = "macos") || label == "main")
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init());
    let builder = with_updater(builder);
    #[cfg(target_os = "macos")]
    let builder = builder.manage(crate::workspace_drag_state::WorkspaceDrags::default());
    builder
        .menu(|h| build_app_menu(h, &MenuData::default()))
        // App-menu events. Predefined items (Copy/Paste/Hide/…) act natively and
        // never reach here; every custom item's id is routed below.
        .on_menu_event(|app, event| {
            #[cfg(target_os = "macos")]
            if crate::macos_tabs::handle_menu(app, event.id().as_ref()) {
                return;
            }
            if handle_browser_menu_event(app, event.id().as_ref()) {
                return;
            }
            // Quit is a custom item on purpose (see `quit_item` in menu.rs):
            // `app.exit` raises `ExitRequested`, which is what gives the runtime its
            // graceful `shutdown` before the process ends.
            if event.id().as_ref() == QUIT_MENU_ID {
                app.exit(0);
                return;
            }
            // Settings… → drive the UI's inspector settings panel (no URL route).
            if event.id().as_ref() == "open_settings" {
                if let Some(w) = crate::workspace_windows::active_view(app) {
                    let _ =
                        w.eval("window.__localixOpenSettings && window.__localixOpenSettings()");
                }
                return;
            }
            // Window ▸ Close Window uses Cmd+Shift+W. Cmd+W is intentionally a
            // custom Close Tab item routed to the webview (see menu.rs).
            if event.id().as_ref() == "close_window" {
                if let Some(w) = crate::workspace_windows::active_window(app) {
                    #[cfg(target_os = "macos")]
                    crate::workspace_visibility::hide(app, w.label());
                    #[cfg(not(target_os = "macos"))]
                    let _ = w.close();
                }
                return;
            }
            // File ▸ New Chat → reuse the deep-link path for minting a fresh chat.
            if event.id().as_ref() == "new_chat" {
                show_main_window(app);
                dispatch_deep_link(app, "localix://new".into());
                return;
            }
            // File ▸ Open Recent ▸ <session> → focus + open that session by id.
            if let Some(session_id) = event.id().as_ref().strip_prefix("recent:") {
                show_main_window(app);
                dispatch_deep_link(app, format!("localix://session/{session_id}"));
                return;
            }
            // Project ▸ <project> → focus + switch to that project by id (same
            // deep-link switch path the quick-switcher uses).
            if let Some(project_id) = event.id().as_ref().strip_prefix("project:") {
                show_main_window(app);
                dispatch_deep_link(app, format!("localix://project/{project_id}"));
                return;
            }
            // Help web destinations always open in the system browser. Product
            // UI destinations (shortcuts/diagnostics) fall through to the shared
            // menu bridge below.
            let help_url = match event.id().as_ref() {
                "help_docs" => Some("https://github.com/rsaryev/localix/tree/main/docs"),
                "help_report_issue" => Some("https://github.com/rsaryev/localix/issues/new"),
                "help_releases" => Some("https://github.com/rsaryev/localix/releases/latest"),
                "help_website" => Some("https://localix.ai"),
                _ => None,
            };
            if let Some(url) = help_url {
                use tauri_plugin_opener::OpenerExt;
                let _ = app.opener().open_url(url, None::<&str>);
                return;
            }
            // View ▸ Toggle Full Screen (win/linux F11; macOS uses native fullscreen).
            if event.id().as_ref() == "toggle_fullscreen" {
                if let Some(w) = crate::workspace_windows::active_window(app) {
                    let fs = w.is_fullscreen().unwrap_or(false);
                    let _ = w.set_fullscreen(!fs);
                }
                return;
            }
            let id = event.id().as_ref();
            if forward_edit_command(app, id) {
                return;
            }
            // View ▸ Zoom In/Out/Actual Size — the step size, clamp range and
            // persistence all live in `prefs`; here we only route the id.
            if is_zoom_menu_id(id) {
                apply_zoom_menu(app, id);
                return;
            }
            // Everything else is an in-app action (Open File, Save, Toggle Sidebar,
            // panel openers, …). Forward the menu id to the webview bridge, which
            // routes it to the matching in-app action via the menu bus.
            forward_menu_command(app, id);
        })
        .invoke_handler(tauri::generate_handler![
            notify,
            frontend_log,
            focus_app,
            deep_link_ready,
            set_title,
            set_badge,
            set_theme,
            save_file,
            dragged_paths,
            open_external,
            restart_app,
            set_recent_sessions,
            set_projects,
            resync_runtime_status,
            pick_directory,
            pick_files,
            updater_check,
            updater_install,
            browser_open,
            browser_bounds,
            browser_navigate,
            browser_go,
            browser_navigation_state,
            browser_reload,
            browser_close_many,
            crate::native_browser::browser_release,
            browser_snapshot,
            browser_placeholder,
            workbench_snapshot,
            browser_eval,
            browser_inject,
            browser_tab_menu,
            quit_ready,
            crate::workspace_windows::workspace_open,
            crate::workspace_windows::workspace_location,
            crate::workspace_transfer::workspace_transfer_open,
            crate::workspace_transfer::workspace_transfer_take,
            crate::workspace_transfer::workspace_transfer_ready,
            crate::workspace_drag::workspace_drag_prepare,
            crate::workspace_drag::workspace_drag_commit,
            crate::workspace_drag::workspace_drag_cancel,
            crate::workspace_drag::workspace_transfer_presented,
            crate::workspace_tab_drop::workspace_tab_drop_destination,
            #[cfg(all(debug_assertions, target_os = "macos"))]
            crate::workspace_probe::workspace_probe
        ])
        .manage(PendingUpdate::default())
        .manage(DeepLinks::default())
        .manage(ZoomState::default())
        .manage(MenuState::default())
        .manage(ApiSidecar::default())
        .manage(QuitState::default())
        .manage(crate::frontend_flush::FrontendFlush::default())
        .manage(crate::native_notifications::NativeNotifications::default())
        .manage(crate::native_browser_lifecycle::NativeBrowserLifecycle::default())
        .manage(crate::workspace_windows::WorkspaceWindows::default())
        .manage(crate::workspace_transfer::WorkspaceTransfers::default())
        .setup(|app| {
            // Before any webview exists, so no page can reach WebKit's keychain fallback first.
            #[cfg(target_os = "macos")]
            webcrypto_key::install(app.handle());
            // Deep links (localix://…). The scheme is declared in tauri.conf.json
            // (plugins.deep-link.desktop.schemes); on Linux/Windows it must also be
            // registered with the OS at runtime in dev.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
                let _ = app.deep_link().register_all();
                // Warm links (app already running) arrive here. Bring the window
                // forward — a localix:// link should surface the app, like a
                // native document open.
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    let urls = event.urls();
                    if !urls.is_empty() {
                        show_main_window(&handle);
                    }
                    for url in urls {
                        // On macOS the plugin also emits file:// URLs. RunEvent::Opened
                        // owns those; forwarding them raw makes the UI reject a valid file.
                        if url.scheme() == "localix" {
                            dispatch_deep_link(&handle, url.to_string());
                        }
                    }
                });
                // Cold-start link (OS launched the app to service the URL).
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    for url in urls {
                        if url.scheme() == "localix" {
                            dispatch_deep_link(app.handle(), url.to_string());
                        }
                    }
                }
            }

            // Cold-start file arguments on every platform (including macOS `open --args`).
            // Finder file URLs also arrive via RunEvent::Opened below.
            // `args_os`, not `args`: `args` PANICS on an argument that is not valid
            // Unicode (a Linux file name in a legacy encoding, an unpaired UTF-16
            // surrogate on Windows), and release builds abort on panic — so opening
            // such a file crashed the app before its window existed.
            {
                let args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
                let cwd = std::env::current_dir().unwrap_or_default();
                open_path_args(app.handle(), &args, &cwd);
            }

            // PROD only: start bundled Bun as a directly managed child and return
            // its selected port immediately. The webview paints while the API boots;
            // readiness and failures are delivered asynchronously by `sidecar`.
            // Empty in dev, where beforeDevCommand owns API watch + Vite together.
            logln(format!("launch start: v{}", app.package_info().version));
            // Plugin registration + the native menu have already run by here.
            logln_at("setup entered");
            let (init_script, api_launch) = prepare_api(app);
            // The runtime's cold start (about 250 ms to load its code) is the longest thing the
            // launch waits on, and creating the window takes about 100 ms of the main thread. Started
            // first, they overlap. A `ready` that arrives before the window exists is recorded and
            // replayed by `resync_runtime_status`, which is what that handshake is for.
            start_api(app.handle(), api_launch);

            app.state::<crate::workspace_windows::WorkspaceWindows>()
                .set_init_script(init_script.clone());
            #[cfg(target_os = "macos")]
            let saved_session = crate::workspace_session::load(app.handle());
            #[cfg(target_os = "macos")]
            let startup_label = saved_session
                .groups
                .iter()
                .flat_map(|group| &group.tabs)
                .find(|tab| tab.label == "main")
                .or_else(|| {
                    saved_session
                        .groups
                        .first()
                        .and_then(|group| group.tabs.first())
                })
                .map_or("main", |tab| tab.label.as_str());
            #[cfg(target_os = "macos")]
            let initial_route = saved_session.route(startup_label);
            #[cfg(not(target_os = "macos"))]
            let initial_route = None;
            #[cfg(not(target_os = "macos"))]
            let startup_label = "main";
            #[cfg(target_os = "macos")]
            if saved_session.groups.iter().any(|group| {
                group.hidden && group.tabs.iter().any(|tab| tab.label == startup_label)
            }) {
                app.state::<crate::workspace_windows::WorkspaceWindows>()
                    .0
                    .lock()
                    .unwrap()
                    .entries
                    .insert(
                        startup_label.into(),
                        crate::workspace_windows::Workspace {
                            route: initial_route.map(str::to_string),
                            hidden: true,
                            ..Default::default()
                        },
                    );
            }
            let main_window = crate::workspace_builder::build(
                app.handle(),
                startup_label,
                initial_route,
                &init_script,
            )?;
            crate::workspace_windows::register(&main_window);
            // The window opens on its saved route; record it before the page reports one, so a
            // save in between (a window event at launch) cannot write the route back as empty.
            if let Some(entry) = app
                .state::<crate::workspace_windows::WorkspaceWindows>()
                .0
                .lock()
                .unwrap()
                .entries
                .get_mut(startup_label)
            {
                entry.route = entry.route.take().or(initial_route.map(str::to_string));
            }
            // The webview now exists and has begun loading `index.html`. The gap
            // from here to the UI's own `shell.paint` is document load + entry
            // chunk parse + first React render — the span that owns most of the
            // launch, and the one to attack next.
            logln_at("webview created");

            // Restore the persisted webview zoom from the last session.
            restore_zoom(app.handle());
            #[cfg(target_os = "macos")]
            crate::workspace_session::restore(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                // FILE ASSOCIATION open on macOS (double-click / "Open With"): the OS
                // delivers the file URL(s) here (warm or cold). Route each through the
                // same open flow as the CLI / deep link → a file opens an editor tab.
                // macOS Dock-icon click when no window is visible (we now hide
                // rather than close, per the tray "close to tray" fix above, so
                // the OS never sees a real window and routes reactivation here
                // instead of spawning a new one — the AppKit
                // `applicationShouldHandleReopen:` equivalent).
                #[cfg(target_os = "macos")]
                RunEvent::Reopen { .. } => {
                    show_main_window(app);
                }
                #[cfg(target_os = "macos")]
                RunEvent::Opened { urls } => {
                    show_main_window(app);
                    for url in urls {
                        if let Ok(path) = url.to_file_path() {
                            dispatch_deep_link(app, open_path_deep_link(&path));
                        }
                    }
                }
                RunEvent::ExitRequested { ref api, code, .. } => on_exit_requested(app, api, code),
                // Whatever route the app took out — including one that never raised
                // `ExitRequested` (Dock Quit, logout, WM_QUIT) — the runtime gets its
                // `shutdown` and a bounded wait, then is killed; it never outlives the
                // shell. A no-op after the before-quit handshake already stopped it.
                RunEvent::Exit => stop_api_blocking(app, EXIT_GRACE),
                _ => {}
            }
        });
}
