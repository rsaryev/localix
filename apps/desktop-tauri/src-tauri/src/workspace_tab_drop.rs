//! Decide an outside-window tab destination in one AppKit screen-coordinate space.
use tauri::{AppHandle, Webview};

#[derive(Clone, Copy)]
struct Rect {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

impl Rect {
    fn contains(self, point: (f64, f64)) -> bool {
        point.0 >= self.left
            && point.0 <= self.right
            && point.1 >= self.top
            && point.1 <= self.bottom
    }
}

fn destination(point: (f64, f64), source: Rect, visible: &[Rect]) -> Option<&'static str> {
    if !point.0.is_finite()
        || !point.1.is_finite()
        || visible.iter().any(|rect| rect.contains(point))
    {
        return None;
    }
    if point.1 < source.top {
        Some("tab")
    } else if point.0 < source.left || point.0 > source.right {
        Some("window")
    } else {
        None
    }
}

fn released_destination(
    point: (f64, f64),
    source: Rect,
    visible: &[Rect],
    primary_pressed: bool,
) -> Option<&'static str> {
    // Escape can end WebKit's native drag before mouse-up; that is cancellation, not a drop.
    if primary_pressed {
        None
    } else {
        destination(point, source, visible)
    }
}

fn screen_rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
    // AppKit has a bottom-left origin. Negating y gives the classifier a downward axis
    // without tying the origin to the primary display or applying a display's scale factor.
    Rect {
        left: x,
        top: -(y + height),
        right: x + width,
        bottom: -y,
    }
}

#[cfg(target_os = "macos")]
fn query_destination(
    app: &AppHandle,
    source_window: &tauri::Window,
) -> Result<Option<String>, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSEvent, NSWindow};
    use tauri::Manager;
    let _main_thread =
        MainThreadMarker::new().ok_or("Workspace cursor query must run on the main thread")?;
    let source_ptr = source_window
        .ns_window()
        .map_err(|error| error.to_string())?;
    let source_native = unsafe { &*source_ptr.cast::<NSWindow>() };
    let frame = source_native.frame();
    let source = screen_rect(
        frame.origin.x,
        frame.origin.y,
        frame.size.width,
        frame.size.height,
    );
    let mut visible = Vec::new();
    for window in app.windows().into_values() {
        if !crate::workspace_windows::is_workspace(app, window.label()) {
            continue;
        }
        if app
            .state::<crate::workspace_windows::WorkspaceWindows>()
            .0
            .lock()
            .unwrap()
            .entries
            .get(window.label())
            .is_some_and(|entry| entry.provisional)
        {
            continue;
        }
        let ptr = window.ns_window().map_err(|error| error.to_string())?;
        let native = unsafe { &*ptr.cast::<NSWindow>() };
        if native.isVisible() && !native.isMiniaturized() {
            let frame = native.frame();
            visible.push(screen_rect(
                frame.origin.x,
                frame.origin.y,
                frame.size.width,
                frame.size.height,
            ));
        }
    }
    // Tao 0.35 scales cursor_position with the PRIMARY monitor's DPR, but a window's
    // outer_position/size use its OWN DPR. Comparing those "physical" values misroutes
    // a drag on mixed-DPI displays. AppKit mouseLocation and frames share logical points.
    let cursor = NSEvent::mouseLocation();
    let primary_pressed = NSEvent::pressedMouseButtons() & 1 != 0;
    let target = released_destination((cursor.x, -cursor.y), source, &visible, primary_pressed)
        .map(str::to_string);
    crate::log::logln(format!(
        "workspace tab drag: source={}, cursor=({}, {}), primaryPressed={}, destination={}",
        source_window.label(),
        cursor.x,
        -cursor.y,
        primary_pressed,
        target.as_deref().unwrap_or("none")
    ));
    Ok(target)
}

/// Called only for an uncancelled drag ending outside a DOM drop target.
#[tauri::command]
pub(crate) async fn workspace_tab_drop_destination(
    app: AppHandle,
    caller: Webview,
) -> Result<Option<String>, String> {
    crate::workspace_windows::require_workspace(&caller)?;
    #[cfg(target_os = "macos")]
    {
        let source = caller.window();
        let (sender, outcome) = std::sync::mpsc::channel();
        crate::macos_tabs::defer(move || {
            let _ = sender.send(query_destination(&app, &source));
        });
        tauri::async_runtime::spawn_blocking(move || {
            outcome
                .recv_timeout(std::time::Duration::from_secs(2))
                .map_err(|_| "Workspace cursor query timed out".to_string())?
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Native workspace tab drops are available on macOS".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOURCE: Rect = Rect {
        left: 100.0,
        top: 200.0,
        right: 1100.0,
        bottom: 1000.0,
    };

    #[test]
    fn inside_source_and_bottom_only_do_not_tear_out() {
        for point in [
            (500.0, 500.0),
            (100.0, 200.0),
            (1100.0, 1000.0),
            (500.0, 1200.0),
        ] {
            assert_eq!(destination(point, SOURCE, &[SOURCE]), None);
        }
    }

    #[test]
    fn above_creates_a_native_tab_and_takes_priority_over_sides() {
        for point in [(500.0, 199.0), (0.0, 100.0), (1500.0, 100.0)] {
            assert_eq!(destination(point, SOURCE, &[SOURCE]), Some("tab"));
        }
    }

    #[test]
    fn beyond_side_edges_creates_a_window() {
        for point in [(99.0, 500.0), (1101.0, 500.0), (0.0, 1500.0)] {
            assert_eq!(destination(point, SOURCE, &[SOURCE]), Some("window"));
        }
    }

    #[test]
    fn another_visible_workspace_always_prevents_tearout() {
        let other = Rect {
            left: -500.0,
            top: 0.0,
            right: 50.0,
            bottom: 1600.0,
        };
        for point in [(0.0, 100.0), (0.0, 500.0), (-500.0, 1600.0)] {
            assert_eq!(destination(point, SOURCE, &[SOURCE, other]), None);
        }
    }

    #[test]
    fn invalid_cursor_position_does_not_create_a_window() {
        assert_eq!(destination((f64::NAN, 500.0), SOURCE, &[SOURCE]), None);
        assert_eq!(
            destination((500.0, f64::NEG_INFINITY), SOURCE, &[SOURCE]),
            None
        );
    }

    #[test]
    fn appkit_frames_and_cursor_share_screen_points_without_dpr_conversion() {
        let source = screen_rect(-1200.0, 100.0, 1000.0, 800.0);
        assert_eq!(destination((-700.0, -500.0), source, &[source]), None);
        assert_eq!(
            destination((-700.0, -901.0), source, &[source]),
            Some("tab")
        );
        assert_eq!(
            destination((-1201.0, -500.0), source, &[source]),
            Some("window")
        );
        assert_eq!(destination((-700.0, -99.0), source, &[source]), None);
        let other_display = screen_rect(0.0, -1000.0, 1600.0, 900.0);
        assert_eq!(
            destination((500.0, 500.0), source, &[source, other_display]),
            None
        );
    }

    #[test]
    fn cancelling_the_native_drag_before_mouse_up_never_opens_a_workspace() {
        assert_eq!(
            released_destination((1200.0, 500.0), SOURCE, &[SOURCE], true),
            None
        );
        assert_eq!(
            released_destination((500.0, 100.0), SOURCE, &[SOURCE], true),
            None
        );
        assert_eq!(
            released_destination((1200.0, 500.0), SOURCE, &[SOURCE], false),
            Some("window")
        );
    }
}
