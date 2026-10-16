//! Keep AppKit's real new-tab action and hit target, with the workbench's flat icon treatment.
use objc2::sel;
use objc2_app_kit::{NSButton, NSView};

pub(crate) fn synchronize(frame: &NSView) {
    visit(frame, 12, &mut 160, &mut |button| {
        // Tahoe wraps the public newWindowForTab: action in this AppKit button subclass.
        // Its name is an optional compatibility hook; all changes use public NSButton APIs.
        if button.action() == Some(sel!(newWindowForTab:))
            || button.class().name().to_bytes() == b"NSTabBarNewTabButton"
        {
            button.setBordered(false);
        }
    });
}

fn visit(view: &NSView, depth: usize, remaining: &mut usize, action: &mut impl FnMut(&NSButton)) {
    if depth == 0 || *remaining == 0 {
        return;
    }
    *remaining -= 1;
    for child in view.subviews() {
        if let Ok(button) = child.clone().downcast::<NSButton>() {
            action(&button);
        }
        visit(&child, depth - 1, remaining, action);
    }
}

#[cfg(debug_assertions)]
pub(crate) fn buttons(frame: &NSView) -> Vec<(String, String, bool)> {
    let mut buttons = Vec::new();
    visit(frame, 12, &mut 160, &mut |button| {
        buttons.push((
            button.class().name().to_string_lossy().into_owned(),
            button.action().map_or_else(String::new, |action| {
                action.name().to_string_lossy().into_owned()
            }),
            button.isBordered(),
        ));
    });
    buttons
}
