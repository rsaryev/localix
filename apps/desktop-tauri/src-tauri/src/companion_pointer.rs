//! Observe outside clicks without swallowing or reposting the user's event.
use crate::companion::{CompanionState, LABEL};
use objc2::{rc::Retained, runtime::AnyObject};
use objc2_app_kit::{NSEvent, NSEventMask};
use std::{
    cell::RefCell,
    ptr::NonNull,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_nspanel::ManagerExt;

static POINTER_INSIDE: AtomicBool = AtomicBool::new(false);
/// Fast enough that the 180 ms hover intent starts on time, slow enough to stay invisible in
/// Activity Monitor.
const SAMPLE_INTERVAL: std::time::Duration = std::time::Duration::from_millis(50);

thread_local! {
    // One companion per process; AppKit monitor tokens live as long as its panel.
    static MONITORS: RefCell<Vec<Retained<AnyObject>>> = const { RefCell::new(Vec::new()) };
}

fn contains_pointer(app: &AppHandle) -> bool {
    let Ok(panel) = app.get_webview_panel(LABEL) else {
        return false;
    };
    let state = app.state::<CompanionState>();
    if !state.visible.load(Ordering::Acquire)
        || state.suspended.load(Ordering::Acquire)
        || !panel.is_visible()
    {
        return false;
    }
    let frame = panel.as_panel().frame();
    let point = NSEvent::mouseLocation();
    // While the size handle is held, the whole canvas keeps the pointer so the drag can leave the
    // silhouette without the panel turning click-through under it.
    let (width, height) = if app
        .state::<CompanionState>()
        .grabbing
        .load(Ordering::Acquire)
    {
        (frame.size.width, frame.size.height)
    } else {
        crate::companion_macos::visible_size(app)
    };
    let left = frame.origin.x + (frame.size.width - width) / 2.0;
    let top = frame.origin.y + frame.size.height;
    if point.x < left || point.x > left + width || point.y < top - height || point.y > top {
        return false;
    }
    if state.grabbing.load(Ordering::Acquire) {
        return true;
    }
    // Transparent bottom corners pass clicks to the application underneath too.
    let radius = state.corner_radius.load(Ordering::Acquire).clamp(
        crate::companion::geometry::RADIUS_RANGE.0,
        crate::companion::geometry::RADIUS_RANGE.1,
    ) as f64;
    let radius = if state.expanded.load(Ordering::Acquire) {
        radius
    } else {
        radius / 3.0
    };
    let radius = radius.min(width / 2.0).min(height);
    let bottom = top - height;
    let center_x = point.x.clamp(left + radius, left + width - radius);
    point.y >= bottom + radius
        || (point.x - center_x).powi(2) + (point.y - bottom - radius).powi(2) <= radius.powi(2)
}

fn outside_click(app: &AppHandle) {
    if app
        .state::<CompanionState>()
        .expanded
        .load(Ordering::Acquire)
        && !contains_pointer(app)
    {
        let handle = app.clone();
        crate::main_queue::defer(move || crate::companion::collapse(&handle));
    }
}

/// Re-evaluate hit testing now, after the silhouette changed under a still pointer.
pub(crate) fn refresh(app: &AppHandle) {
    update_pointer(app);
}

/// The workspace already holds the conversation, so a folded island neither opens on hover nor
/// takes clicks while a workspace window is focused. An open island, the shortcut and the menu-bar
/// item still work.
fn workspace_in_front(app: &AppHandle) -> bool {
    !app.state::<CompanionState>()
        .expanded
        .load(Ordering::Acquire)
        && crate::workspace_windows::views(app)
            .iter()
            .any(|view| view.window().is_focused().unwrap_or(false))
}

fn update_pointer(app: &AppHandle) {
    let Ok(panel) = app.get_webview_panel(LABEL) else {
        return;
    };
    let inside = panel.is_visible() && contains_pointer(app) && !workspace_in_front(app);
    if panel.as_panel().ignoresMouseEvents() == inside {
        panel.set_ignores_mouse_events(!inside);
    }
    if POINTER_INSIDE.swap(inside, Ordering::AcqRel) != inside {
        // WebKit does not reliably synthesize mouseenter after ignoresMouseEvents changes.
        let _ = app.emit_to(LABEL, "companion-pointer", inside);
    }
}

pub(crate) fn install(app: &AppHandle) {
    let mask = NSEventMask::LeftMouseDown
        | NSEventMask::RightMouseDown
        | NSEventMask::OtherMouseDown
        | NSEventMask::MouseMoved
        | NSEventMask::LeftMouseDragged
        | NSEventMask::RightMouseDragged
        | NSEventMask::OtherMouseDragged;
    let global_app = app.clone();
    let global = block2::RcBlock::new(move |event: NonNull<NSEvent>| {
        update_pointer(&global_app);
        // SAFETY: AppKit supplies a valid NSEvent for the duration of this handler.
        if matches!(
            unsafe { event.as_ref() }.r#type(),
            objc2_app_kit::NSEventType::LeftMouseDown
                | objc2_app_kit::NSEventType::RightMouseDown
                | objc2_app_kit::NSEventType::OtherMouseDown
        ) {
            if contains_pointer(&global_app) {
                // Recover a first click that arrived while the transparent panel was passing through.
                crate::companion_macos::focus(&global_app);
                let _ = global_app.emit_to(LABEL, "companion-activate", ());
            } else {
                outside_click(&global_app);
            }
        }
    });
    let local_app = app.clone();
    let local = block2::RcBlock::new(move |event: NonNull<NSEvent>| {
        update_pointer(&local_app);
        // SAFETY: AppKit supplies a valid event; return the same pointer unchanged.
        if matches!(
            unsafe { event.as_ref() }.r#type(),
            objc2_app_kit::NSEventType::LeftMouseDown
                | objc2_app_kit::NSEventType::RightMouseDown
                | objc2_app_kit::NSEventType::OtherMouseDown
        ) {
            if contains_pointer(&local_app) {
                crate::companion_macos::focus(&local_app);
            } else {
                outside_click(&local_app);
            }
        }
        event.as_ptr()
    });
    MONITORS.with_borrow_mut(|monitors| {
        if let Some(token) = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &global) {
            monitors.push(token);
        }
        // SAFETY: the handler returns the same valid event pointer it receives.
        if let Some(token) =
            unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &local) }
        {
            monitors.push(token);
        }
    });
    // Event monitors miss a pointer that rests while the active app swallows mouse-moved events,
    // so a light sampler backs them up. It never touches the main thread while the island is
    // hidden, and at most one sample is queued at a time.
    let handle = app.clone();
    std::thread::spawn(move || {
        let pending = std::sync::Arc::new(AtomicBool::new(false));
        loop {
            std::thread::sleep(SAMPLE_INTERVAL);
            if !handle
                .state::<CompanionState>()
                .visible
                .load(Ordering::Acquire)
                || pending.swap(true, Ordering::AcqRel)
            {
                continue;
            }
            let app = handle.clone();
            let pending = pending.clone();
            crate::main_queue::defer(move || {
                update_pointer(&app);
                pending.store(false, Ordering::Release);
            });
        }
    });
}
