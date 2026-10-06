//! Multiple workspaces receive the same live journal row. Deliver its native banner once.
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub(crate) struct NativeNotifications(Mutex<HashMap<String, Instant>>);
fn claim_at(entries: &mut HashMap<String, Instant>, key: &str, now: Instant) -> bool {
    if key.is_empty() || key.len() > 256 {
        return false;
    }
    entries.retain(|_, when| now.duration_since(*when) < Duration::from_secs(600));
    if entries.contains_key(key) {
        return false;
    }
    if entries.len() >= 512 {
        if let Some(oldest) = entries
            .iter()
            .min_by_key(|(_, when)| *when)
            .map(|(key, _)| key.clone())
        {
            entries.remove(&oldest);
        }
    }
    entries.insert(key.into(), now);
    true
}
pub(crate) fn claim(app: &AppHandle, key: &str) -> bool {
    claim_at(
        &mut app.state::<NativeNotifications>().0.lock().unwrap(),
        key,
        Instant::now(),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn windows_share_one_delivery_but_new_occurrences_can_notify() {
        let mut entries = HashMap::new();
        let now = Instant::now();
        assert!(claim_at(&mut entries, "row:1", now));
        assert!(!claim_at(&mut entries, "row:1", now));
        assert!(claim_at(&mut entries, "row:2", now));
        assert!(claim_at(
            &mut entries,
            "row:1",
            now + Duration::from_secs(601)
        ));
    }
    #[test]
    fn delivery_memory_is_bounded() {
        let mut entries = HashMap::new();
        let now = Instant::now();
        for id in 0..1000 {
            claim_at(&mut entries, &id.to_string(), now);
        }
        assert_eq!(entries.len(), 512);
        assert!(!claim_at(&mut entries, "", now));
    }
}
