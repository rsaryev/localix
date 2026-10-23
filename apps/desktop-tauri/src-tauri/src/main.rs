// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // A plugin installed as its own app is a clone of this binary; it never starts the shell.
    #[cfg(target_os = "macos")]
    if desktop_tauri_lib::run_mini_app() {
        return;
    }
    #[cfg(target_os = "macos")]
    {
        // Disable macOS press-and-hold character popup, so key repeat works in
        // the terminal and code editor (takes effect on the current launch).
        use objc2::msg_send;
        use objc2_foundation::{ns_string, NSUserDefaults};
        unsafe {
            let defaults = NSUserDefaults::standardUserDefaults();
            let key = ns_string!("ApplePressAndHoldEnabled");
            let _: () = msg_send![&defaults, setBool: false, forKey: key];
        }
    }

    desktop_tauri_lib::run()
}
