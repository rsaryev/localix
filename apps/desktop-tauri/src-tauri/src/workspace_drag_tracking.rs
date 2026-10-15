//! Native tracking stays live while WebKit's drag session runs its tracking run loop.
use crate::workspace_drag_state::{target, Key, Rect, Target};
use objc2::rc::Retained;
use objc2::Message;
use objc2_app_kit::{
    NSEvent, NSEventTrackingRunLoopMode, NSWindow, NSWindowStyleMask, NSWindowTabbingMode,
};
use objc2_foundation::{NSPoint, NSRunLoop, NSRunLoopCommonModes, NSSize, NSTimer};
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::ptr::NonNull;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

struct Presentation {
    anchor: [f64; 2],
    last_origin: Option<(f64, f64)>,
    visible: bool,
    shown: bool,
}
struct Tracking {
    timer: Retained<NSTimer>,
    presentation: Arc<Mutex<Presentation>>,
}
thread_local! {
    static TIMERS: RefCell<BTreeMap<Key, Tracking>> = const { RefCell::new(BTreeMap::new()) };
}

fn native(app: &AppHandle, label: &str) -> Option<Retained<NSWindow>> {
    let pointer = app.get_window(label)?.ns_window().ok()?;
    let window = unsafe { &*pointer.cast::<NSWindow>() };
    Some(window.retain())
}
fn rect(window: &NSWindow) -> Rect {
    let frame = window.frame();
    Rect {
        left: frame.origin.x,
        top: -(frame.origin.y + frame.size.height),
        right: frame.origin.x + frame.size.width,
        bottom: -frame.origin.y,
    }
}

pub(crate) fn start(
    app: &AppHandle,
    key: Key,
    destination: String,
    anchor: Option<[f64; 2]>,
    snapshot_rect: Option<[f64; 4]>,
) -> Result<(), String> {
    let window = native(app, &destination).ok_or("Prepared workspace disappeared")?;
    let source = native(app, &key.0).ok_or("Source workspace disappeared")?;
    let source_frame = source.frame();
    window.setFrame_display(source_frame, false);
    window.setIgnoresMouseEvents(true);
    window.setTabbingMode(NSWindowTabbingMode::Disallowed);
    let cursor = NSEvent::mouseLocation();
    let mut anchor = anchor.unwrap_or([
        cursor.x - source_frame.origin.x,
        source_frame.origin.y + source_frame.size.height - cursor.y,
    ]);
    let screen = source.screen().map(|screen| {
        let visible = screen.visibleFrame();
        crate::workspace_drag_snapshot::PreviewScreen {
            size: [visible.size.width, visible.size.height],
            expanded: source.styleMask().contains(NSWindowStyleMask::FullScreen)
                || source.isZoomed(),
        }
    });
    if let Some(rect) = snapshot_rect {
        let (size, grabbed) =
            crate::workspace_drag_snapshot::preview_geometry(rect, anchor, 36.0, screen);
        let mut frame = window.frame();
        frame.size = NSSize::new(size[0], size[1]);
        window.setFrame_display(frame, false);
        anchor = grabbed;
    } else {
        let (size, grabbed) = crate::workspace_drag_snapshot::preview_geometry(
            [0.0, 36.0, 900.0, 564.0],
            [anchor[0], 0.0],
            36.0,
            screen,
        );
        let mut frame = window.frame();
        frame.size = NSSize::new(size[0], size[1]);
        window.setFrame_display(frame, false);
        anchor = grabbed;
    }
    let presentation = Arc::new(Mutex::new(Presentation {
        anchor,
        last_origin: None,
        visible: false,
        shown: false,
    }));
    let state = presentation.clone();
    let app = app.clone();
    let callback_key = key.clone();
    let previous = RefCell::new(None::<Target>);
    let block = block2::RcBlock::new(move |timer: NonNull<NSTimer>| {
        let Some(source) = native(&app, &callback_key.0) else {
            unsafe { timer.as_ref().invalidate() };
            return;
        };
        let Some(preview) = native(&app, &destination) else {
            unsafe { timer.as_ref().invalidate() };
            return;
        };
        let labels: Vec<_> = crate::workspace_windows::workspaces(&app)
            .entries
            .iter()
            .filter(|(label, entry)| {
                label.as_str() != callback_key.0
                    && label.as_str() != destination
                    && !entry.provisional
            })
            .map(|(label, _)| label.clone())
            .collect();
        let others: Vec<_> = labels
            .iter()
            .filter_map(|label| native(&app, label))
            .filter(|window| window.isVisible() && !window.isMiniaturized())
            .map(|window| rect(&window))
            .collect();
        let cursor = NSEvent::mouseLocation();
        let next = target(
            (cursor.x, -cursor.y),
            rect(&source),
            &others,
            *previous.borrow(),
        );
        *previous.borrow_mut() = next;
        let ready = crate::workspace_windows::workspaces(&app)
            .entries
            .get(&destination)
            .is_some_and(|entry| entry.ready && entry.transfer_presented);
        let held = NSEvent::pressedMouseButtons() & 1 != 0;
        let visible =
            (held || next.is_some()) && (ready || crate::workspace_drag_image::has(&destination));
        let (position, visibility_changed) = {
            let mut state = state.lock().unwrap();
            let origin = (
                cursor.x - state.anchor[0],
                cursor.y - preview.frame().size.height + state.anchor[1],
            );
            let position = (state.last_origin != Some(origin)).then_some(origin);
            state.last_origin = Some(origin);
            let changed = state.visible != visible;
            state.visible = visible;
            state.shown |= visible;
            (position, changed)
        };
        // Even hidden previews track position, so returning outside has no stale-frame jump.
        if let Some((x, y)) = position {
            preview.setFrameOrigin(NSPoint::new(x, y));
        }
        if visibility_changed {
            if visible {
                preview.orderFront(None);
            } else {
                preview.orderOut(None);
            }
        }
        if !held {
            // Keep an outside preview in its last frame until commit/cancel. No release flash.
            unsafe { timer.as_ref().invalidate() };
        }
    });
    let timer = unsafe { NSTimer::timerWithTimeInterval_repeats_block(1.0 / 60.0, true, &block) };
    unsafe {
        let loop_ = NSRunLoop::mainRunLoop();
        loop_.addTimer_forMode(&timer, NSRunLoopCommonModes);
        loop_.addTimer_forMode(&timer, NSEventTrackingRunLoopMode);
    }
    TIMERS.with(|timers| {
        timers.borrow_mut().insert(
            key,
            Tracking {
                timer,
                presentation,
            },
        )
    });
    Ok(())
}

pub(crate) fn stop(key: &Key) -> Option<([f64; 2], bool)> {
    TIMERS.with(|timers| {
        timers.borrow_mut().remove(key).map(|tracking| {
            tracking.timer.invalidate();
            let state = tracking.presentation.lock().unwrap();
            (state.anchor, state.shown)
        })
    })
}

pub(crate) fn interactive(app: &AppHandle, destination: &str, placement: Option<([f64; 2], bool)>) {
    if let Some(window) = native(app, destination) {
        if let Some((anchor, false)) = placement {
            let cursor = NSEvent::mouseLocation();
            window.setFrameOrigin(NSPoint::new(
                cursor.x - anchor[0],
                cursor.y - window.frame().size.height + anchor[1],
            ));
        }
        window.setIgnoresMouseEvents(false);
    }
}
