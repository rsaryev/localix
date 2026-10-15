//! A page outlives renderer eviction, but an old renderer never controls its replacement.
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;

#[derive(Default)]
struct Page {
    generation: u64,
    current: Option<String>,
    revoked: BTreeSet<String>,
    closed: bool,
}

#[derive(Default)]
pub(crate) struct NativeBrowserLifecycle(Mutex<BTreeMap<String, Page>>);

impl NativeBrowserLifecycle {
    pub(crate) fn claim(&self, label: &str, lease: Option<&str>) -> bool {
        let mut pages = self.0.lock().unwrap();
        let page = pages.entry(label.into()).or_default();
        if let Some(lease) = lease {
            let generation = generation_of(lease);
            if let Some(generation) = generation {
                if generation < page.generation {
                    page.revoked.insert(lease.into());
                    return false;
                }
                page.generation = generation;
            }
            if page.revoked.contains(lease) {
                return false;
            }
            if let Some(previous) = page.current.replace(lease.into()) {
                if previous != lease {
                    page.revoked.insert(previous);
                }
            }
        }
        page.closed = false;
        true
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn lease(&self, label: &str) -> Option<String> {
        self.0.lock().unwrap().get(label)?.current.clone()
    }

    pub(crate) fn accepts(&self, label: &str, lease: Option<&str>) -> bool {
        let pages = self.0.lock().unwrap();
        match pages.get(label) {
            Some(page) => {
                !page.closed && lease.is_none_or(|lease| page.current.as_deref() == Some(lease))
            }
            None => lease.is_none(),
        }
    }

    pub(crate) fn release(&self, label: &str, lease: &str) -> bool {
        let mut pages = self.0.lock().unwrap();
        let page = pages.entry(label.into()).or_default();
        page.revoked.insert(lease.into());
        if page.current.as_deref() != Some(lease) {
            return false;
        }
        page.current = None;
        page.closed = true;
        true
    }

    pub(crate) fn close(&self, label: &str, lease: Option<&str>) -> bool {
        let mut pages = self.0.lock().unwrap();
        let page = pages.entry(label.into()).or_default();
        if let Some(lease) = lease {
            page.revoked.insert(lease.into());
            if let Some(generation) = generation_of(lease) {
                if generation < page.generation {
                    return false;
                }
                page.generation = generation;
            }
            // A close for an evicted renderer must not destroy a subsequently reopened page.
            if page
                .current
                .as_deref()
                .is_some_and(|current| current != lease && generation_of(lease).is_none())
            {
                return false;
            }
        }
        if let Some(current) = page.current.take() {
            page.revoked.insert(current);
        }
        page.closed = true;
        true
    }

    pub(crate) fn forget_owner(&self, owner: &str) {
        let prefix = format!("browser-{owner}--");
        self.0
            .lock()
            .unwrap()
            .retain(|label, _| !label.starts_with(&prefix));
    }
}

fn generation_of(lease: &str) -> Option<u64> {
    lease.split('-').next()?.parse().ok()
}

pub(crate) fn validate_lease(lease: Option<&str>) -> Result<(), String> {
    if lease.is_some_and(|lease| {
        lease.len() < 8
            || lease.len() > 80
            || !lease
                .bytes()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == b'-')
    }) {
        Err("Invalid browser renderer lease".into())
    } else {
        Ok(())
    }
}

/// Upper bound for one native browser create, bounds or retire hop on the main thread.
#[cfg(target_os = "macos")]
const UI_OPERATION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// Serialize AppKit creation, bounds and retirement outside Tao's non-reentrant callbacks.
pub(crate) async fn on_ui<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    #[cfg(target_os = "macos")]
    {
        crate::round_trip::run_on_main(
            UI_OPERATION_TIMEOUT,
            "Browser lifecycle operation timed out",
            work,
        )
        .await?
    }
    #[cfg(not(target_os = "macos"))]
    {
        work()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const PAGE: &str = "browser-main--page-1234";

    #[test]
    fn late_open_after_logical_close_cannot_recreate_the_page() {
        let pages = NativeBrowserLifecycle::default();
        assert!(pages.close(PAGE, Some("lease-first")));
        assert!(!pages.claim(PAGE, Some("lease-first")));
        assert!(!pages.accepts(PAGE, Some("lease-first")));
        assert!(pages.claim(PAGE, Some("lease-second")));
    }

    #[test]
    fn old_bounds_and_teardown_never_hide_or_close_a_remounted_page() {
        let pages = NativeBrowserLifecycle::default();
        assert!(pages.claim(PAGE, Some("lease-first")));
        assert!(pages.claim(PAGE, Some("lease-second")));
        assert!(!pages.accepts(PAGE, Some("lease-first")));
        assert!(!pages.release(PAGE, "lease-first"));
        assert!(!pages.close(PAGE, Some("lease-first")));
        assert!(pages.accepts(PAGE, Some("lease-second")));
    }

    #[test]
    fn eviction_hides_retained_page_until_a_new_renderer_claims_it() {
        let pages = NativeBrowserLifecycle::default();
        pages.claim(PAGE, Some("lease-first"));
        assert!(pages.release(PAGE, "lease-first"));
        assert!(!pages.accepts(PAGE, Some("lease-first")));
        assert!(!pages.claim(PAGE, Some("lease-first")));
        assert!(pages.claim(PAGE, Some("lease-second")));
        assert!(pages.accepts(PAGE, Some("lease-second")));
    }

    #[test]
    fn delayed_first_open_cannot_replace_a_newer_renderer_even_before_release() {
        let pages = NativeBrowserLifecycle::default();
        assert!(pages.claim(PAGE, Some("200-lease-second")));
        assert!(!pages.claim(PAGE, Some("100-lease-first")));
        assert!(!pages.release(PAGE, "100-lease-first"));
        assert!(pages.accepts(PAGE, Some("200-lease-second")));
    }

    #[test]
    fn an_unrendered_page_close_cannot_destroy_a_later_renderer() {
        let pages = NativeBrowserLifecycle::default();
        assert!(pages.claim(PAGE, Some("300-lease-new")));
        assert!(!pages.close(PAGE, Some("200-tombstone-old")));
        assert!(pages.accepts(PAGE, Some("300-lease-new")));
        assert!(pages.close(PAGE, Some("400-tombstone-new")));
        assert!(!pages.claim(PAGE, Some("300-lease-new")));
        assert!(pages.claim(PAGE, Some("500-lease-reopen")));
    }

    #[test]
    fn owner_cleanup_is_scoped_and_leases_are_validated() {
        let pages = NativeBrowserLifecycle::default();
        pages.claim(PAGE, Some("lease-first"));
        pages.claim("browser-other--page-1234", Some("lease-first"));
        pages.forget_owner("main");
        assert!(!pages.accepts(PAGE, Some("lease-first")));
        assert!(pages.accepts("browser-other--page-1234", Some("lease-first")));
        assert!(validate_lease(Some("valid-lease-1234")).is_ok());
        assert!(validate_lease(Some("invalid/lease")).is_err());
    }
}
