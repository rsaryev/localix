//! Moving one work item requires destination acceptance, not merely a new window's first paint.
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::{mpsc, Mutex};
use tauri::{AppHandle, Manager, Webview};

const MAX_PAYLOAD_BYTES: usize = 8 * 1024 * 1024;
#[cfg(target_os = "macos")]
/// How long a source waits for the destination workspace to take a transferred tab.
const TRANSFER_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
/// How long a provisional destination waits for its drag to be accepted or dropped.
///
/// A pending drag expires after [`crate::workspace_drag_state::TTL`] (90 s), and the expiry is what
/// answers this wait with a refusal. Waiting a little longer lets that answer arrive; this timeout
/// only fires when nothing answers at all.
const ACCEPTANCE_WAIT: std::time::Duration = std::time::Duration::from_secs(95);
#[cfg(any(target_os = "macos", test))]
const _: () = assert!(ACCEPTANCE_WAIT.as_secs() > crate::workspace_drag_state::TTL.as_secs());

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransferBootstrap {
    source_window: String,
    payload: Value,
}

struct PendingTransfer {
    bootstrap: TransferBootstrap,
    completion: Option<mpsc::Sender<Result<String, String>>>,
    committed: bool,
    ready: bool,
    acknowledgements: Vec<mpsc::Sender<Result<(), String>>>,
}

#[derive(Default)]
pub(crate) struct WorkspaceTransfers(Mutex<BTreeMap<String, PendingTransfer>>);

impl WorkspaceTransfers {
    #[cfg(any(target_os = "macos", test))]
    pub(crate) fn insert(
        &self,
        destination: String,
        source: String,
        payload: Value,
        completion: Option<mpsc::Sender<Result<String, String>>>,
    ) {
        self.0.lock().unwrap().insert(
            destination,
            PendingTransfer {
                bootstrap: TransferBootstrap {
                    source_window: source,
                    payload,
                },
                committed: completion.is_some(),
                completion,
                ready: false,
                acknowledgements: Vec::new(),
            },
        );
    }

    fn take(&self, destination: &str) -> Option<TransferBootstrap> {
        self.0
            .lock()
            .unwrap()
            .get(destination)
            .map(|entry| entry.bootstrap.clone())
    }

    fn ready(
        &self,
        destination: &str,
    ) -> Result<Option<mpsc::Receiver<Result<(), String>>>, String> {
        let mut entries = self.0.lock().unwrap();
        let pending = entries
            .get_mut(destination)
            .ok_or("No pending transfer for this workspace")?;
        if pending.committed {
            let pending = entries.remove(destination).unwrap();
            Self::complete(pending, destination)?;
            Ok(None)
        } else {
            pending.ready = true;
            let (sender, receiver) = mpsc::channel();
            pending.acknowledgements.push(sender);
            Ok(Some(receiver))
        }
    }

    #[cfg(any(target_os = "macos", test))]
    pub(crate) fn commit(
        &self,
        destination: &str,
    ) -> Result<mpsc::Receiver<Result<String, String>>, String> {
        let mut entries = self.0.lock().unwrap();
        let pending = entries
            .get_mut(destination)
            .ok_or("No pending workspace drag")?;
        if pending.committed {
            return Err("Workspace drag has already committed".into());
        }
        let (sender, receiver) = mpsc::channel();
        pending.committed = true;
        pending.completion = Some(sender);
        if pending.ready {
            let pending = entries.remove(destination).unwrap();
            Self::complete(pending, destination)?;
        }
        Ok(receiver)
    }

    fn complete(pending: PendingTransfer, destination: &str) -> Result<(), String> {
        let delivered = pending
            .completion
            .ok_or("Workspace transfer has not committed")?
            .send(Ok(destination.into()))
            .map_err(|_| "The source workspace no longer awaits this transfer".to_string());
        for sender in pending.acknowledgements {
            let _ = sender.send(delivered.clone());
        }
        delivered
    }

    pub(crate) fn cancel(&self, destination: &str) {
        if let Some(pending) = self.0.lock().unwrap().remove(destination) {
            if let Some(sender) = pending.completion {
                let _ = sender.send(Err("Workspace transfer was cancelled".into()));
            }
            for sender in pending.acknowledgements {
                let _ = sender.send(Err("Workspace drag was cancelled".into()));
            }
        }
    }

