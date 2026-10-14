//! Public AppKit window tabbing, deferred outside Tao's non-reentrant event handler.
//! AppKit can synchronously redraw while joining tabs; run_on_main_thread alone
//! still executes inside Tao's handler. GCD runs between those callouts instead.
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObjectProtocol};
use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSResponder, NSWindow, NSWindowButton, NSWindowOrderingMode, NSWindowTabbingMode,
};
use std::cell::RefCell;
use std::collections::HashMap;
use tauri::{AppHandle, Manager, Window};

pub(crate) use crate::main_queue::defer;

// Window.nextResponder is weak; retain our responder until that window is destroyed.
thread_local! { static RESPONDERS: RefCell<HashMap<String, Retained<TabResponder>>> = RefCell::new(HashMap::new()); }
struct TabContext {
    app: AppHandle,
    label: String,
}
define_class!(
    #[unsafe(super(NSResponder))]
    #[thread_kind = MainThreadOnly]
    #[ivars = TabContext]
    struct TabResponder;
    unsafe impl NSObjectProtocol for TabResponder {}
    impl TabResponder {
        #[unsafe(method(newWindowForTab:))]
        fn new_window_for_tab(&self, _sender: Option<&AnyObject>) {
            request_open(&self.ivars().app, Some(self.ivars().label.clone()));
        }

        #[unsafe(method(closeWorkspaceWindow:))]
        fn close_workspace_window(&self, _sender: Option<&AnyObject>) {
            crate::workspace_visibility::hide(&self.ivars().app, &self.ivars().label);
        }
    }
);

pub(crate) fn install_new_tab_action(app: &AppHandle, window: &Window) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let Ok(ptr) = window.ns_window() else {
        return;
    };
    let native = unsafe { &*ptr.cast::<NSWindow>() };
    let responder = TabResponder::alloc(mtm).set_ivars(TabContext {
        app: app.clone(),
        label: window.label().into(),
    });
    let responder: Retained<TabResponder> = unsafe { msg_send![super(responder), init] };
    unsafe {
        responder.setNextResponder(native.nextResponder().as_deref());
        native.setNextResponder(Some(&responder));
        if let Some(button) = native.standardWindowButton(NSWindowButton::CloseButton) {
            button.setTarget(Some(&responder));
            button.setAction(Some(objc2::sel!(closeWorkspaceWindow:)));
        }
    }
    RESPONDERS.with(|responders| {
        responders
            .borrow_mut()
            .insert(window.label().into(), responder);
    });
}

pub(crate) fn remove_new_tab_action(label: &str) {
    let label = label.to_string();
    defer(move || {
        RESPONDERS.with(|responders| {
            responders.borrow_mut().remove(&label);
        });
    });
}

pub(crate) fn request_open(app: &AppHandle, host: Option<String>) {
    let app = app.clone();
    defer(move || {
        if let Err(error) = crate::workspace_windows::open(&app, host, None, None) {
            crate::log::logln(format!("workspace open failed: {error}"));
            use tauri_plugin_dialog::DialogExt;
            app.dialog()
                .message(error)
                .title("Could not open workspace")
                .show(|_| {});
        }
    });
}

pub(crate) fn reveal(app: &AppHandle, label: &str, host: Option<&str>, focus: bool, select: bool) {
    let app = app.clone();
    let label = label.to_string();
    let host = host.map(str::to_string);
    defer(move || {
        let Some(window) = app.get_window(&label) else {
            return;
        };
        let Ok(ptr) = window.ns_window() else {
            return;
        };
        let native = unsafe { &*ptr.cast::<NSWindow>() };
        native.setTabbingMode(NSWindowTabbingMode::Disallowed);
        let parent = host.and_then(|label| app.get_window(&label));
        let mut previous_selection = None;
        if let Some(parent) = parent {
            if let Ok(ptr) = parent.ns_window() {
                let parent = unsafe { &*ptr.cast::<NSWindow>() };
                native.setTabbingMode(NSWindowTabbingMode::Automatic);
                previous_selection = parent.tabGroup().and_then(|group| group.selectedWindow());
                parent.setTabbingMode(NSWindowTabbingMode::Automatic);
                parent.addTabbedWindow_ordered(native, NSWindowOrderingMode::Above);
            }
        } else {
            let _ = window.show();
        }
        if !native.isVisible()
            && native
                .tabGroup()
                .is_none_or(|group| group.windows().count() < 2)
        {
            let _ = window.show();
        }
        native.setTabbingMode(NSWindowTabbingMode::Automatic);
        // Selecting the tab through AppKit avoids orderFront breaking a fullscreen group.
        if let Some(group) = native.tabGroup() {
            if select {
                group.setSelectedWindow(Some(native));
            } else if let Some(previous) = previous_selection {
                group.setSelectedWindow(Some(&previous));
            }
        }
        if focus {
            native.deminiaturize(None);
            native.makeKeyWindow();
            if let Some(mtm) = MainThreadMarker::new() {
                #[allow(deprecated)]
                objc2_app_kit::NSApplication::sharedApplication(mtm)
                    .activateIgnoringOtherApps(true);
            }
        }
        crate::native_header::invalidate(&window);
    });
}

