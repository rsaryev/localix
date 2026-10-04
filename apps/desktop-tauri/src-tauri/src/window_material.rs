//! The native window material, chosen per appearance.
//!
//! The window is built transparent on macOS and an `NSVisualEffectView` is what backs it. Which
//! material that view uses is not a taste question: the materials are not appearance-neutral, so one
//! choice cannot serve both themes. `HudWindow` is dark — over a light interface it turned the whole
//! app to mud, which is how this module came to exist. `UnderWindowBackground` samples the desktop
//! and reads light in a light appearance, which is what a light theme needs to stay legible.
//!
//! The view follows the window's `effectiveAppearance` on its own, so this is only ever called when
//! the APP's theme changes — at startup, and from the `set_theme` command.

// Only the macOS build chooses a material, so on every other target this module is declared but
// nothing calls it. Without this, `-D warnings` turns that into an error on the Linux CI leg.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

#[cfg(target_os = "macos")]
use tauri::WebviewWindow;

/// Which of the app's two appearances the material must serve.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Appearance {
    Dark,
    Light,
}

impl Appearance {
    /// Parse the string the web side already sends to `set_theme`. `system` resolves earlier, in the
    /// UI, so anything unrecognised means "leave the material alone".
    pub(crate) fn parse(theme: &str) -> Option<Self> {
        match theme {
            "dark" => Some(Self::Dark),
            "light" => Some(Self::Light),
            _ => None,
        }
    }
}

/// Attach (or re-attach) the material for this appearance. Returns what happened, for the log.
///
/// Re-applying is how a theme flip is handled: `window-vibrancy` replaces the effect view rather
/// than stacking another one, so there is nothing to tear down first.
#[cfg(target_os = "macos")]
pub(crate) fn apply(window: &WebviewWindow, appearance: Appearance) -> Result<(), String> {
    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

    let material = match appearance {
        // Dark, and the only dark material that keeps a near-black workspace looking like itself.
        Appearance::Dark => NSVisualEffectMaterial::HudWindow,
        // Samples the desktop and renders LIGHT, which is what lets the light theme be a real
        // light theme: on `HudWindow` (tried while the palette was a dim graphite) a light
        // interface sat on a dark HUD and turned to mud.
        Appearance::Light => NSVisualEffectMaterial::UnderWindowBackground,
    };

    apply_vibrancy(
        window,
        material,
        // `Active`, not `FollowsWindowActiveState`. The latter is the system default and sounds
        // right (dim the blur like native chrome does when a window isn't key) but it stops
        // SAMPLING on deactivate and fills with a flat grey instead — measured by running it, the
        // whole workspace jumped from glass to grey the moment focus left. `Active` was the fix,
        // carried over here from the call site this module now replaces.
        Some(NSVisualEffectState::Active),
        None,
    )
    .map_err(|error| error.to_string())
}

/// Non-macOS keeps an opaque frame, so there is no material to choose.
#[cfg(not(target_os = "macos"))]
pub(crate) fn apply<W>(_window: &W, _appearance: Appearance) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::Appearance;

    #[test]
    fn parses_the_two_appearances_the_ui_sends() {
        assert_eq!(Appearance::parse("dark"), Some(Appearance::Dark));
        assert_eq!(Appearance::parse("light"), Some(Appearance::Light));
    }

    #[test]
    fn anything_else_leaves_the_material_alone() {
        // `system` is resolved in the UI before it reaches the command, so reaching here with it
        // means the caller sent a value this module has no opinion about.
        assert_eq!(Appearance::parse("system"), None);
        assert_eq!(Appearance::parse(""), None);
        assert_eq!(Appearance::parse("Dark"), None);
    }
}
