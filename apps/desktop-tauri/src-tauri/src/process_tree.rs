//! The API child's whole process tree, not only its first process.
//!
//! `CommandChild::kill` ends bun and nothing under it. Windows has no parent-death signal, so
//! every PTY shell, dev server, language server and MCP server the runtime started outlived a
//! killed or crashed runtime — still holding open the files an update was about to replace, and
//! still bound to their ports on the next launch. A shell that died (release builds abort on
//! panic) left the same orphans behind.
//!
//! On Windows the child is therefore placed in its own Job Object with
//! `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: closing the job handle — dropping [`ProcessTree`], or the
//! shell process ending for any reason — terminates every process still in the job.
//! `JOB_OBJECT_LIMIT_BREAKAWAY_OK` lets a process that explicitly asks for it
//! (`CREATE_BREAKAWAY_FROM_JOB`) leave. The job is per child, deliberately NOT a whole-app job:
//! a job around the shell itself also captures the updater's
//! installer, the opener's browser and every dialog helper, and must be disarmed before each
//! update or it kills the installer it just launched.
//!
//! The child is assigned right after `spawn` returns, so a process it starts before that instant
//! escapes the job. That window is bun's own startup, before `server.js` has run a line.
//!
//! Elsewhere [`ProcessTree`] holds nothing: macOS and Linux keep the existing contract, where the
//! runtime tears down its own children on `shutdown` and exits when its parent pid disappears.

#[cfg(windows)]
use crate::log::logln;

pub(crate) struct ProcessTree {
    #[cfg(windows)]
    _job: Option<std::os::windows::io::OwnedHandle>,
}

impl ProcessTree {
    /// Bind `pid`'s future descendants to this value's lifetime. A failure is logged and yields a
    /// tree that holds nothing — the explicit stop paths still work, so startup must not fail
    /// over a missing reaper.
    pub(crate) fn adopt(pid: u32) -> Self {
        #[cfg(windows)]
        {
            match windows_job::kill_on_close_job(pid) {
                Ok(job) => Self { _job: Some(job) },
                Err(error) => {
                    logln(format!(
                        "process tree: pid {pid} is not in a kill-on-close job ({error})"
                    ));
                    Self { _job: None }
                }
            }
        }
        #[cfg(not(windows))]
        {
            let _ = pid;
            Self {}
        }
    }
}

#[cfg(windows)]
mod windows_job {
    use std::ffi::c_void;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};

    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_BREAKAWAY_OK, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    fn os_error(call: &str) -> String {
        format!("{call}: {}", std::io::Error::last_os_error())
    }

    /// A new job, armed to kill on close, with `pid` assigned to it. The job handle is created
    /// non-inheritable, so the shell holds its only reference.
    pub(super) fn kill_on_close_job(pid: u32) -> Result<OwnedHandle, String> {
        // SAFETY: every handle is checked before use and owned by an `OwnedHandle` immediately,
        // so each is closed exactly once on every path.
        unsafe {
            let raw = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if raw.is_null() {
                return Err(os_error("CreateJobObjectW"));
            }
            let job = OwnedHandle::from_raw_handle(raw);

            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags =
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;
            if SetInformationJobObject(
                job.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast::<c_void>(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) == 0
            {
                return Err(os_error("SetInformationJobObject"));
            }

            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if process.is_null() {
                return Err(os_error("OpenProcess"));
            }
            let process = OwnedHandle::from_raw_handle(process);
            if AssignProcessToJobObject(job.as_raw_handle(), process.as_raw_handle()) == 0 {
                return Err(os_error("AssignProcessToJobObject"));
            }
            Ok(job)
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::ProcessTree;
    use std::time::{Duration, Instant};

    /// Dropping the tree must end the adopted process — the property every stop path relies on.
    #[test]
    fn dropping_the_tree_ends_the_adopted_process() {
        let mut child = std::process::Command::new("cmd")
            .args(["/C", "ping -n 30 127.0.0.1 >NUL"])
            .spawn()
            .expect("cmd starts");
        let tree = ProcessTree::adopt(child.id());
        assert!(tree._job.is_some(), "the child joined a job");
        drop(tree);
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut ended = false;
        while Instant::now() < deadline {
            if child.try_wait().expect("child is waitable").is_some() {
                ended = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        if !ended {
            let _ = child.kill();
        }
        let _ = child.wait();
        assert!(ended, "the adopted process outlived its job");
    }
}