    #[cfg(any(target_os = "macos", test))]
    pub(crate) fn cancel_source(&self, source: &str) {
        let destinations: Vec<_> = self
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, pending)| pending.bootstrap.source_window == source)
            .map(|(destination, _)| destination.clone())
            .collect();
        for destination in destinations {
            self.cancel(&destination);
        }
    }
}

pub(crate) fn validate(route: &str, payload: &Value) -> Result<(), String> {
    if !crate::workspace_session::valid_route(route) {
        return Err("Invalid workspace route".into());
    }
    let encoded = serde_json::to_vec(payload).map_err(|error| error.to_string())?;
    if encoded.len() > MAX_PAYLOAD_BYTES {
        return Err("Workspace transfer exceeds the 8 MiB limit".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn workspace_transfer_open(
    app: AppHandle,
    caller: Webview,
    as_tab: bool,
    route: String,
    payload: Value,
) -> Result<String, String> {
    crate::workspace_windows::require_workspace(&caller)?;
    validate(&route, &payload)?;
    #[cfg(target_os = "macos")]
    {
        use std::sync::Arc;
        // The reservation synchronizes timeout cleanup with a deferred creation that may
        // finish late. Its window remains usable, but no stale payload is left to accept.
        #[derive(Default)]
        struct Reservation {
            cancelled: bool,
            destination: Option<String>,
        }
        let reservation = Arc::new(Mutex::new(Reservation::default()));
        let creation = reservation.clone();
        let handle = app.clone();
        let source_window = caller.label().to_string();
        let host = as_tab.then(|| source_window.clone());
        let (completion, outcome) = mpsc::channel();
        crate::macos_tabs::defer(move || {
            if creation.lock().unwrap().cancelled {
                return;
            }
            let destination = match crate::workspace_windows::open(&handle, host, Some(route), None)
            {
                Ok(label) => label,
                Err(error) => {
                    let _ = completion.send(Err(error));
                    return;
                }
            };
            let mut creation = creation.lock().unwrap();
            if creation.cancelled {
                return;
            }
            creation.destination = Some(destination.clone());
            handle.state::<WorkspaceTransfers>().insert(
                destination,
                source_window,
                payload,
                Some(completion),
            );
        });
        tauri::async_runtime::spawn_blocking(move || {
            let result = outcome
                .recv_timeout(TRANSFER_TIMEOUT)
                .map_err(|error| match error {
                    mpsc::RecvTimeoutError::Timeout => "Workspace transfer timed out".to_string(),
                    mpsc::RecvTimeoutError::Disconnected => {
                        "Workspace transfer was cancelled".to_string()
                    }
                });
            let mut reservation = reservation.lock().unwrap();
            reservation.cancelled = true;
            if let Some(destination) = reservation.destination.take() {
                app.state::<WorkspaceTransfers>()
                    .0
                    .lock()
                    .unwrap()
                    .remove(&destination);
            }
            result?
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, as_tab);
        Err("Native workspace transfers are available on macOS".into())
    }
}

/// Read repeatedly until accepted, so a failed UI bootstrap can retry without losing the item.
#[tauri::command]
pub(crate) fn workspace_transfer_take(
    app: AppHandle,
    caller: Webview,
) -> Result<Option<TransferBootstrap>, String> {
    crate::workspace_windows::require_workspace(&caller)?;
    Ok(app.state::<WorkspaceTransfers>().take(caller.label()))
}

#[tauri::command]
pub(crate) async fn workspace_transfer_ready(
    app: AppHandle,
    caller: Webview,
) -> Result<(), String> {
    crate::workspace_windows::require_workspace(&caller)?;
    let outcome = app.state::<WorkspaceTransfers>().ready(caller.label())?;
    if let Some(outcome) = outcome {
        crate::round_trip::await_reply(
            outcome,
            ACCEPTANCE_WAIT,
            "Workspace drag acceptance expired",
        )
        .await?
    } else {
        Ok(())
    }
}

#[cfg(target_os = "macos")]
pub(crate) async fn await_outcome(
    app: AppHandle,
    destination: String,
    outcome: mpsc::Receiver<Result<String, String>>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = outcome
            .recv_timeout(TRANSFER_TIMEOUT)
            .map_err(|_| "Workspace transfer timed out".to_string());
        app.state::<WorkspaceTransfers>().cancel(&destination);
        result?
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
#[path = "workspace_transfer_tests.rs"]
mod tests;
