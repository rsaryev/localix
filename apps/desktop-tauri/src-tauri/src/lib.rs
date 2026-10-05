// ─────────────────────────────────────────────────────────────────────────────
// desktop-tauri native shell. What is wired:
//
//   ✓ Native folder/file picker  → `pick_directory` / `pick_files` commands over
//                                   tauri-plugin-dialog (every Tauri target, no
//                                   external binary). The API's osascript /
//                                   PowerShell / zenity picker is the BROWSER-only
//                                   fallback now.
//   ✓ macOS Overlay titlebar     → TitleBarStyle::Overlay + hidden_title +
//                                   traffic_light_position (see window builder).
//   ✓ Window geometry persistence → tauri-plugin-window-state.
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

use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

mod commands;
mod deeplink;
mod log;
mod menu;
mod native_browser;
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

use crate::commands::{
    dragged_paths, frontend_log, notify, open_external, pick_directory, pick_files, restart_app,
    save_file, set_badge, set_theme, set_title,
};
#[cfg(target_os = "macos")]
use crate::deeplink::open_path_deep_link;
use crate::deeplink::{
    deep_link_ready, dispatch_deep_link, forward_edit_command, forward_menu_command,
    is_embedded_navigation_url, is_external_url, is_internal_url, is_loopback, open_path_args,
    show_main_window, DeepLinks,
};
use crate::log::{logln, logln_at};
use crate::menu::{
    build_app_menu, set_projects, set_recent_sessions, MenuData, MenuState, QUIT_MENU_ID,
};
use crate::native_browser::{
    browser_bounds, browser_close_many, browser_eval, browser_go, browser_inject, browser_navigate,
    browser_navigation_state, browser_open, browser_placeholder, browser_reload, browser_snapshot,
    browser_tab_menu, handle_browser_menu_event, workbench_snapshot,
};
use crate::prefs::{apply_zoom_menu, is_zoom_menu_id, load_theme_is_dark, restore_zoom, ZoomState};
use crate::quit::{on_exit_requested, quit_ready, window_state_flags, QuitState};
use crate::sidecar::{
    prepare_api, resync_runtime_status, start_api, stop_api_blocking, ApiSidecar, EXIT_GRACE,
};
use crate::tray::tray_available;
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
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init());
    let builder = with_updater(builder);
    builder
        .menu(|h| build_app_menu(h, &MenuData::default()))
        // App-menu events. Predefined items (Copy/Paste/Hide/…) act natively and
        // never reach here; every custom item's id is routed below.
        .on_menu_event(|app, event| {
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
                if let Some(w) = app.get_webview_window("main") {
                    let _ =
                        w.eval("window.__localixOpenSettings && window.__localixOpenSettings()");
                }
                return;
            }
            // Window ▸ Close Window uses Cmd+Shift+W. Cmd+W is intentionally a
            // custom Close Tab item routed to the webview (see menu.rs).
            if event.id().as_ref() == "close_window" {
                if let Some(w) = app.get_webview_window("main") {
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
                if let Some(w) = app.get_webview_window("main") {
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
            browser_snapshot,
            browser_placeholder,
            workbench_snapshot,
            browser_eval,
            browser_inject,
            browser_tab_menu,
            quit_ready
        ])
        .manage(PendingUpdate::default())
        .manage(DeepLinks::default())
        .manage(ZoomState::default())
        .manage(MenuState::default())
        .manage(ApiSidecar::default())
        .manage(QuitState::default())
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

            // `WebviewUrl::App` resolves to the Vite dev server in dev and to the
            // bundled frontendDist in prod — one code path for both.
            // Startup background: paint the backing to the app's theme so there's no
            // wrong-colour flash before the webview's CSS loads. Prefer the theme the
            // user last resolved (persisted by set_theme) so forcing dark-on-a-light-OS
            // still starts dark; fall back to the dark-first default and refine to the
            // OS theme after build().
            //
            // What background_color actually does per platform, from the sources rather than from
            // memory — the old note here said "macOS ignores background_color for the webview
            // layer", which is misleading enough to send the next reader down the wrong path:
            //   - tauri 2.11.5 `webview/webview_window.rs`: WebviewWindowBuilder::background_color
            //     sets BOTH the window and the webview builder, and documents the webview layer as
            //     "not implemented" on macOS/iOS.
            //   - wry 0.55.1 `src/wkwebview/mod.rs`: on macOS the WKWebView has drawsBackground
            //     DISABLED, so the WINDOW colour shows through wherever the page has not painted —
            //     i.e. this value is what covers the gap on macOS too. wry additionally applies it
            //     as `setUnderPageBackgroundColor` (macOS 12+), the colour of overscroll areas past
            //     the page bounds.
            // So: this matters on every platform. What it cannot fix is a sub-surface that paints
            // its OWN background — a Monaco editor created without a theme used Monaco's light
            // default and flashed a white rectangle regardless of anything set here.
            let persisted_dark = load_theme_is_dark(app.handle());
            // macOS has no use for it: the window is transparent there and the NSVisualEffectView is
            // the backing, so this colour only exists for the platforms that keep an opaque frame.
            #[cfg(not(target_os = "macos"))]
            let initial_bg = if persisted_dark == Some(false) {
                tauri::window::Color(249, 249, 249, 255)
            } else {
                tauri::window::Color(7, 7, 7, 255)
            };
            // Mirror the same decision on the NATIVE theme so OS chrome (Windows
            // titlebar, native scrollbars/context menus, prefers-color-scheme)
            // starts matching instead of flipping once React mounts. The web app
            // defaults to dark when nothing is stored, so dark is the right
            // first-launch fallback; the UI re-asserts the resolved theme
            // post-mount via set_theme either way.
            let initial_theme = if persisted_dark == Some(false) {
                tauri::Theme::Light
            } else {
                tauri::Theme::Dark
            };
            let mut builder =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("Localix")
                    .inner_size(1280.0, 832.0)
                    .min_inner_size(900.0, 600.0)
                    .resizable(true)
                    // First-launch placement: center on the active monitor instead
                    // of the OS default (top-left cascade on Windows/Linux). On the
                    // 2nd+ launch the window-state plugin restores the saved
                    // position after build(), overriding this — so .center() only
                    // ever affects the very first run.
                    .center()
                    .theme(Some(initial_theme))
                    // Built hidden; revealed by deep_link_ready at the UI's first
                    // paint (background_color can't cover the macOS webview layer,
                    // so a visible-from-birth window flashes white on dark theme).
                    // A watchdog below shows it anyway if the UI never signals.
                    // Disable Tauri's native drag-drop handler so the webview fires the
                    // normal HTML5 drag events: the composer attaches a dropped file via
                    // `dataTransfer.files` (useComposerDropzone) and the window guard
                    // routes a stray drop (fileDropGuard/fileDropRouter, real paths via
                    // the `dragged_paths` command below).
                    //
                    // Do NOT re-enable the native handler. Ground truth from wry
                    // 0.55 (src/wkwebview/drag_drop.rs): when enabled, its
                    // performDragOperation returns YES WITHOUT calling super, so
                    // WebKit never sees ANY drop on the window — not just OS-file
                    // drops but every IN-PAGE HTML5 drag too (sessions/snippets/
                    // db rows dragged into the composer, editor-grid tab docking).
                    // Also its `position` is typed PhysicalPosition but on macOS
                    // carries LOGICAL points (NSView draggingLocation), so any
                    // dpr conversion misroutes hit-testing. The all-native route
                    // was tried and reverted (see git bdc65085 / a49caf9b).
                    .disable_drag_drop_handler()
                    .visible(false);

            // macOS native feel: hide the system titlebar and let the UI's own
            // slim drag-strip flow to the very top, with the traffic lights
            // floating as an Overlay over it. `hidden_title` drops the centered
            // window title (the UI owns that chrome); `traffic_light_position`
            // nudges the lights down so they sit vertically centered in the UI's
            // 36px titlebar strip instead of hugging the frame corner.
            #[cfg(target_os = "macos")]
            {
                use tauri::{LogicalPosition, TitleBarStyle};
                builder = builder
                    .title_bar_style(TitleBarStyle::Overlay)
                    .hidden_title(true)
                    .traffic_light_position(LogicalPosition::new(19.0, 11.0))
                    // Transparent so the NSVisualEffectView attached after build() is what backs the
                    // window. `background_color` is deliberately NOT set here: tao lets that colour
                    // win over transparency, which would paint the NSWindow solid and hide the
                    // material. The anti-flash role it played is taken over by the material itself,
                    // and the window is built hidden anyway.
                    .transparent(true);
            }

            // Every other platform keeps the opaque backing exactly as before: no vibrancy, no
            // transparency, and the anti-flash colour that covers the gap before the webview paints.
            #[cfg(not(target_os = "macos"))]
            {
                builder = builder.background_color(initial_bg);
            }

            // External links open in the system browser instead of navigating the
            // app webview away from itself (a hard break with no back button).
            // Internal app URLs + hash routes load normally.
            {
                use tauri::webview::NewWindowResponse;
                use tauri_plugin_opener::OpenerExt;
                let nav_handle = app.handle().clone();
                builder = builder.on_navigation(move |url| {
                    if is_internal_url(url) {
                        return true;
                    }
                    // Loopback URLs (Preview iframe: dev server / strip-proxy) must
                    // load in-webview in release too — this handler fires for every
                    // frame, not just the top document.
                    if is_loopback(url) {
                        return true;
                    }
                    if is_external_url(url) {
                        let _ = nav_handle.opener().open_url(url.as_str(), None::<&str>);
                        return false;
                    }
                    // Generated documents/workers remain in WebKit. Unknown
                    // schemes (file:, javascript:, custom handlers) are denied.
                    is_embedded_navigation_url(url)
                });

                // window.open / target="_blank" (e.g. an OAuth "Connect" popup) →
                // open external http(s) in the system browser instead of a bare
                // embedded webview window. The OAuth flow finalizes via the local
                // callback HTTP server, so the browser is the correct, native path.
                let open_handle = app.handle().clone();
                builder = builder.on_new_window(move |url, _features| {
                    if is_internal_url(&url) || is_loopback(&url) {
                        return NewWindowResponse::Allow;
                    }
                    if is_external_url(&url) {
                        let _ = open_handle.opener().open_url(url.as_str(), None::<&str>);
                        return NewWindowResponse::Deny;
                    }
                    if is_embedded_navigation_url(&url) {
                        NewWindowResponse::Allow
                    } else {
                        NewWindowResponse::Deny
                    }
                });
            }

            if !init_script.is_empty() {
                builder = builder.initialization_script(&init_script);
            }
            let main_window = builder.build()?;

            // The material can only be attached once the NSWindow exists, so it happens here rather
            // than on the builder. `UnderWindowBackground` samples the DESKTOP behind the app — that
            // is what makes the wallpaper show through rather than a self-contained grey blur — and
            // the follows-active state dims it when the window loses focus, like native chrome.
            //
            // A failure is reported, not swallowed: tauri's own `.effects(...)` path discards this
            // Result, and a window left transparent with no material behind it is the one outcome
            // that looks broken rather than merely unstyled.
            #[cfg(target_os = "macos")]
            {
                // Same boolean that already picked `initial_theme`/`initial_bg` above, so the
                // material the user last resolved is what the window opens with — `window_material`
                // owns which concrete NSVisualEffectMaterial serves each appearance (dark needs
                // `HudWindow`, light needs `UnderWindowBackground`; a light interface over the dark
                // material reads as mud) and re-attaches identically from `set_theme` on a live flip.
                let initial_appearance = if persisted_dark == Some(false) {
                    window_material::Appearance::Light
                } else {
                    window_material::Appearance::Dark
                };
                match window_material::apply(&main_window, initial_appearance) {
                    Ok(()) => logln_at("window material: vibrancy attached"),
                    Err(error) => logln_at(format!("window material: vibrancy failed ({error})")),
                }
            }

            // The webview now exists and has begun loading `index.html`. The gap
            // from here to the UI's own `shell.paint` is document load + entry
            // chunk parse + first React render — the span that owns most of the
            // launch, and the one to attack next.
            logln_at("webview created");

            // "Close to tray" (menu-bar app pattern): the native window-close
            // button ("X" / traffic-light red dot) must NOT quit the app —
            // otherwise the tray/menu-bar icon disappears with it. Intercept the
            // close, hide the window instead, and let the tray's "Show
            // Localix" / dock icon bring it back. Real quit stays reachable
            // via the tray's "Quit Localix" (`app.exit(0)`, unaffected by
            // this — it doesn't go through a window close at all).
            //
            // SAFETY GATE (tray_available): hiding-on-close only leaves a way
            // back when there's somewhere to click "Show". On macOS the menu
            // bar + Dock always provide that (Dock click → RunEvent::Reopen),
            // so hide is always safe. On Windows/Linux the ONLY re-entry is the
            // tray icon — and setup_tray is best-effort (a tray failure must
            // never block startup; on Linux the StatusNotifier host is often
            // absent). If the tray never appeared, hiding would strand the user
            // with no window, no Reopen, and no Quit — a zombie process. So on
            // non-macOS we hide only when the tray actually came up; otherwise
            // the close becomes a quit (the same `app.exit(0)` as the Quit item,
            // so the page flushes and the sidecar stops). The flag is set after deep_link_ready schedules
            // setup_tray; close normally happens far later.
            main_window.on_window_event({
                let app_handle = app.handle().clone();
                move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let can_reopen = cfg!(target_os = "macos") || tray_available();
                        if !can_reopen {
                            // No tray, no Reopen: quit rather than orphan a headless
                            // process. As a QUIT, not a window close: letting the close
                            // through destroyed the webview before `ExitRequested`, so
                            // the before-quit handshake had no page left to flush.
                            api.prevent_close();
                            app_handle.exit(0);
                            return;
                        }
                        api.prevent_close();
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                }
            });

            // Reveal watchdog: deep_link_ready normally shows the window at the
            // UI's first paint, but a UI failure (script error before the effect
            // runs) must never leave the app invisible. Only fires when the UI
            // never signalled readiness — an unconditional show would steal focus
            // ~3s after every normal launch (deep_link_ready reveals in <1s).
            {
                let watchdog = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(4));
                    if !watchdog.state::<DeepLinks>().ready.load(Ordering::Acquire) {
                        show_main_window(&watchdog);
                    }
                });
            }

            // Restore the persisted webview zoom from the last session.
            restore_zoom(app.handle());
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
