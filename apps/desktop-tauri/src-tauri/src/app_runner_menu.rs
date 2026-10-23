//! A standalone mini app's menu bar: the standard macOS menus under the app's own name.
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Sel};
use objc2::{sel, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSApplication, NSEventModifierFlags, NSMenu, NSMenuItem};
use objc2_foundation::NSString;

use crate::app_runner_web::Controller;

/// One row: title, action, key equivalent, extra modifiers beside Command, and whether the
/// controller (rather than the responder chain) handles it. `None` is a separator.
type Row = Option<(String, Sel, &'static str, NSEventModifierFlags, bool)>;

fn row(title: &str, action: Sel, key: &'static str, extra: NSEventModifierFlags) -> Row {
    Some((title.to_string(), action, key, extra, false))
}

fn own(title: &str, action: Sel, key: &'static str, extra: NSEventModifierFlags) -> Row {
    Some((title.to_string(), action, key, extra, true))
}

pub(crate) fn install(
    mtm: MainThreadMarker,
    app: &NSApplication,
    controller: &Controller,
    name: &str,
) {
    let none = NSEventModifierFlags::empty();
    let shift = NSEventModifierFlags::Shift;
    let bar = NSMenu::new(mtm);
    let target: &AnyObject = controller.as_ref();
    let menus: [(&str, Vec<Row>); 4] = [
        (
            name,
            vec![
                row(
                    &format!("About {name}"),
                    sel!(orderFrontStandardAboutPanel:),
                    "",
                    none,
                ),
                None,
                own("Open in Localix", sel!(openInLocalix:), "o", shift),
                None,
                row(&format!("Hide {name}"), sel!(hide:), "h", none),
                row(
                    "Hide Others",
                    sel!(hideOtherApplications:),
                    "h",
                    NSEventModifierFlags::Option,
                ),
                row("Show All", sel!(unhideAllApplications:), "", none),
                None,
                row(&format!("Quit {name}"), sel!(terminate:), "q", none),
            ],
        ),
        (
            "Edit",
            vec![
                row("Undo", sel!(undo:), "z", none),
                row("Redo", sel!(redo:), "z", shift),
                None,
                row("Cut", sel!(cut:), "x", none),
                row("Copy", sel!(copy:), "c", none),
                row("Paste", sel!(paste:), "v", none),
                row("Select All", sel!(selectAll:), "a", none),
            ],
        ),
        (
            "View",
            vec![
                own("Reload", sel!(reloadPage:), "r", none),
                row(
                    "Enter Full Screen",
                    sel!(toggleFullScreen:),
                    "f",
                    NSEventModifierFlags::Control,
                ),
            ],
        ),
        (
            "Window",
            vec![
                row("Minimize", sel!(performMiniaturize:), "m", none),
                row("Zoom", sel!(performZoom:), "", none),
                row("Close", sel!(performClose:), "w", none),
                None,
                row("Bring All to Front", sel!(arrangeInFront:), "", none),
            ],
        ),
    ];
    let mut window_menu = None;
    let last = menus.len() - 1;
    for (index, (title, rows)) in menus.into_iter().enumerate() {
        let menu = submenu(mtm, &bar, title);
        for entry in rows {
            let Some((title, action, key, extra, targeted)) = entry else {
                menu.addItem(&NSMenuItem::separatorItem(mtm));
                continue;
            };
            let item = unsafe {
                NSMenuItem::initWithTitle_action_keyEquivalent(
                    NSMenuItem::alloc(mtm),
                    &NSString::from_str(&title),
                    Some(action),
                    &NSString::from_str(key),
                )
            };
            item.setKeyEquivalentModifierMask(NSEventModifierFlags::Command | extra);
            if targeted {
                unsafe { item.setTarget(Some(target)) };
            }
            menu.addItem(&item);
        }
        // The last menu is Window: AppKit lists the app's windows in it.
        if index == last {
            window_menu = Some(menu);
        }
    }
    app.setMainMenu(Some(&bar));
    app.setWindowsMenu(window_menu.as_deref());
}

fn submenu(mtm: MainThreadMarker, bar: &NSMenu, title: &str) -> Retained<NSMenu> {
    let item = NSMenuItem::new(mtm);
    let menu = NSMenu::initWithTitle(NSMenu::alloc(mtm), &NSString::from_str(title));
    item.setSubmenu(Some(&menu));
    bar.addItem(&item);
    menu
}
