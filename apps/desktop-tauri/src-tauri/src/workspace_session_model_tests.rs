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
        hidden: false,
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
    assert!(session.groups[0].hidden);
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
            hidden: false,
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
                hidden: false,
            }],
            active: None,
        };
        assert!(session.validated().is_none());
    }
}

#[test]
fn legacy_groups_remain_visible_and_new_hidden_groups_keep_content_and_geometry() {
    let mut closed = group(&["main", "workspace-0123456789abcdef"], 1);
    closed.hidden = true;
    let encoded = serde_json::to_value(&closed).unwrap();
    let restored: SavedGroup = serde_json::from_value(encoded.clone()).unwrap();
    assert!(restored.hidden);
    assert_eq!(restored.selected, 1);
    assert_eq!(restored.tabs.len(), 2);
    assert_eq!(restored.frame, closed.frame);
    let mut legacy = encoded;
    legacy.as_object_mut().unwrap().remove("hidden");
    let restored: SavedGroup = serde_json::from_value(legacy).unwrap();
    assert!(!restored.hidden);
}

fn legacy_session(groups: Vec<SavedGroup>, active: Option<String>) -> serde_json::Value {
    let mut value = serde_json::to_value(SavedSession { groups, active }).unwrap();
    for group in value["groups"].as_array_mut().unwrap() {
        group.as_object_mut().unwrap().remove("hidden");
    }
    value
}

#[test]
fn legacy_nine_window_session_restores_one_visible_group_and_keeps_every_resource() {
    let labels: Vec<_> = (0..9)
        .map(|index| format!("workspace-{index:016x}"))
        .collect();
    let mut groups: Vec<_> = labels
        .iter()
        .map(|label| group(&[label.as_str()], 0))
        .collect();
    groups[4].tabs[0].route = Some("/project/preserved".into());
    let value = legacy_session(groups, Some(labels[4].clone()));
    let restored = decode_session(&serde_json::to_vec(&value).unwrap()).unwrap();
    assert_eq!(restored.groups.len(), 9);
    assert_eq!(
        restored.groups.iter().filter(|group| !group.hidden).count(),
        1
    );
    assert!(!restored.groups[4].hidden);
    assert_eq!(restored.active.as_deref(), Some(labels[4].as_str()));
    assert_eq!(restored.route(&labels[4]), Some("/project/preserved"));
    assert!(restored
        .groups
        .iter()
        .all(|group| group.frame == Some([0.0, 0.0, 1280.0, 832.0])));
}

#[test]
fn explicit_visibility_preserves_multiple_open_windows_and_closed_groups() {
    let mut closed = group(&["workspace-0000000000000002"], 0);
    closed.hidden = true;
    let session = SavedSession {
        groups: vec![
            group(&["main"], 0),
            group(&["workspace-0000000000000001"], 0),
            closed,
        ],
        active: Some("main".into()),
    };
    let restored = decode_session(&serde_json::to_vec(&session).unwrap()).unwrap();
    assert_eq!(
        restored
            .groups
            .iter()
            .map(|group| group.hidden)
            .collect::<Vec<_>>(),
        [false, false, true]
    );
}

#[test]
fn unknown_legacy_active_falls_back_to_first_valid_group_selected_tab() {
    let groups = vec![
        group(&["main", "workspace-0000000000000001"], 1),
        group(&["workspace-0000000000000002"], 0),
    ];
    let value = legacy_session(groups, Some("workspace-missing".into()));
    let restored = decode_session(&serde_json::to_vec(&value).unwrap()).unwrap();
    assert_eq!(
        restored.active.as_deref(),
        Some("workspace-0000000000000001")
    );
    assert_eq!(restored.groups[0].selected, 1);
    assert!(!restored.groups[0].hidden);
    assert!(restored.groups[1].hidden);
    let mut corrupt = value;
    corrupt["groups"][0]["tabs"][0]["route"] = serde_json::json!("https://example.com");
    assert!(decode_session(&serde_json::to_vec(&corrupt).unwrap()).is_none());
}
