//! The system's Reduce transparency, told to the page.
//!
//! WKWebView never matches `prefers-reduced-transparency` (probed on macOS 26: neither `reduce` nor
//! `no-preference` matches), so a stylesheet cannot see the setting. The shell reads it from AppKit
//! and stamps `data-reduce-transparency` on `<html>`; the kit's opaque fallbacks key off that
//! attribute (`packages/kit/styles/window-material.css`). Increase contrast counts too: macOS turns
//! Reduce transparency on with it, and both ask for a solid window.
//!
//! Stamped twice: by an initialization script, so the first paint is already right, and whenever a
//! workspace becomes key, which is the first moment after the person changed it in System Settings.

// Only the macOS build reads the setting; elsewhere the page mirrors the engine's media query.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

/// A script that sets or clears the attribute, before or after the document element exists.
pub(crate) fn stamp_script(reduce: bool) -> String {
    let write = if reduce {
        "r.dataset.reduceTransparency='true'"
    } else {
        "delete r.dataset.reduceTransparency"
    };
    format!(
        "(()=>{{const s=()=>{{const r=document.documentElement;{write};}};if(document.documentElement)s();else document.addEventListener('DOMContentLoaded',s,{{once:true}});}})();"
    )
}

/// The current setting, as the script that tells the page.
#[cfg(target_os = "macos")]
pub(crate) fn script() -> String {
    let workspace = objc2_app_kit::NSWorkspace::sharedWorkspace();
    stamp_script(
        workspace.accessibilityDisplayShouldReduceTransparency()
            || workspace.accessibilityDisplayShouldIncreaseContrast(),
    )
}

#[cfg(test)]
mod tests {
    use super::stamp_script;

    #[test]
    fn the_setting_on_stamps_the_attribute() {
        let script = stamp_script(true);
        assert!(script.contains("r.dataset.reduceTransparency='true'"));
        assert!(!script.contains("delete"));
    }

    #[test]
    fn the_setting_off_clears_a_stale_stamp() {
        // A window that was stamped while the setting was on must lose it once it is turned off.
        let script = stamp_script(false);
        assert!(script.contains("delete r.dataset.reduceTransparency"));
        assert!(!script.contains("='true'"));
    }

    #[test]
    fn waits_for_the_document_element_when_it_runs_first() {
        assert!(stamp_script(true).contains("DOMContentLoaded"));
    }
}
