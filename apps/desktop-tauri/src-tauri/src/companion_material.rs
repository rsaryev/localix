//! The workspace's native material, shaped to the island silhouette with the shared motion curve.
use crate::companion::{geometry, CompanionState, LABEL};
use crate::window_material::{Appearance, FRAME_MATERIAL_TAG};
use objc2::rc::Retained;
use objc2_app_kit::{
    NSAnimationContext, NSAppearance, NSAppearanceCustomization, NSAppearanceNameAqua,
    NSAppearanceNameDarkAqua, NSAutoresizingMaskOptions, NSView, NSVisualEffectView, NSWindow,
    NSWorkspace,
};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager};
use tauri_nspanel::ManagerExt;

/// Reuse the workspace material and explicit appearance, preserving a reveal in flight.
pub(crate) fn apply(window: &tauri::Window, appearance: Appearance) -> Result<(), String> {
    let native = unsafe {
        &*window
            .ns_window()
            .map_err(|error| error.to_string())?
            .cast::<NSWindow>()
    };
    let find = || {
        native
            .contentView()
            .and_then(|view| unsafe { view.superview() })
            .and_then(|frame| frame.viewWithTag(FRAME_MATERIAL_TAG))
    };
    if find().is_none() {
        crate::window_material::apply(window, appearance)?;
    }
    let name = unsafe {
        match appearance {
            Appearance::Light => NSAppearanceNameAqua,
            Appearance::Dark => NSAppearanceNameDarkAqua,
        }
    };
    let resolved = NSAppearance::appearanceNamed(name);
    if let Some(view) = find() {
        if let Some(effect) = view.downcast_ref::<NSVisualEffectView>() {
            effect.setMaterial(crate::window_material::material_for(appearance));
            effect.setAppearance(resolved.as_deref());
        }
    }
    Ok(())
}

fn material(app: &AppHandle) -> Option<Retained<NSView>> {
    let panel = app.get_webview_panel(LABEL).ok()?;
    let content = panel.as_panel().contentView()?;
    unsafe { content.superview() }?.viewWithTag(FRAME_MATERIAL_TAG)
}

/// Visible material bounds for the native smoke check.
pub(crate) fn report(app: &AppHandle) -> serde_json::Value {
    match material(app) {
        Some(view) => serde_json::json!({
            "kind": "vibrancy",
            "width": view.frame().size.width,
            "height": view.frame().size.height,
            "alpha": view.alphaValue(),
            "appearance": view.effectiveAppearance().name().to_string(),
        }),
        None => serde_json::Value::Null,
    }
}

/// Shape the material to the visible silhouette, animating with the CSS motion tokens.
pub(crate) fn shape(app: &AppHandle) {
    let Some(view) = material(app) else {
        return;
    };
    let state = app.state::<CompanionState>();
    let expanded = state.expanded.load(Ordering::Acquire);
    let quiet = !expanded && state.quiet.load(Ordering::Acquire);
    let (width, height) = crate::companion_macos::visible_size(app);
    let workspace = NSWorkspace::sharedWorkspace();
    let duration = if workspace.accessibilityDisplayShouldReduceMotion() {
        0.0
    } else {
        state.motion_duration.load(Ordering::Acquire) as f64 / 1000.0
    };
    let (min_radius, max_radius) = geometry::RADIUS_RANGE;
    let radius = state
        .corner_radius
        .load(Ordering::Acquire)
        .clamp(min_radius, max_radius) as f64;
    // The resting cutout uses a third of the open radius, matching the CSS fallback silhouette.
    let radius = if expanded { radius } else { radius / 3.0 };
    let origin = NSPoint::new(
        (geometry::CANVAS_WIDTH - width) / 2.0,
        geometry::CANVAS_HEIGHT - height,
    );
    let rect = NSRect::new(origin, NSSize::new(width, height));
    let alpha = if quiet { 0.0 } else { 1.0 };
    let current_radius = view.layer().map_or(-1.0, |layer| layer.cornerRadius());
    // Intrinsic observers may report again during a reveal. Leave a matching target alone.
    if view.frame() == rect && view.alphaValue() == alpha && current_radius == radius {
        return;
    }
    view.setAutoresizingMask(NSAutoresizingMaskOptions::empty());
    // A fresh material (attached at zero size, or full-canvas by `window_material`) is shaped at
    // once; never animate from an accidental slab.
    let size = view.frame().size;
    let fresh =
        size.width == 0.0 || size == NSSize::new(geometry::CANVAS_WIDTH, geometry::CANVAS_HEIGHT);
    let animate = duration > 0.0 && !fresh;
    NSAnimationContext::beginGrouping();
    let context = NSAnimationContext::currentContext();
    context.setDuration(if animate { duration } else { 0.0 });
    if let Some([x1, y1, x2, y2]) = *state.motion_easing.lock().unwrap() {
        let timing =
            objc2_quartz_core::CAMediaTimingFunction::functionWithControlPoints(x1, y1, x2, y2);
        context.setTimingFunction(Some(&timing));
    }
    context.setAllowsImplicitAnimation(true);
    let target: Retained<NSView> = if animate {
        unsafe { objc2::msg_send![&*view, animator] }
    } else {
        view.clone()
    };
    target.setFrame(rect);
    target.setAlphaValue(alpha);
    view.setWantsLayer(true);
    if let Some(layer) = view.layer() {
        layer.setMaskedCorners(
            objc2_quartz_core::CACornerMask::LayerMinXMinYCorner
                | objc2_quartz_core::CACornerMask::LayerMaxXMinYCorner,
        );
        layer.setCornerRadius(radius);
        layer.setMasksToBounds(true);
    }
    NSAnimationContext::endGrouping();
    // The hit region changed with the silhouette; do not wait for the next pointer sample.
    crate::companion_pointer::refresh(app);
}
