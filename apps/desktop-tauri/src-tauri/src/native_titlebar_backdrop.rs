//! AppKit's Tahoe titlebar can retain a backdrop even when it appears transparent.
//! Follow Ghostty's transparent-titlebar pattern using public NSView/layer operations.
//! The internal class names are a bounded, optional compatibility hook: no match is a no-op.
use objc2::rc::Retained;
use objc2_app_kit::NSView;
use objc2_foundation::NSProcessInfo;

const SEARCH_DEPTH: usize = 8;
const BACKGROUND_VIEW: &str = "NSTitlebarBackgroundView";

fn find(view: &NSView, name: &str, depth: usize) -> Option<Retained<NSView>> {
    if depth == 0 {
        return None;
    }
    let children = view.subviews();
    for child in &children {
        if child.class().name().to_bytes() == name.as_bytes() {
            return Some(child);
        }
    }
    for child in &children {
        if let Some(found) = find(&child, name, depth - 1) {
            return Some(found);
        }
    }
    None
}

fn container(frame: &NSView) -> Option<Retained<NSView>> {
    find(frame, "NSTitlebarContainerView", SEARCH_DEPTH)
}

pub(crate) fn synchronize(frame: &NSView) -> bool {
    // Before Tahoe, AppKit uses another effect hierarchy. Leave it untouched.
    if NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion
        < 26
    {
        return false;
    }
    let Some(container) = container(frame) else {
        return false;
    };
    let Some(background) = find(&container, BACKGROUND_VIEW, SEARCH_DEPTH) else {
        return false;
    };
    // This view holds the system fills, not the titlebar's controls or native tabs.
    background.setHidden(true);
    if let Some(titlebar) = find(&container, "NSTitlebarView", SEARCH_DEPTH) {
        titlebar.setWantsLayer(true);
        if let Some(layer) = titlebar.layer() {
            layer.setBackgroundColor(None);
        }
    }
    true
}

#[cfg(debug_assertions)]
pub(crate) fn status(frame: &NSView) -> (bool, bool) {
    let background = container(frame).and_then(|view| find(&view, BACKGROUND_VIEW, SEARCH_DEPTH));
    (
        background.is_some(),
        background.is_some_and(|view| view.isHidden()),
    )
}

#[cfg(debug_assertions)]
pub(crate) fn debug_views(frame: &NSView) -> Vec<(String, bool)> {
    fn walk(view: &NSView, remaining: usize, out: &mut Vec<(String, bool)>) {
        if remaining == 0 || out.len() >= 80 {
            return;
        }
        let name = view.class().name().to_string_lossy().to_string();
        if name.contains("Titlebar") || name.contains("VisualEffect") || remaining == 12 {
            out.push((name, view.isHidden()));
        }
        for child in view.subviews() {
            walk(&child, remaining - 1, out);
        }
    }
    let mut out = Vec::new();
    walk(frame, 12, &mut out);
    out
}
