//! Debug-only evidence for the native smoke check; never part of a release build.
use tauri::{AppHandle, Manager, Webview};

#[tauri::command]
pub(crate) async fn workspace_probe(
    app: AppHandle,
    caller: Webview,
    action: Option<String>,
) -> Result<serde_json::Value, String> {
    crate::workspace_windows::require_workspace(&caller)?;
    if action.as_deref() == Some("browser") {
        let url = caller
            .url()
            .map_err(|error| error.to_string())?
            .join("/browser")
            .map_err(|error| error.to_string())?
            .to_string();
        crate::native_browser::browser_open(
            app.clone(),
            caller.clone(),
            "smoke-browser-12345678".into(),
            url,
            None,
        )
        .await?;
    }
    let lifecycle = matches!(
        action.as_deref(),
        Some("red_close_reopen" | "hide_window_reopen" | "minimize_reopen" | "hide_quit")
    );
    let label = caller.label().to_string();
    let (tx, rx) = std::sync::mpsc::channel();
    crate::macos_tabs::defer(move || {
        use objc2_app_kit::NSWindow;
        if lifecycle {
            crate::workspace_probe_lifecycle::run(app, label, action.unwrap(), tx);
            return;
        }
        if action.as_deref() == Some("plus") {
            use objc2::{msg_send, sel};
            if let Some(window) = app.get_window(&label) {
                if let Ok(ptr) = window.ns_window() {
                    let native = unsafe { &*ptr.cast::<NSWindow>() };
                    let _: bool = unsafe {
                        msg_send![native, tryToPerform: sel!(newWindowForTab:), with: std::ptr::null::<objc2::runtime::AnyObject>()]
                    };
                }
            }
        } else if action.as_deref() == Some("quit") {
            app.exit(0);
        } else if action.as_deref() == Some("close") {
            crate::workspace_lifecycle::close(&app, &label);
        } else if action.as_deref() == Some("red_close") {
            if let Some(window) = app.get_window(&label) {
                if let Ok(ptr) = window.ns_window() {
                    let native = unsafe { &*ptr.cast::<NSWindow>() };
                    if let Some(button) =
                        native.standardWindowButton(objc2_app_kit::NSWindowButton::CloseButton)
                    {
                        unsafe {
                            button.performClick(None);
                        }
                    }
                }
            }
        } else if action.as_deref() == Some("hide_window") {
            crate::workspace_visibility::hide(&app, &label);
        } else if action.as_deref() == Some("reopen") {
            crate::deeplink::show_main_window(&app);
        } else if action.as_deref() == Some("activate") {
            if let Some(window) = app.get_window(&label) {
                if let Ok(ptr) = window.ns_window() {
                    let native = unsafe { &*ptr.cast::<NSWindow>() };
                    if let Some(group) = native.tabGroup() {
                        group.setSelectedWindow(Some(native));
                    }
                    native.makeKeyAndOrderFront(None);
                }
            }
        } else if action.as_deref() == Some("minimize") {
            if let Some(window) = app.get_window(&label) {
                let _ = window.minimize();
            }
        } else if let Some(action) = action {
            crate::macos_tabs::handle_menu(&app, &action);
        }
        let _ = tx.send(snapshot(&app));
    });
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(std::time::Duration::from_secs(if lifecycle {
            12
        } else {
            3
        }))
        .map_err(|_| "Native workspace probe timed out".to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(crate) fn snapshot(app: &AppHandle) -> serde_json::Value {
    use objc2_app_kit::{NSWindow, NSWindowStyleMask};
    let windows: Vec<_> = crate::workspace_windows::views(app).iter().filter_map(|view| {
            let window = view.window();
            let ptr = window.ns_window().ok()?;
            let native = unsafe { &*ptr.cast::<NSWindow>() };
            let content = native.contentView()?.bounds();
            let layout = native.contentLayoutRect();
            let frame = native.contentView().and_then(|content| unsafe { content.superview() });
            let effect = frame.as_ref().and_then(|frame| frame.viewWithTag(crate::window_material::FRAME_MATERIAL_TAG));
            let material = effect.as_ref().and_then(|effect| effect.clone()
                .downcast::<objc2_app_kit::NSVisualEffectView>().ok()).map(|effect| effect.material().0);
            Some(serde_json::json!({
                "label": view.label(), "title": native.title().to_string(),
                "key": native.isKeyWindow(), "visible": native.isVisible(),
                "minimized": native.isMiniaturized(),
                "overlay": native.styleMask().contains(NSWindowStyleMask::FullSizeContentView),
                "transparentTitlebar": native.titlebarAppearsTransparent(),
                "fullFrameMaterial": frame.as_ref().zip(effect.as_ref())
                    .is_some_and(|(frame, effect)| effect.frame() == frame.bounds()),
                "frameMaterial": material,
                "headerTint": frame.as_ref().and_then(|frame| crate::native_header::read_tint(frame)),
                "nativeBackdrop": frame.as_ref().map(|frame| crate::native_titlebar_backdrop::status(frame)),
                "nativeTitlebarViews": frame.as_ref().map(|frame| crate::native_titlebar_backdrop::debug_views(frame)),
                "nativeTabButtons": frame.as_ref().map(|frame| crate::native_tab_controls::buttons(frame)),
                "frameMaterialCount": frame.as_ref().map(|frame| frame.subviews().iter()
                    .filter(|view| view.tag() == crate::window_material::FRAME_MATERIAL_TAG).count()),
                "contentHeight": content.size.height, "layoutHeight": layout.size.height,
                "chromeGeometry": crate::native_chrome::measure(native),
                "children": window.webviews().iter().map(|child| child.label().to_string()).collect::<Vec<_>>(),
            }))
        }).collect();
    serde_json::json!({"session": crate::workspace_session::snapshot(app), "windows": windows})
}
