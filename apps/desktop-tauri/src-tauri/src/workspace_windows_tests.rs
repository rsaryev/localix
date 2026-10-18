use super::*;
#[cfg(target_os = "macos")]
#[test]
fn hiding_reserves_the_whole_group_without_removing_workspaces() {
    let mut data = WindowData::default();
    let labels: Vec<String> = ["main", "workspace-1", "workspace-2"]
        .map(String::from)
        .into();
    for label in &labels {
        data.entries.insert(label.clone(), Workspace::default());
    }
    data.active = Some(labels[1].clone());
    assert!(data.reserve_hide(&labels));
    assert_eq!(data.entries.len(), 3);
    assert_eq!(data.active.as_deref(), Some("workspace-1"));
    assert!(data
        .entries
        .values()
        .all(|entry| entry.hiding && !entry.closing));
    assert!(!data.reserve_hide(&labels));
    assert_eq!(data.reserve_close("main"), None);
}

#[cfg(target_os = "macos")]
#[test]
fn a_missing_or_closing_workspace_rejects_the_hide_without_partial_reservations() {
    let mut data = WindowData::default();
    data.entries.insert("main".into(), Workspace::default());
    assert!(!data.reserve_hide(&[]));
    assert!(!data.reserve_hide(&["main".into(), "missing".into()]));
    assert!(!data.entries["main"].hiding);
    assert_eq!(data.reserve_close("main"), Some(true));
    assert!(!data.reserve_hide(&["main".into()]));
    assert!(!data.entries["main"].hiding);
}
#[test]
fn concurrent_closes_preserve_exactly_one_workspace_and_duplicates_do_not_start_flushes() {
    let mut data = WindowData::default();
    for label in ["main", "workspace-1", "workspace-2"] {
        data.entries.insert(label.into(), Workspace::default());
    }
    assert_eq!(data.reserve_close("main"), Some(false));
    assert_eq!(data.reserve_close("main"), None);
    assert_eq!(data.reserve_close("unknown"), None);
    assert_eq!(data.reserve_close("workspace-1"), Some(false));
    assert_eq!(data.reserve_close("workspace-2"), Some(true));
}

#[test]
fn a_drag_preview_never_turns_the_last_workspace_into_a_destructive_close() {
    let mut data = WindowData::default();
    data.entries.insert("main".into(), Workspace::default());
    data.entries.insert(
        "preview".into(),
        Workspace {
            provisional: true,
            ..Workspace::default()
        },
    );
    assert_eq!(data.reserve_close("main"), Some(true));
}

#[test]
fn a_restored_closed_group_retains_readiness_and_waits_for_explicit_reopen() {
    let mut workspace = Workspace {
        hidden: true,
        ready: true,
        ..Default::default()
    };
    assert!(!workspace.allows_reveal());
    assert!(workspace.ready);
    workspace.hidden = false;
    assert!(workspace.allows_reveal());
    workspace.provisional = true;
    assert!(!workspace.allows_reveal());
    workspace.provisional = false;
    workspace.transfer_pending = true;
    assert!(!workspace.allows_reveal());
    workspace.transfer_pending = false;
    workspace.transfer_presented = true;
    assert!(workspace.allows_reveal());
}

#[cfg(target_os = "macos")]
#[test]
fn closing_a_group_retains_it_only_when_no_other_window_stays_visible() {
    let mut data = WindowData::default();
    let group: Vec<String> = vec!["main".into()];
    data.entries.insert("main".into(), Workspace::default());
    assert!(!data.other_group_visible(&group));
    for (label, entry) in [
        (
            "workspace-1",
            Workspace {
                hidden: true,
                ..Default::default()
            },
        ),
        (
            "workspace-2",
            Workspace {
                provisional: true,
                ..Default::default()
            },
        ),
        (
            "workspace-3",
            Workspace {
                closing: true,
                ..Default::default()
            },
        ),
        (
            "workspace-4",
            Workspace {
                hiding: true,
                ..Default::default()
            },
        ),
    ] {
        data.entries.insert(label.into(), entry);
    }
    assert!(!data.other_group_visible(&group));
    data.entries
        .insert("workspace-5".into(), Workspace::default());
    assert!(data.other_group_visible(&group));
    assert!(!data.other_group_visible(&["main".into(), "workspace-5".into()]));
}

#[test]
fn appkit_focusing_a_sibling_right_after_the_hide_is_not_a_reopen() {
    let just_hidden = Workspace {
        hidden: true,
        hidden_at: Some(std::time::Instant::now()),
        ..Default::default()
    };
    assert!(!just_hidden.focus_can_reopen());
    let long_hidden = Workspace {
        hidden: true,
        hidden_at: std::time::Instant::now().checked_sub(HIDE_FOCUS_ECHO),
        ..Default::default()
    };
    assert!(long_hidden.focus_can_reopen());
    let hiding = Workspace {
        hiding: true,
        ..Default::default()
    };
    assert!(!hiding.focus_can_reopen());
    assert!(Workspace::default().focus_can_reopen());
}
