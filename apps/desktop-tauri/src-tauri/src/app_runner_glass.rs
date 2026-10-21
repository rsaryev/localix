//! A plugin app's window material: the workspace's glass, edge to edge.
//!
//! The same `NSVisualEffectView` the workspace sits on (`window_material.rs`): its material per
//! appearance, `Active` so it keeps sampling the desktop when the window is not key, behind the
//! whole window including the transparent titlebar. The page paints the same coats over it as the
//! workspace does, because it marks itself a macOS desktop page (`shared/lib/pluginApp.ts`).
use objc2::rc::Retained;
use objc2::{MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSAppearanceCustomization, NSAutoresizingMaskOptions, NSView, NSVisualEffectBlendingMode,
    NSVisualEffectState, NSVisualEffectView, NSWindow,
};
use objc2_web_kit::WKWebView;

use crate::window_material::{material_for, Appearance};

/// Make the glass the window's content and place the page in the area below the titlebar, which
/// stays AppKit's: it shows the title and moves the window.
pub(crate) fn attach(
    mtm: MainThreadMarker,
    window: &NSWindow,
    web_view: &WKWebView,
) -> Retained<NSVisualEffectView> {
    let bounds = window
        .contentView()
        .map(|view| view.bounds())
        .unwrap_or_default();
    let glass = NSVisualEffectView::initWithFrame(NSVisualEffectView::alloc(mtm), bounds);
    glass.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
    glass.setState(NSVisualEffectState::Active);
    glass.setMaterial(material_for(system_appearance(window)));
    window.setContentView(Some(&glass));

    // In the glass view's own coordinates; height-sizable keeps the titlebar's margin on top.
    web_view.setFrame(window.contentLayoutRect());
    web_view.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    let page: &NSView = web_view;
    glass.addSubview(page);
    glass
}

/// Follow the page's theme, which can differ from the system's.
pub(crate) fn set_appearance(glass: &NSVisualEffectView, appearance: Appearance) {
    glass.setMaterial(material_for(appearance));
}

/// Before the page says which theme it uses, the system's appearance is the best guess.
fn system_appearance(window: &NSWindow) -> Appearance {
    let name = window.effectiveAppearance().name().to_string();
    if name.contains("Dark") {
        Appearance::Dark
    } else {
        Appearance::Light
    }
}
