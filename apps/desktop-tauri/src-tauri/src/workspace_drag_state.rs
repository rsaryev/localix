//! Source-scoped reservations survive cancellation racing a deferred window build.
#[cfg(any(target_os = "macos", test))]
use std::collections::BTreeMap;
#[cfg(any(target_os = "macos", test))]
use std::sync::Mutex;
#[cfg(any(target_os = "macos", test))]
use std::time::{Duration, Instant};

#[cfg(any(target_os = "macos", test))]
pub(crate) const TTL: Duration = Duration::from_secs(90);
#[cfg(any(target_os = "macos", test))]
pub(crate) type Key = (String, String);
#[cfg(any(target_os = "macos", test))]
enum Phase {
    Preparing,
    Preview(String),
    Committed(String),
    Cancelled,
}
#[cfg(any(target_os = "macos", test))]
struct Record {
    phase: Phase,
    expires: Instant,
}
#[cfg(any(target_os = "macos", test))]
#[derive(Default)]
pub(crate) struct WorkspaceDrags(Mutex<BTreeMap<Key, Record>>);

#[cfg(any(target_os = "macos", test))]
impl WorkspaceDrags {
    pub(crate) fn accepts_snapshot(&self, key: &Key, destination: &str) -> bool {
        self.0.lock().unwrap().get(key).is_some_and(|entry| entry.expires > Instant::now() &&
            matches!(&entry.phase, Phase::Preview(label) | Phase::Committed(label) if label == destination))
    }
    #[cfg(target_os = "macos")]
    pub(crate) fn prune(&self) {
        self.0.lock().unwrap().retain(|_, entry| {
            entry.expires > Instant::now()
                || matches!(entry.phase, Phase::Preparing | Phase::Preview(_))
        });
    }
    pub(crate) fn reserve(&self, key: &Key) -> Result<Option<String>, String> {
        let mut entries = self.0.lock().unwrap();
        entries.retain(|_, entry| {
            entry.expires > Instant::now()
                || matches!(entry.phase, Phase::Preparing | Phase::Preview(_))
        });
        if let Some(entry) = entries.get(key) {
            return match &entry.phase {
                Phase::Preview(label) => Ok(Some(label.clone())),
                Phase::Cancelled => Err("Workspace drag was cancelled".into()),
                _ => Err("Workspace drag is already active".into()),
            };
        }
        if entries.len() >= 256 {
            return Err("Too many workspace drag reservations".into());
        }
        entries.insert(
            key.clone(),
            Record {
                phase: Phase::Preparing,
                expires: Instant::now() + TTL,
            },
        );
        Ok(None)
    }

    pub(crate) fn prepared(&self, key: &Key, label: String) -> bool {
        let mut entries = self.0.lock().unwrap();
        let Some(entry) = entries.get_mut(key) else {
            return false;
        };
        if entry.expires <= Instant::now() || !matches!(entry.phase, Phase::Preparing) {
            return false;
        }
        entry.phase = Phase::Preview(label);
        true
    }

    pub(crate) fn commit(&self, key: &Key) -> Result<String, String> {
        let mut entries = self.0.lock().unwrap();
        let entry = entries
            .get_mut(key)
            .ok_or("Workspace drag has not prepared")?;
        if entry.expires <= Instant::now() {
            return Err("Workspace drag expired".into());
        }
        let Phase::Preview(label) = &entry.phase else {
            return Err("Workspace drag cannot commit".into());
        };
        let label = label.clone();
        entry.phase = Phase::Committed(label.clone());
        Ok(label)
    }

    pub(crate) fn cancel(&self, key: &Key) -> Option<String> {
        let mut entries = self.0.lock().unwrap();
        if entries
            .get(key)
            .is_some_and(|entry| matches!(entry.phase, Phase::Committed(_)))
        {
            return None;
        }
        let old = entries.insert(
            key.clone(),
            Record {
                phase: Phase::Cancelled,
                expires: Instant::now() + TTL,
            },
        );
        match old.map(|entry| entry.phase) {
            Some(Phase::Preview(label)) => Some(label),
            _ => None,
        }
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn related(&self, owner: &str) -> Vec<Key> {
        self.0.lock().unwrap().iter().filter(|(key, entry)| key.0 == owner ||
            matches!(&entry.phase, Phase::Preview(label) | Phase::Committed(label) if label == owner))
            .map(|(key, _)| key.clone()).collect()
    }
}

pub(crate) fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 96
        || !id
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, b'-' | b'_'))
    {
        Err("Invalid workspace drag identifier".into())
    } else {
        Ok(())
    }
}

