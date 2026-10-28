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
        std::slice::from_ref(&hidden),
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
fn a_group_without_visibility_is_not_a_session() {
    let mut value = serde_json::to_value(SavedSession {
        groups: vec![group(&["main"], 0)],
        active: None,
    })
    .unwrap();
    value["groups"][0].as_object_mut().unwrap().remove("hidden");
    assert!(decode_session(&serde_json::to_vec(&value).unwrap()).is_none());
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

fn hidden(labels: &[&str]) -> SavedGroup {
    SavedGroup {
        hidden: true,
        ..group(labels, 0)
    }
}

#[test]
fn closed_groups_are_not_relaunched_beside_a_visible_window() {
    let session = SavedSession {
        groups: vec![
            group(&["workspace-0000000000000001"], 0),
            hidden(&["workspace-0000000000000002"]),
            hidden(&["workspace-0000000000000003"]),
        ],
        active: Some("workspace-0000000000000002".into()),
    }
    .bounded_hidden();
    assert_eq!(session.groups.len(), 1);
    assert!(!session.groups[0].hidden);
    assert_eq!(
        session.active.as_deref(),
        Some("workspace-0000000000000001")
    );
    assert!(session.validated().is_some());
}

#[test]
fn with_every_window_closed_only_the_active_group_stays_reopenable() {
    let session = SavedSession {
        groups: (1..=12)
            .map(|index| format!("workspace-{index:016x}"))
            .map(|label| hidden(&[label.as_str()]))
            .collect(),
        active: Some("workspace-0000000000000005".into()),
    }
    .bounded_hidden();
    assert_eq!(session.groups.len(), 1);
    assert!(session.groups[0].hidden);
    assert_eq!(
        session.groups[0].tabs[0].label,
        "workspace-0000000000000005"
    );
    assert_eq!(
        session.active.as_deref(),
        Some("workspace-0000000000000005")
    );

    let fallback = SavedSession {
        groups: vec![
            hidden(&["workspace-0000000000000001"]),
            hidden(&["workspace-0000000000000002"]),
        ],
        active: None,
    }
    .bounded_hidden();
    assert_eq!(fallback.groups.len(), 1);
    assert_eq!(
        fallback.active.as_deref(),
        Some("workspace-0000000000000002")
    );
    assert!(SavedSession::default().bounded_hidden().groups.is_empty());
}
