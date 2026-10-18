//! Native window groups saved on a clean quit; AppKit is the source of tab order.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]
use serde::{Deserialize, Serialize};

pub(crate) fn valid_label(label: &str) -> bool {
    label == "main"
        || label.strip_prefix("workspace-").is_some_and(|id| {
            id.len() == 16
                && id
                    .bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        })
}

pub(crate) fn valid_route(route: &str) -> bool {
    route.len() <= 2048
        && route.starts_with('/')
        && !route.starts_with("//")
        && !route.chars().any(|ch| ch.is_control())
        && !route.contains(['?', '#', '\\'])
        && (route == "/"
            || route == "/setup"
            || route.starts_with("/project/")
            || route.starts_with("/chat/"))
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct SavedWorkspace {
    pub(crate) label: String,
    pub(crate) route: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct SavedGroup {
    pub(crate) tabs: Vec<SavedWorkspace>,
    pub(crate) selected: usize,
    #[serde(default)]
    pub(crate) frame: Option<[f64; 4]>,
    #[serde(default)]
    pub(crate) fullscreen: bool,
    #[serde(default)]
    pub(crate) hidden: bool,
}
#[derive(Default, Serialize, Deserialize)]
pub(crate) struct SavedSession {
    pub(crate) groups: Vec<SavedGroup>,
    pub(crate) active: Option<String>,
}

/// Legacy sessions never recorded which windows were closed. Retain their content, but
/// foreground only the last active group; explicit visibility in newer sessions is authoritative.
pub(crate) fn decode_session(bytes: &[u8]) -> Option<SavedSession> {
    let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    let legacy: Vec<_> = value
        .get("groups")?
        .as_array()?
        .iter()
        .map(|group| {
            group
                .as_object()
                .is_some_and(|group| !group.contains_key("hidden"))
        })
        .collect();
    let mut session: SavedSession = serde_json::from_value(value).ok()?;
    if legacy.iter().any(|legacy| *legacy) {
        let original_active = session.active.take();
        // Validate identities, routes, selections and geometry before applying the fallback.
        session = session.validated()?;
        let active_group = original_active
            .as_deref()
            .and_then(|active| {
                session
                    .groups
                    .iter()
                    .position(|group| group.tabs.iter().any(|tab| tab.label == active))
            })
            .or_else(|| (!session.groups.is_empty()).then_some(0));
        session.active = active_group.map(|index| {
            let group = &session.groups[index];
            original_active
                .as_ref()
                .filter(|active| group.tabs.iter().any(|tab| &tab.label == *active))
                .cloned()
                .unwrap_or_else(|| group.tabs[group.selected].label.clone())
        });
        for (index, (group, legacy)) in session.groups.iter_mut().zip(legacy).enumerate() {
            if legacy {
                group.hidden = Some(index) != active_group;
            }
        }
    }
    session.validated()
}

impl SavedSession {
    /// AppKit removes ordered-out windows from their group. Retain its pre-hide shape until reopen.
    pub(crate) fn merge_hidden_groups(
        &mut self,
        hidden: &[SavedGroup],
        routes: &std::collections::BTreeMap<String, Option<String>>,
    ) {
        for original in hidden {
            let selected = original.tabs.get(original.selected).map(|tab| &tab.label);
            let tabs: Vec<_> = original
                .tabs
                .iter()
                .filter_map(|tab| {
                    routes.get(&tab.label).map(|route| SavedWorkspace {
                        label: tab.label.clone(),
                        route: route.clone(),
                    })
                })
                .collect();
            if tabs.is_empty() {
                continue;
            }
            self.groups.retain(|group| {
                !group
                    .tabs
                    .iter()
                    .any(|tab| tabs.iter().any(|hidden| hidden.label == tab.label))
            });
            let selected = tabs
                .iter()
                .position(|tab| Some(&tab.label) == selected)
                .unwrap_or(0);
            if self
                .active
                .as_ref()
                .is_some_and(|active| tabs.iter().any(|tab| &tab.label == active))
            {
                self.active = Some(tabs[selected].label.clone());
            }
            self.groups.push(SavedGroup {
                tabs,
                selected,
                frame: original.frame,
                fullscreen: original.fullscreen,
                hidden: true,
            });
        }
    }

    /// Every restored group is a live webview running the whole app, so a closed group survives
    /// only as the Dock-reopen target: one, and only when no window is visible. Sessions saved
    /// before this bound kept every closed group and relaunched a dozen hidden copies.
    pub(crate) fn bounded_hidden(mut self) -> Self {
        if self.groups.iter().any(|group| !group.hidden) {
            self.groups.retain(|group| !group.hidden);
        } else if let Some(keep) = self
            .groups
            .iter()
            .position(|group| {
                group
                    .tabs
                    .iter()
                    .any(|tab| Some(&tab.label) == self.active.as_ref())
            })
            .or_else(|| self.groups.len().checked_sub(1))
        {
            let group = self.groups.swap_remove(keep);
            self.groups = vec![group];
        }
        let active_kept = self.active.as_ref().is_some_and(|active| {
            self.groups
                .iter()
                .any(|group| group.tabs.iter().any(|tab| &tab.label == active))
        });
        if !active_kept {
            self.active = self
                .groups
                .first()
                .map(|group| group.tabs[group.selected].label.clone());
        }
        self
    }

    pub(crate) fn validated(self) -> Option<Self> {
        let mut seen = std::collections::HashSet::new();
        if self.groups.len() > 64 || self.groups.iter().map(|g| g.tabs.len()).sum::<usize>() > 64 {
            return None;
        }
        for group in &self.groups {
            if group.frame.is_some_and(|frame| {
                !frame.iter().all(|v| v.is_finite()) || frame[2] < 900.0 || frame[3] < 600.0
            }) {
                return None;
            }
            if group.tabs.is_empty() || group.selected >= group.tabs.len() {
                return None;
            }
            for tab in &group.tabs {
                if !valid_label(&tab.label)
                    || !seen.insert(tab.label.clone())
                    || tab
                        .route
                        .as_deref()
                        .is_some_and(|route| !valid_route(route))
                {
                    return None;
                }
            }
        }
        if self
            .active
            .as_ref()
            .is_some_and(|active| !seen.contains(active))
        {
            return None;
        }
        Some(self)
    }
    pub(crate) fn route(&self, label: &str) -> Option<&str> {
        self.groups
            .iter()
            .flat_map(|group| &group.tabs)
            .find(|tab| tab.label == label)
            .and_then(|tab| tab.route.as_deref())
    }
}

#[cfg(test)]
#[path = "workspace_session_model_tests.rs"]
mod tests;
