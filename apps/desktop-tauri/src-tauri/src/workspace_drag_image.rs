//! One permission-free WebKit capture stands in for the transferred UI while it loads.
use crate::workspace_drag_snapshot::DragSnapshot;
use crate::workspace_drag_state::{Key, WorkspaceDrags};
use objc2::{rc::Retained, MainThreadMarker, MainThreadOnly, Message};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSColor, NSCompositingOperation, NSImage, NSImageScaling,
    NSImageView, NSTextField, NSView, NSWindow, NSWindowOrderingMode,
};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
use std::{cell::RefCell, collections::BTreeMap};
use tauri::{AppHandle, Manager};

struct Overlay {
    key: Key,
    view: Retained<NSView>,
    image: Retained<NSImageView>,
    base: Option<Retained<NSImage>>,
    browser: Option<Retained<NSImage>>,
    snapshot: Option<DragSnapshot>,
}
thread_local! { static OVERLAYS: RefCell<BTreeMap<String, Overlay>> = const { RefCell::new(BTreeMap::new()) }; }

pub(crate) fn install(
    app: &AppHandle,
    key: Key,
    destination: &str,
    title: &str,
    snapshot: Option<DragSnapshot>,
) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("Workspace preview requires the main thread")?;
    let window = app
        .get_window(destination)
        .ok_or("Prepared workspace disappeared")?;
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    let native = unsafe { &*pointer.cast::<NSWindow>() };
    let content = native
        .contentView()
        .ok_or("Prepared workspace has no content view")?;
    let bounds = content.bounds();
    let view = NSView::initWithFrame(NSView::alloc(mtm), bounds);
    view.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    view.setWantsLayer(true);
    let dark = crate::prefs::load_theme_is_dark(app) != Some(false);
    let ground = if dark { 0.035 } else { 0.98 };
    if let Some(layer) = view.layer() {
        layer.setBackgroundColor(Some(
            &NSColor::colorWithSRGBRed_green_blue_alpha(ground, ground, ground, 1.0).CGColor(),
        ));
    }
    let title = title.chars().take(180).collect::<String>();
    let label = NSTextField::labelWithString(&NSString::from_str(&title), mtm);
    label.setFrame(NSRect::new(
        NSPoint::new(88.0, bounds.size.height - 30.0),
        NSSize::new((bounds.size.width - 112.0).max(1.0), 22.0),
    ));
    label.setTextColor(Some(&NSColor::colorWithSRGBRed_green_blue_alpha(
        if dark { 0.85 } else { 0.12 },
        if dark { 0.85 } else { 0.12 },
        if dark { 0.85 } else { 0.12 },
        1.0,
    )));
    label.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewMinYMargin,
    );
    view.addSubview(&label);
    let image = NSImageView::initWithFrame(
        NSImageView::alloc(mtm),
        NSRect::new(
            NSPoint::new(0.0, 0.0),
            NSSize::new(bounds.size.width, (bounds.size.height - 36.0).max(1.0)),
        ),
    );
    image.setImageScaling(NSImageScaling::ScaleProportionallyUpOrDown);
    image.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    view.addSubview(&image);
    content.addSubview_positioned_relativeTo(&view, NSWindowOrderingMode::Above, None);
    OVERLAYS.with(|overlays| {
        overlays.borrow_mut().insert(
            destination.into(),
            Overlay {
                key: key.clone(),
                view,
                image,
                base: None,
                browser: None,
                snapshot: snapshot.clone(),
            },
        )
    });
    if let Some(snapshot) = snapshot {
        crate::workspace_drag_capture::start(
            app,
            &key,
            destination,
            key.0.clone(),
            Some(snapshot.rect),
            false,
            None,
        );
        if let Some(browser) = snapshot.browser {
            let label = crate::native_browser::page_label(&key.0, &browser.page_id)?;
            let lease = app
                .state::<crate::native_browser_lifecycle::NativeBrowserLifecycle>()
                .lease(&label);
            crate::workspace_drag_capture::start(app, &key, destination, label, None, true, lease);
        }
    }
    Ok(())
}

pub(crate) fn accepts(app: &AppHandle, key: &Key, destination: &str) -> bool {
    app.state::<WorkspaceDrags>()
        .accepts_snapshot(key, destination)
        && crate::workspace_windows::workspaces(app)
            .entries
            .get(destination)
            .is_some_and(|entry| !entry.transfer_presented && !entry.closing && !entry.hidden)
}
pub(crate) fn has(destination: &str) -> bool {
    OVERLAYS.with(|overlays| overlays.borrow().contains_key(destination))
}
pub(crate) fn remove(destination: &str) {
    OVERLAYS.with(|overlays| {
        if let Some(overlay) = overlays.borrow_mut().remove(destination) {
            overlay.view.removeFromSuperview();
        }
    });
}
pub(crate) fn raise(destination: &str) {
    OVERLAYS.with(|overlays| {
        if let Some(overlay) = overlays.borrow().get(destination) {
            if let Some(parent) = unsafe { overlay.view.superview() } {
                parent.addSubview_positioned_relativeTo(
                    &overlay.view,
                    NSWindowOrderingMode::Above,
                    None,
                );
            }
        }
    });
}

pub(crate) fn update(
    app: &AppHandle,
    key: &Key,
    destination: &str,
    image: &NSImage,
    browser: bool,
) {
    if !accepts(app, key, destination) {
        return;
    }
    let image = image.retain();
    OVERLAYS.with(|overlays| {
        let mut overlays = overlays.borrow_mut();
        let Some(overlay) = overlays
            .get_mut(destination)
            .filter(|overlay| &overlay.key == key)
        else {
            return;
        };
        if browser {
            overlay.browser = Some(image);
        } else {
            overlay.base = Some(image);
        }
        if let Some(base) = &overlay.base {
            if let (Some(browser), Some(spec)) = (
                &overlay.browser,
                overlay
                    .snapshot
                    .as_ref()
                    .and_then(|snapshot| snapshot.browser.as_ref()),
            ) {
                let bounds = overlay.snapshot.as_ref().unwrap().rect;
                let scale = base.size().width / bounds[2];
                let rect = NSRect::new(
                    NSPoint::new(
                        (spec.rect[0] - bounds[0]) * scale,
                        base.size().height - (spec.rect[1] - bounds[1] + spec.rect[3]) * scale,
                    ),
                    NSSize::new(spec.rect[2] * scale, spec.rect[3] * scale),
                );
                #[allow(deprecated)]
                base.lockFocus();
                browser.drawInRect_fromRect_operation_fraction(
                    rect,
                    NSRect::new(NSPoint::new(0.0, 0.0), browser.size()),
                    NSCompositingOperation::SourceOver,
                    1.0,
                );
                #[allow(deprecated)]
                base.unlockFocus();
            }
            overlay.image.setImage(Some(base));
            NSView::setNeedsDisplay(&overlay.image, true);
        }
    });
}
