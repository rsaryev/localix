use super::{check_script, clip_to_content, css_to_logical, label, page_url};

#[test]
fn scripts_are_capped_at_128_000_bytes() {
    assert!(check_script(&"a".repeat(128_000)).is_ok());
    assert_eq!(
        check_script(&"a".repeat(128_001)),
        Err("Browser script is too large".to_string())
    );
}

#[test]
fn native_frames_are_clipped_to_current_window_content() {
    assert_eq!(
        clip_to_content(-10.0, -20.0, 100.0, 100.0, 800.0, 600.0),
        Some((0.0, 0.0, 90.0, 80.0))
    );
    assert_eq!(
        clip_to_content(750.0, 550.0, 200.0, 200.0, 800.0, 600.0),
        Some((750.0, 550.0, 50.0, 50.0))
    );
    assert_eq!(
        clip_to_content(801.0, 0.0, 100.0, 100.0, 800.0, 600.0),
        None
    );
    assert_eq!(
        clip_to_content(f64::NAN, 0.0, 100.0, 100.0, 800.0, 600.0),
        None
    );
}

#[test]
fn a_measured_pane_is_framed_at_its_zoomed_size() {
    assert_eq!(
        css_to_logical(40.0, 80.0, 400.0, 300.0, 1.25),
        (50.0, 100.0, 500.0, 375.0)
    );
    assert_eq!(
        css_to_logical(40.0, 80.0, 400.0, 300.0, 1.0),
        (40.0, 80.0, 400.0, 300.0)
    );
    // A corrupt zoom must not collapse or explode the frame.
    assert_eq!(
        css_to_logical(1.0, 2.0, 3.0, 4.0, 0.0),
        (1.0, 2.0, 3.0, 4.0)
    );
    assert_eq!(
        css_to_logical(1.0, 2.0, 3.0, 4.0, f64::NAN),
        (1.0, 2.0, 3.0, 4.0)
    );
}

#[test]
fn native_tab_ids_are_opaque_and_safe_as_labels() {
    assert!(label("550e8400-e29b-41d4-a716-446655440000").is_ok());
    assert!(label("https://example.com").is_err());
}

#[test]
fn browser_navigation_rejects_local_and_app_schemes() {
    assert!(page_url("https://example.com/a").is_ok());
    assert!(page_url("file:///private/key").is_err());
    assert!(page_url("tauri://localhost/").is_err());
}

/// On Windows the packaged app is served at http(s)://tauri.localhost; a page there would run
/// with the app's origin, which the API and Tauri IPC trust.
#[test]
fn browser_navigation_rejects_the_packaged_app_origin() {
    assert!(page_url("http://tauri.localhost/").is_err());
    assert!(page_url("https://tauri.localhost/").is_err());
    assert!(page_url("http://TAURI.localhost:8080/index.html").is_err());
    assert!(page_url("http://tauri.localhost./").is_err());
    assert!(page_url("https://nottauri.localhost/").is_ok());
    assert!(super::navigable(&super::Url::parse("about:blank").unwrap()));
    assert!(super::navigable(
        &super::Url::parse("https://example.com/").unwrap()
    ));
    assert!(!super::navigable(
        &super::Url::parse("http://tauri.localhost/").unwrap()
    ));
    assert!(!super::navigable(
        &super::Url::parse("https://tauri.localhost/").unwrap()
    ));
}

/// The tokens sites sniff for must be present, or they serve the page to an unknown browser.
#[cfg(target_os = "macos")]
#[test]
fn pages_introduce_themselves_as_the_installed_safari() {
    let agent = super::safari_user_agent();
    assert!(agent.starts_with("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "));
    assert!(agent.contains("AppleWebKit/605.1.15 (KHTML, like Gecko) Version/"));
    assert!(agent.ends_with(" Safari/605.1.15"));
}
