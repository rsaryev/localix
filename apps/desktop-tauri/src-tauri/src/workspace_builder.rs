//! One builder for every trusted workspace; the API sidecar is prepared once in lib.rs.
use crate::deeplink::{is_embedded_navigation_url, is_external_url, is_internal_url, is_loopback};
use crate::prefs::load_theme_is_dark;
#[cfg(target_os = "macos")]
use crate::{log::logln_at, window_material};
use tauri::{AppHandle, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub(crate) fn build(
    app: &AppHandle,
    label: &str,
    route: Option<&str>,
    init_script: &str,
) -> tauri::Result<WebviewWindow> {
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
    let persisted_dark = load_theme_is_dark(app);
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
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
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
        .focused(false)
        .visible(false);

    // Share the native button row with the HTML breadcrumb toolbar. AppKit's
    // contentLayoutRect drives the reserved native-tab band through native_chrome.
    #[cfg(target_os = "macos")]
    {
        use tauri::TitleBarStyle;
        builder = builder
            .title_bar_style(TitleBarStyle::Overlay)
            // Keep the native tab labels; the standalone window title duplicates
            // the workspace breadcrumb and adds unwanted chrome above the tabs.
            .hidden_title(true)
            .tabbing_identifier("ai.localix.workspace")
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
        let nav_handle = app.clone();
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
        let open_handle = app.clone();
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
        builder = builder.initialization_script(init_script);
    }
    let context = serde_json::json!({"id": label, "route": route});
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .initialization_script("if(document.documentElement){document.documentElement.dataset.nativeTitlebar='true';}else{document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.nativeTitlebar='true';},{once:true});}");
    }
    builder = builder.initialization_script(format!(
    "window.__LOCALIX_WORKSPACE={context};if(!location.hash && window.__LOCALIX_WORKSPACE.route) location.hash=window.__LOCALIX_WORKSPACE.route;"
));
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
        match window_material::apply(&main_window.as_ref().window(), initial_appearance) {
            Ok(()) => logln_at("window material: vibrancy attached"),
            Err(error) => logln_at(format!("window material: vibrancy failed ({error})")),
        }
        if let Err(error) = crate::native_chrome::install(app, &main_window.as_ref().window()) {
            logln_at(format!("native chrome: {error}"));
        }
    }

    Ok(main_window)
}