#[cfg(any(target_os = "macos", test))]
#[derive(Clone, Copy)]
pub(crate) struct Rect {
    pub(crate) left: f64,
    pub(crate) top: f64,
    pub(crate) right: f64,
    pub(crate) bottom: f64,
}
#[cfg(any(target_os = "macos", test))]
impl Rect {
    pub(crate) fn contains(self, (x, y): (f64, f64)) -> bool {
        x >= self.left && x <= self.right && y >= self.top && y <= self.bottom
    }
}
#[cfg(any(target_os = "macos", test))]
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Target {
    Window,
    Tab,
}

#[cfg(any(target_os = "macos", test))]
pub(crate) fn target(
    point: (f64, f64),
    source: Rect,
    others: &[Rect],
    previous: Option<Target>,
) -> Option<Target> {
    if !point.0.is_finite()
        || !point.1.is_finite()
        || source.contains(point)
        || others.iter().any(|rect| rect.contains(point))
    {
        return None;
    }
    let margin = if previous.is_some() { 0.0 } else { 16.0 };
    if point.1 < source.top - margin {
        Some(Target::Tab)
    } else if point.0 < source.left - margin || point.0 > source.right + margin {
        Some(Target::Window)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SOURCE: Rect = Rect {
        left: 100.0,
        top: 100.0,
        right: 900.0,
        bottom: 700.0,
    };
    #[test]
    fn preview_uses_threshold_hysteresis_and_hides_on_return() {
        assert_eq!(target((905.0, 200.0), SOURCE, &[], None), None);
        assert_eq!(
            target((920.0, 200.0), SOURCE, &[], None),
            Some(Target::Window)
        );
        assert_eq!(
            target((905.0, 200.0), SOURCE, &[], Some(Target::Window)),
            Some(Target::Window)
        );
        assert_eq!(
            target((899.0, 200.0), SOURCE, &[], Some(Target::Window)),
            None
        );
        assert_eq!(target((500.0, 70.0), SOURCE, &[], None), Some(Target::Tab));
        assert_eq!(target((500.0, 730.0), SOURCE, &[], None), None);
        assert_eq!(
            target(
                (920.0, 200.0),
                SOURCE,
                &[Rect {
                    left: 910.0,
                    right: 1300.0,
                    ..SOURCE
                }],
                Some(Target::Window)
            ),
            None
        );
    }
    #[test]
    fn cancellation_before_prepare_is_source_scoped_and_commit_keeps_the_same_window() {
        let drags = WorkspaceDrags::default();
        let a = ("main".into(), "drag-1".into());
        let b = ("other".into(), "drag-1".into());
        drags.cancel(&a);
        assert!(drags.reserve(&a).is_err());
        assert_eq!(drags.reserve(&b).unwrap(), None);
        assert!(drags.prepared(&b, "destination".into()));
        assert_eq!(drags.reserve(&b).unwrap(), Some("destination".into()));
        assert_eq!(drags.commit(&b).unwrap(), "destination");
        assert_eq!(drags.cancel(&b), None);
        assert!(drags.commit(&b).is_err());
    }
    #[test]
    fn cancelled_build_cannot_publish_and_ids_are_opaque() {
        let drags = WorkspaceDrags::default();
        let key = ("main".into(), "drag-1".into());
        drags.reserve(&key).unwrap();
        drags.cancel(&key);
        assert!(!drags.prepared(&key, "late-destination".into()));
        assert!(validate_id("drag_123-456").is_ok());
        assert!(validate_id("../main").is_err());
    }

    #[test]
    fn expired_preview_rejects_commit_but_remains_available_for_destruction() {
        let drags = WorkspaceDrags::default();
        let key = ("main".into(), "drag-expired".into());
        drags.reserve(&key).unwrap();
        assert!(drags.prepared(&key, "expired-destination".into()));
        drags.0.lock().unwrap().get_mut(&key).unwrap().expires =
            Instant::now() - Duration::from_secs(1);
        assert!(drags.commit(&key).is_err());
        assert_eq!(drags.cancel(&key), Some("expired-destination".into()));
        assert!(drags.reserve(&key).is_err());
    }

    #[test]
    fn cancelled_or_wrong_destination_snapshots_cannot_update_a_new_drag() {
        let drags = WorkspaceDrags::default();
        let key = ("main".into(), "snapshot-1".into());
        drags.reserve(&key).unwrap();
        assert!(!drags.accepts_snapshot(&key, "target"));
        drags.prepared(&key, "target".into());
        assert!(drags.accepts_snapshot(&key, "target"));
        assert!(!drags.accepts_snapshot(&key, "other-target"));
        drags.cancel(&key);
        assert!(!drags.accepts_snapshot(&key, "target"));
        let next = ("main".into(), "snapshot-2".into());
        drags.reserve(&next).unwrap();
        drags.prepared(&next, "next-target".into());
        assert!(!drags.accepts_snapshot(&key, "next-target"));
        assert!(drags.accepts_snapshot(&next, "next-target"));
    }
}
