//! Bounded, request-scoped flushes. All windows answer a quit; one answers a close.
//! A duplicate or late answer cannot release another window or a newer request.
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use tauri::{AppHandle, Emitter, Manager, Webview};

#[derive(Default)]
pub(crate) struct FrontendFlush {
    sequence: AtomicU64,
    requests: Mutex<HashMap<u64, Arc<Ack>>>,
}

#[derive(Default)]
struct Ack {
    pending: Mutex<HashSet<String>>,
    changed: Condvar,
}
impl Ack {
    fn answer(&self, label: &str) {
        if self.pending.lock().unwrap().remove(label) {
            self.changed.notify_all();
        }
    }
    fn wait(&self, budget: std::time::Duration) -> bool {
        let guard = self.pending.lock().unwrap();
        let (guard, _) = self
            .changed
            .wait_timeout_while(guard, budget, |pending| !pending.is_empty())
            .unwrap();
        guard.is_empty()
    }
}

pub(crate) fn flush(app: &AppHandle, labels: &[String], discard_workspace: bool) {
    let state = app.state::<FrontendFlush>();
    let request_id = state.sequence.fetch_add(1, Ordering::Relaxed) + 1;
    let ack = Arc::new(Ack {
        pending: Mutex::new(labels.iter().cloned().collect()),
        changed: Condvar::new(),
    });
    state
        .requests
        .lock()
        .unwrap()
        .insert(request_id, ack.clone());
    let payload =
        serde_json::json!({"requestId": request_id, "discardWorkspace": discard_workspace});
    for label in labels {
        if let Err(error) = app.emit_to(label, crate::quit::BEFORE_QUIT_EVENT, &payload) {
            crate::log::logln(format!("workspace flush delivery failed: {error}"));
        }
    }
    let answered = ack.wait(crate::quit::FLUSH_BUDGET);
    state.requests.lock().unwrap().remove(&request_id);
    crate::log::logln(format!(
        "workspace flush {request_id}: {}",
        if answered { "complete" } else { "timed out" }
    ));
}

#[tauri::command]
pub(crate) fn quit_ready(app: AppHandle, caller: Webview, request_id: u64) {
    if crate::workspace_windows::require_workspace(&caller).is_err() {
        return;
    }
    if let Some(ack) = app
        .state::<FrontendFlush>()
        .requests
        .lock()
        .unwrap()
        .get(&request_id)
    {
        ack.answer(caller.label());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_window_must_answer_and_unknown_or_duplicate_answers_do_not_count() {
        let ack = Ack {
            pending: Mutex::new(HashSet::from(["main".into(), "workspace-1".into()])),
            changed: Condvar::new(),
        };
        ack.answer("browser-child");
        ack.answer("main");
        ack.answer("main");
        assert!(!ack.wait(std::time::Duration::from_millis(1)));
        ack.answer("workspace-1");
        assert!(ack.wait(std::time::Duration::from_millis(1)));
    }
    #[test]
    fn a_late_response_cannot_acknowledge_another_request() {
        let state = FrontendFlush::default();
        let old = Arc::new(Ack::default());
        let next = Arc::new(Ack {
            pending: Mutex::new(HashSet::from(["main".into()])),
            changed: Condvar::new(),
        });
        state.requests.lock().unwrap().insert(2, next.clone());
        old.answer("main");
        assert!(!next.wait(std::time::Duration::from_millis(1)));
        assert!(!state.requests.lock().unwrap().contains_key(&1));
    }
}
