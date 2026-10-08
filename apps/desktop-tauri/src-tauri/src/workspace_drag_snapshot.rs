//! Only an explicitly visible dragged pane is eligible for a content snapshot.
use serde::Deserialize;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserSnapshot {
    pub(crate) page_id: String,
    pub(crate) rect: [f64; 4],
}
#[derive(Clone, Deserialize)]
pub(crate) struct DragSnapshot {
    pub(crate) rect: [f64; 4],
    pub(crate) browser: Option<BrowserSnapshot>,
}

fn valid_rect([x, y, width, height]: [f64; 4]) -> bool {
    [x, y, width, height]
        .iter()
        .all(|number| number.is_finite())
        && x >= 0.0
        && y >= 0.0
        && width >= 1.0
        && height >= 1.0
        && x + width <= 20000.0
        && y + height <= 20000.0
}
impl DragSnapshot {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if !valid_rect(self.rect)
            || self.browser.as_ref().is_some_and(|browser| {
                !valid_rect(browser.rect)
                    || browser.page_id.len() > 80
                    || browser.page_id.is_empty()
                    || !browser
                        .page_id
                        .bytes()
                        .all(|ch| ch.is_ascii_alphanumeric() || ch == b'-')
            })
        {
            Err("Invalid workspace drag snapshot".into())
        } else {
            Ok(())
        }
    }
    pub(crate) fn scaled(mut self, zoom: f64) -> Self {
        let zoom = if zoom.is_finite() && zoom > 0.0 {
            zoom
        } else {
            1.0
        };
        for value in &mut self.rect {
            *value *= zoom;
        }
        if let Some(browser) = &mut self.browser {
            for value in &mut browser.rect {
                *value *= zoom;
            }
        }
        self
    }
}

/// Source grab coordinates become coordinates in the aspect-preserving preview pane.
#[derive(Clone, Copy)]
pub(crate) struct PreviewScreen {
    /// AppKit points, independent of a display's backing scale.
    pub(crate) size: [f64; 2],
    pub(crate) expanded: bool,
}

pub(crate) fn preview_geometry(
    rect: [f64; 4],
    anchor: [f64; 2],
    header: f64,
    screen: Option<PreviewScreen>,
) -> ([f64; 2], [f64; 2]) {
    let mut width = rect[2].max(900.0);
    let mut height = (rect[3] + header).max(600.0);
    if let Some(screen) = screen.filter(|screen| {
        screen.size.iter().all(|value| value.is_finite())
            && screen.size[0] >= 320.0
            && screen.size[1] > header
    }) {
        if screen.expanded {
            width = (screen.size[0] / 2.0).max(900.0);
            height = (screen.size[1] / 2.0).max(600.0);
        }
        width = width.min(screen.size[0]);
        height = height.min(screen.size[1]);
    }
    let scale = (width / rect[2]).min((height - header) / rect[3]);
    let mut x = (width - rect[2] * scale) / 2.0 + (anchor[0] - rect[0]) * scale;
    let mut y = header + (height - header - rect[3] * scale) / 2.0 + (anchor[1] - rect[1]) * scale;
    let in_body = anchor[0] >= rect[0]
        && anchor[0] <= rect[0] + rect[2]
        && anchor[1] >= rect[1]
        && anchor[1] <= rect[1] + rect[3];
    if !in_body {
        x = x.clamp(88.0, width - 24.0);
        y = header / 2.0;
    }
    ([width, height], [x, y])
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pane_preview_keeps_its_aspect_and_translates_the_grab_offset() {
        let (size, anchor) =
            preview_geometry([500.0, 100.0, 600.0, 700.0], [520.0, 80.0], 36.0, None);
        assert_eq!(size, [900.0, 736.0]);
        assert_eq!(anchor, [170.0, 18.0]);
    }
    #[test]
    fn snapshot_rejects_nonfinite_or_cross_page_identifiers_and_scales_once() {
        let snapshot = DragSnapshot {
            rect: [10.0, 20.0, 600.0, 400.0],
            browser: None,
        };
        assert!(snapshot.validate().is_ok());
        assert_eq!(
            snapshot.clone().scaled(1.25).rect,
            [12.5, 25.0, 750.0, 500.0]
        );
        let invalid = DragSnapshot {
            rect: [f64::NAN, 20.0, 600.0, 400.0],
            browser: None,
        };
        assert!(invalid.validate().is_err());
        let invalid = DragSnapshot {
            browser: Some(BrowserSnapshot {
                page_id: "../main".into(),
                rect: snapshot.rect,
            }),
            ..snapshot
        };
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn sidebar_grab_stays_on_the_preview_header_instead_of_outside_the_window() {
        let (_, anchor) =
            preview_geometry([420.0, 100.0, 600.0, 700.0], [140.0, 200.0], 36.0, None);
        assert_eq!(anchor, [88.0, 18.0]);
        let (_, anchor) =
            preview_geometry([420.0, 100.0, 600.0, 700.0], [500.0, 300.0], 36.0, None);
        assert_eq!(anchor, [230.0, 236.0]);
    }

    #[test]
    fn fullscreen_preview_uses_half_the_visible_screen_with_workspace_and_screen_bounds() {
        let screen = PreviewScreen {
            size: [2560.0, 1600.0],
            expanded: true,
        };
        let (size, anchor) = preview_geometry(
            [0.0, 72.0, 2560.0, 1528.0],
            [120.0, 50.0],
            36.0,
            Some(screen),
        );
        assert_eq!(size, [1280.0, 800.0]);
        assert_eq!(anchor, [88.0, 18.0]);
        let screen = PreviewScreen {
            size: [1440.0, 850.0],
            expanded: true,
        };
        assert_eq!(
            preview_geometry(
                [0.0, 72.0, 1400.0, 770.0],
                [120.0, 50.0],
                36.0,
                Some(screen)
            )
            .0,
            [900.0, 600.0]
        );
        let screen = PreviewScreen {
            size: [800.0, 500.0],
            expanded: true,
        };
        assert_eq!(
            preview_geometry([0.0, 72.0, 800.0, 420.0], [120.0, 50.0], 36.0, Some(screen)).0,
            [800.0, 500.0]
        );
    }

    #[test]
    fn ordinary_panes_keep_their_size_and_zoom_never_multiplies_retina_screen_points() {
        let screen = PreviewScreen {
            size: [2560.0, 1600.0],
            expanded: false,
        };
        assert_eq!(
            preview_geometry(
                [400.0, 100.0, 1000.0, 700.0],
                [420.0, 80.0],
                36.0,
                Some(screen)
            )
            .0,
            [1000.0, 736.0]
        );
        let rect = DragSnapshot {
            rect: [10.0, 80.0, 2000.0, 1200.0],
            browser: None,
        }
        .scaled(1.25)
        .rect;
        // A Retina display has twice as many physical pixels; AppKit still reports these points.
        let physical = [5120.0, 3200.0];
        let points = [physical[0] / 2.0, physical[1] / 2.0];
        let screen = PreviewScreen {
            size: points,
            expanded: true,
        };
        let measured = preview_geometry(rect, [1012.5, 87.5], 36.0, Some(screen));
        assert_eq!(measured.0, [1280.0, 800.0]);
        assert_eq!(
            measured,
            preview_geometry(
                [12.5, 100.0, 2500.0, 1500.0],
                [1012.5, 87.5],
                36.0,
                Some(screen)
            )
        );
    }
}
