fn main() {
    // The updater is compiled in only for a release build. `scripts/run-tauri.mjs --release` sets
    // `LOCALIX_UPDATER_ENABLED=1`; a build from a checkout, a local `tauri build` or a fork leaves
    // it unset and gets an app that cannot check, download or install anything from the official
    // release feed (`updater.rs` reports `UPDATER_ENABLED`, and the page never offers an update).
    println!("cargo:rerun-if-env-changed=LOCALIX_UPDATER_ENABLED");
    println!("cargo:rustc-check-cfg=cfg(localix_updater)");
    if std::env::var("LOCALIX_UPDATER_ENABLED").as_deref() == Ok("1") {
        println!("cargo:rustc-cfg=localix_updater");
    }
    tauri_build::build()
}
