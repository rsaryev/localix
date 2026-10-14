use super::*;
use serde_json::json;

#[test]
fn validates_route_and_encoded_payload_size() {
    assert!(validate("/project/p1/s1", &json!({ "id": "file:a.ts" })).is_ok());
    for route in ["https://example.com", "//example.com", "/project/p1#evil"] {
        assert!(validate(route, &Value::Null).is_err());
    }
    // JSON adds quotes: validate serialized bytes rather than the inner string length.
    assert!(validate("/", &Value::String("x".repeat(MAX_PAYLOAD_BYTES - 2))).is_ok());
    assert!(validate("/", &Value::String("x".repeat(MAX_PAYLOAD_BYTES - 1))).is_err());
}

#[test]
fn only_the_destination_can_read_and_acknowledge() {
    let transfers = WorkspaceTransfers::default();
    let (completion, outcome) = mpsc::channel();
    transfers.0.lock().unwrap().insert(
        "workspace-target".into(),
        PendingTransfer {
            bootstrap: TransferBootstrap {
                source_window: "main".into(),
                payload: json!({ "item": { "id": "terminal:pty-1" } }),
            },
            completion: Some(completion),
            committed: true,
            ready: false,
            acknowledgements: Vec::new(),
        },
    );
    assert!(transfers.take("main").is_none());
    assert!(transfers.ready("main").is_err());
    for _ in 0..2 {
        let bootstrap = transfers.take("workspace-target").unwrap();
        assert_eq!(bootstrap.source_window, "main");
        assert_eq!(bootstrap.payload["item"]["id"], "terminal:pty-1");
    }
    assert!(transfers.ready("workspace-target").unwrap().is_none());
    assert_eq!(outcome.recv().unwrap().unwrap(), "workspace-target");
    assert!(transfers.take("workspace-target").is_none());
    assert!(transfers.ready("workspace-target").is_err());
}

#[test]
fn expired_transfer_cannot_acknowledge_success() {
    let transfers = WorkspaceTransfers::default();
    let (completion, outcome) = mpsc::channel();
    drop(outcome);
    transfers.0.lock().unwrap().insert(
        "workspace-target".into(),
        PendingTransfer {
            bootstrap: TransferBootstrap {
                source_window: "main".into(),
                payload: Value::Null,
            },
            completion: Some(completion),
            committed: true,
            ready: false,
            acknowledgements: Vec::new(),
        },
    );
    assert!(transfers.ready("workspace-target").is_err());
    assert!(transfers.take("workspace-target").is_none());
}

#[test]
fn preview_acceptance_waits_for_commit_and_uses_the_prepared_destination() {
    let transfers = WorkspaceTransfers::default();
    transfers.insert("prepared".into(), "main".into(), Value::Null, None);
    let preview_ack = transfers.ready("prepared").unwrap().unwrap();
    assert!(preview_ack.try_recv().is_err());
    assert!(transfers.take("prepared").is_some());
    let source_ack = transfers.commit("prepared").unwrap();
    assert_eq!(source_ack.recv().unwrap().unwrap(), "prepared");
    preview_ack.recv().unwrap().unwrap();
    assert!(transfers.take("prepared").is_none());
}

#[test]
fn cancelling_a_preview_rejects_early_acceptance_without_source_success() {
    let transfers = WorkspaceTransfers::default();
    transfers.insert("prepared".into(), "main".into(), Value::Null, None);
    let preview_ack = transfers.ready("prepared").unwrap().unwrap();
    transfers.cancel("prepared");
    assert!(preview_ack.recv().unwrap().is_err());
    assert!(transfers.commit("prepared").is_err());
    assert!(transfers.take("prepared").is_none());
}

#[test]
fn source_destruction_rejects_pending_ownership_but_keeps_other_sources() {
    let transfers = WorkspaceTransfers::default();
    transfers.insert("prepared".into(), "main".into(), Value::Null, None);
    transfers.insert(
        "other-target".into(),
        "other-source".into(),
        Value::Null,
        None,
    );
    let source_ack = transfers.commit("prepared").unwrap();
    transfers.cancel_source("main");
    assert!(source_ack.recv().unwrap().is_err());
    assert!(transfers.take("prepared").is_none());
    assert!(transfers.take("other-target").is_some());
}
