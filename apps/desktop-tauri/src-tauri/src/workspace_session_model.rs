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
}
#[derive(Default, Serialize, Deserialize)]
pub(crate) struct SavedSession {
    pub(crate) groups: Vec<SavedGroup>,
    pub(crate) active: Option<String>,
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
            });
        }
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
mod tests {
    use super::*;
    fn group(labels: &[&str], selected: usize) -> SavedGroup {
        SavedGroup {
            tabs: labels
                .iter()
                .map(|label| SavedWorkspace {
                    label: (*label).into(),
                    route: None,
                })
                .collect(),
            selected,
            frame: Some([0.0, 0.0, 1280.0, 832.0]),
            fullscreen: false,
        }
    }

    #[test]
    fn hidden_group_replaces_detached_appkit_stubs_without_losing_order_selection_or_live_routes() {
        let labels = [
            "main",
            "workspace-0123456789abcdef",
            "workspace-fedcba9876543210",
        ];
        let hidden = group(&labels, 1);
        let mut session = SavedSession {
            groups: labels.iter().map(|label| group(&[*label], 0)).collect(),
            active: Some("main".into()),
        };
        let routes = labels
            .iter()
            .map(|label| ((*label).into(), Some("/project/current".into())))
            .collect();
        session.merge_hidden_groups(&[hidden], &routes);
        assert_eq!(session.groups.len(), 1);
        assert_eq!(session.groups[0].selected, 1);
        assert_eq!(session.active.as_deref(), Some(labels[1]));
        assert_eq!(
            session.groups[0]
                .tabs
                .iter()
                .map(|tab| tab.label.as_str())
                .collect::<Vec<_>>(),
            labels
        );
        assert!(session.groups[0]
            .tabs
            .iter()
            .all(|tab| tab.route.as_deref() == Some("/project/current")));
        assert!(session.validated().is_some());
    }

    #[test]
    fn closed_hidden_members_are_not_revived_and_an_empty_group_is_dropped() {
        let hidden = group(&["main", "workspace-0123456789abcdef"], 1);
        let mut session = SavedSession::default();
        session.merge_hidden_groups(
            &[hidden.clone()],
            &std::collections::BTreeMap::from([("main".into(), None)]),
        );
        assert_eq!(session.groups.len(), 1);
        assert_eq!(session.groups[0].tabs.len(), 1);
        assert_eq!(session.groups[0].selected, 0);
        assert!(session.validated().is_some());
        let mut empty = SavedSession::default();
        empty.merge_hidden_groups(&[hidden], &std::collections::BTreeMap::new());
        assert!(empty.groups.is_empty());
    }

    #[test]
    fn only_local_routes_and_generated_workspace_labels_can_be_restored() {
        assert!(valid_label("main"));
        assert!(valid_label("workspace-0123456789abcdef"));
        for label in [
            "browser-12345678",
            "workspace-*",
            "workspace-ABCDEF0123456789",
            "../main",
        ] {
            assert!(!valid_label(label));
        }
        assert!(valid_route("/project/p1/s1/files"));
        for route in [
            "https://example.com",
            "//example.com",
            "/project/p1?prompt=secret",
            "/project/p1\n",
            "/project/p1\\x",
        ] {
            assert!(!valid_route(route));
        }
    }
    #[test]
    fn corrupt_duplicate_or_oversized_groups_are_rejected() {
        let tab = SavedWorkspace {
            label: "main".into(),
            route: Some("/project/p1".into()),
        };
        let make = |tabs, selected| SavedSession {
            groups: vec![SavedGroup {
                tabs,
                selected,
                frame: None,
                fullscreen: false,
            }],
            active: Some("main".into()),
        };
        assert!(make(vec![tab.clone()], 0).validated().is_some());
        assert!(make(vec![tab.clone(), tab.clone()], 0)
            .validated()
            .is_none());
        assert!(make(vec![tab.clone()], 1).validated().is_none());
        assert!(make(vec![tab; 65], 0).validated().is_none());
        assert!(make(vec![], 0).validated().is_none());
    }
    #[test]
    fn invalid_native_frames_are_rejected() {
        for frame in [
            [0.0, 0.0, f64::INFINITY, 600.0],
            [f64::NAN, 0.0, 900.0, 600.0],
            [0.0, 0.0, 899.0, 600.0],
            [0.0, 0.0, 900.0, 599.0],
        ] {
            let session = SavedSession {
                groups: vec![SavedGroup {
                    tabs: vec![SavedWorkspace {
                        label: "main".into(),
                        route: None,
                    }],
                    selected: 0,
                    frame: Some(frame),
                    fullscreen: false,
                }],
                active: None,
            };
            assert!(session.validated().is_none());
        }
    }
}
