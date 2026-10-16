//! Suspend across sleep/lock and return quietly after wake. All AppKit work stays on its queue.
use crate::companion::{CompanionState, LABEL};
use objc2::{rc::Retained, runtime::ProtocolObject};
use objc2_app_kit::{
    NSWorkspace, NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification,
    NSWorkspaceActiveSpaceDidChangeNotification, NSWorkspaceDidWakeNotification,
    NSWorkspaceSessionDidBecomeActiveNotification, NSWorkspaceSessionDidResignActiveNotification,
    NSWorkspaceWillSleepNotification,
};
use objc2_foundation::{NSNotification, NSObjectProtocol};
use std::{cell::RefCell, ptr::NonNull, sync::atomic::Ordering};
use tauri::{AppHandle, Emitter, Manager};

type Observer = Retained<ProtocolObject<dyn NSObjectProtocol>>;
thread_local! {
    static OBSERVERS: RefCell<Vec<Observer>> = const { RefCell::new(Vec::new()) };
    static SUSPENSION: RefCell<Suspension> = const { RefCell::new(Suspension { sleeping: false, locked: false }) };
}

#[derive(Default)]
struct Suspension {
    sleeping: bool,
    locked: bool,
}
impl Suspension {
    fn update(&mut self, event: Event) -> bool {
        match event {
            Event::Sleep => self.sleeping = true,
            Event::Wake => self.sleeping = false,
            Event::Lock => self.locked = true,
            Event::Unlock => self.locked = false,
            Event::Space | Event::Accessibility => {}
        }
        self.sleeping || self.locked
    }
}
#[derive(Clone, Copy)]
enum Event {
    Sleep,
    Wake,
    Lock,
    Unlock,
    Space,
    Accessibility,
}

fn handle(app: &AppHandle, event: Event) {
    let state = app.state::<CompanionState>();
    let suspended = SUSPENSION.with_borrow_mut(|reasons| reasons.update(event));
    let was_suspended = state.suspended.swap(suspended, Ordering::AcqRel);
    if suspended {
        crate::companion::collapse(app);
        crate::companion_macos::hide(app);
    } else {
        if matches!(event, Event::Space) {
            crate::companion::collapse(app);
        }
        if let Err(error) = crate::companion_macos::place(app) {
            crate::log::logln(format!("companion lifecycle: {error}"));
        }
        if was_suspended
            && state.visible.load(Ordering::Acquire)
            && crate::prefs::island_enabled(app)
        {
            crate::companion_macos::show(app);
        }
        if let Ok(value) = crate::companion_macos::geometry(app) {
            let _ = app.emit_to(LABEL, "companion-geometry", value);
        }
    }
    crate::companion_pointer::refresh(app);
}

pub(crate) fn install(app: &AppHandle) {
    let center = NSWorkspace::sharedWorkspace().notificationCenter();
    // SAFETY: each name is a public AppKit constant. Retained tokens own the copied blocks;
    // callbacks hop onto the main queue before touching the panel.
    let events = unsafe {
        [
            (NSWorkspaceSessionDidResignActiveNotification, Event::Lock),
            (NSWorkspaceWillSleepNotification, Event::Sleep),
            (NSWorkspaceSessionDidBecomeActiveNotification, Event::Unlock),
            (NSWorkspaceDidWakeNotification, Event::Wake),
            (NSWorkspaceActiveSpaceDidChangeNotification, Event::Space),
            (
                NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification,
                Event::Accessibility,
            ),
        ]
    };
    for (name, event) in events {
        let handle = app.clone();
        let block = block2::RcBlock::new(move |_: NonNull<NSNotification>| {
            let app = handle.clone();
            crate::main_queue::defer(move || self::handle(&app, event));
        });
        let token = unsafe {
            center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block)
        };
        OBSERVERS.with_borrow_mut(|observers| observers.push(token));
    }
}

#[cfg(test)]
mod tests {
    use super::{Event, Suspension};
    #[test]
    fn waking_a_locked_session_keeps_the_island_suspended() {
        let mut reasons = Suspension::default();
        assert!(reasons.update(Event::Lock));
        assert!(reasons.update(Event::Sleep));
        assert!(reasons.update(Event::Wake));
        assert!(reasons.update(Event::Accessibility));
        assert!(!reasons.update(Event::Unlock));
    }
    #[test]
    fn unlocking_before_wake_keeps_the_island_suspended() {
        let mut reasons = Suspension::default();
        assert!(reasons.update(Event::Sleep));
        assert!(reasons.update(Event::Lock));
        assert!(reasons.update(Event::Unlock));
        assert!(!reasons.update(Event::Wake));
    }
}
