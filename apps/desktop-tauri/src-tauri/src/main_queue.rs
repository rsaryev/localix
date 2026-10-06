//! AppKit work must run between Tao callouts, including delayed appearance resyncs.
use std::ffi::c_void;

#[repr(C)]
struct DispatchObject {
    _private: [u8; 0],
}
extern "C" {
    static _dispatch_main_q: DispatchObject;
    fn dispatch_async_f(
        queue: *const DispatchObject,
        context: *mut c_void,
        work: extern "C" fn(*mut c_void),
    );
    fn dispatch_time(when: u64, delta: i64) -> u64;
    fn dispatch_after_f(
        when: u64,
        queue: *const DispatchObject,
        context: *mut c_void,
        work: extern "C" fn(*mut c_void),
    );
}

pub(crate) fn after(delay: std::time::Duration, work: impl FnOnce() + Send + 'static) {
    let work: Box<Box<dyn FnOnce() + Send>> = Box::new(Box::new(work));
    unsafe {
        let deadline = dispatch_time(0, delay.as_nanos().min(i64::MAX as u128) as i64);
        dispatch_after_f(
            deadline,
            &_dispatch_main_q,
            Box::into_raw(work).cast(),
            trampoline,
        );
    }
}
extern "C" fn trampoline(context: *mut c_void) {
    let work = unsafe { Box::from_raw(context.cast::<Box<dyn FnOnce() + Send>>()) };
    work();
}
pub(crate) fn defer(work: impl FnOnce() + Send + 'static) {
    let work: Box<Box<dyn FnOnce() + Send>> = Box::new(Box::new(work));
    unsafe {
        dispatch_async_f(&_dispatch_main_q, Box::into_raw(work).cast(), trampoline);
    }
}