pub(crate) fn handle_menu(app: &AppHandle, id: &str) -> bool {
    if id == "close_workspace_tab" {
        let app = app.clone();
        defer(move || {
            if let Some(window) = crate::workspace_windows::active_window(&app) {
                crate::workspace_lifecycle::close(&app, window.label());
            }
        });
        return true;
    }
    if matches!(id, "new_workspace_tab" | "new_workspace_window") {
        let host = (id == "new_workspace_tab")
            .then(|| crate::workspace_windows::active_window(app).map(|w| w.label().to_string()))
            .flatten();
        request_open(app, host);
        return true;
    }
    if !matches!(
        id,
        "native_next_tab"
            | "native_previous_tab"
            | "native_merge_windows"
            | "native_detach_tab"
            | "native_toggle_tab_bar"
    ) {
        return false;
    }
    let app = app.clone();
    let id = id.to_string();
    defer(move || {
        let Some(window) = crate::workspace_windows::active_window(&app) else {
            return;
        };
        let Ok(ptr) = window.ns_window() else {
            return;
        };
        let native = unsafe { &*ptr.cast::<NSWindow>() };
        match id.as_str() {
            "native_next_tab" => native.selectNextTab(None),
            "native_previous_tab" => native.selectPreviousTab(None),
            "native_merge_windows" => merge_workspaces(&app, native),
            "native_detach_tab" => native.moveTabToNewWindow(None),
            _ => native.toggleTabBar(None),
        }
        crate::native_header::invalidate(&window);
    });
    true
}

// Transparent Tauri windows opt out of automatic tabbing process-wide. AppKit's
// mergeAllWindows action then skips them; explicitly join only our trusted workspaces.
fn merge_workspaces(app: &AppHandle, host: &NSWindow) {
    let members: Vec<usize> = host
        .tabGroup()
        .map(|group| {
            group
                .windows()
                .iter()
                .map(|window| (&*window as *const NSWindow) as usize)
                .collect()
        })
        .unwrap_or_default();
    let ordered = crate::workspace_session::snapshot(app)
        .groups
        .into_iter()
        .flat_map(|group| group.tabs)
        .map(|tab| tab.label)
        .collect::<Vec<_>>();
    let mut anchor = members
        .last()
        .copied()
        .unwrap_or(host as *const NSWindow as usize);
    for label in ordered {
        let Some(window) = app.get_window(&label) else {
            continue;
        };
        let Ok(ptr) = window.ns_window() else {
            continue;
        };
        if members.contains(&(ptr as usize)) {
            continue;
        }
        let window = unsafe { &*ptr.cast::<NSWindow>() };
        if !window.isVisible() {
            continue;
        }
        window.setTabbingMode(NSWindowTabbingMode::Automatic);
        let previous = unsafe { &*(anchor as *const NSWindow) };
        previous.addTabbedWindow_ordered(window, NSWindowOrderingMode::Above);
        anchor = ptr as usize;
    }
    if let Some(group) = host.tabGroup() {
        group.setSelectedWindow(Some(host));
    }
    host.makeKeyWindow();
}

// Save/restore OUTER native frames after joining. Restoring a tabbed window's
// inner size as a standalone window would subtract the tab bar on every launch.
pub(crate) fn restore_geometry(
    app: &AppHandle,
    label: &str,
    frame: Option<[f64; 4]>,
    fullscreen: bool,
) {
    let app = app.clone();
    let label = label.to_string();
    defer(move || {
        use objc2_app_kit::NSWindowStyleMask;
        use objc2_core_foundation::{CGPoint, CGRect, CGSize};
        let Some(window) = app.get_window(&label) else {
            return;
        };
        let Ok(ptr) = window.ns_window() else {
            return;
        };
        let native = unsafe { &*ptr.cast::<NSWindow>() };
        let selected = native.tabGroup().and_then(|group| group.selectedWindow());
        let native = selected.as_deref().unwrap_or(native);
        if let Some([x, y, width, height]) = frame {
            let rect = CGRect::new(CGPoint::new(x, y), CGSize::new(width, height));
            let rect = native.constrainFrameRect_toScreen(rect, native.screen().as_deref());
            native.setFrame_display(rect, true);
        }
        if fullscreen && !native.styleMask().contains(NSWindowStyleMask::FullScreen) {
            native.toggleFullScreen(None);
        }
    });
}
