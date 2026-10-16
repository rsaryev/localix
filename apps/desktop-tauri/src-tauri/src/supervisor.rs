//! Supervision of the API runtime once it is ready: when to start it again, and how to notice one
//! that is still alive but no longer answering.
//!
//! Two gaps this closes, both reproduced against the packaged app:
//!
//! - A runtime that died after `ready` was started again ONCE per shell lifetime. The second
//!   crash, however far from the first, left the window open with no backend until the person
//!   restarted the app by hand. The budget is now a sliding window: a runtime that crashes now and
//!   then keeps coming back, and one that crashes in a loop is given up on.
//! - A runtime that hung (alive, listening, not answering) was never noticed: the shell only
//!   watched for the process to exit, so the page failed every request while the shell reported
//!   nothing. The shell now asks `/health` on a slow beat and treats a long run of silence as a
//!   crash.
//!
//! Everything here is a pure decision or a bounded probe; `sidecar.rs` owns the processes.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::{Duration, Instant, SystemTime};

/// How far back a restart counts against the budget. A runtime that has stayed up for longer than
/// this has earned a fresh budget, which is the stability gate: it needs no timer of its own.
pub(crate) const RESTART_WINDOW: Duration = Duration::from_secs(180);

/// Restarts allowed inside [`RESTART_WINDOW`]. Five steps of the backoff below add up to about 15 s
/// of reconnecting before the shell concludes the runtime cannot stay up and says so.
pub(crate) const MAX_RESTARTS_IN_WINDOW: usize = 5;

const BACKOFF_BASE: Duration = Duration::from_millis(500);
const BACKOFF_CAP: Duration = Duration::from_secs(8);
/// A restart is spread by up to this fraction either way, so nothing that restarts in step with
/// the runtime (a second window, a plugin process) keeps hitting the same instant.
const JITTER: f64 = 0.25;

/// What to do about a runtime that has just died.
#[derive(Debug, PartialEq)]
pub(crate) enum Restart {
    /// Start it again after this pause (long enough for its lease and port to be released).
    After(Duration),
    /// It has crashed too often to be worth another attempt; report it.
    GiveUp,
}

/// Decide, and record the restart when there is one. `history` holds the instants of the restarts
/// inside the window; `jitter` is in `[-1, 1]` and scales [`JITTER`].
pub(crate) fn plan_restart(history: &mut Vec<Instant>, now: Instant, jitter: f64) -> Restart {
    history.retain(|at| now.saturating_duration_since(*at) < RESTART_WINDOW);
    if history.len() >= MAX_RESTARTS_IN_WINDOW {
        return Restart::GiveUp;
    }
    let step = u32::try_from(history.len()).unwrap_or(u32::MAX).min(16);
    history.push(now);
    let base = BACKOFF_BASE
        .checked_mul(1u32 << step)
        .unwrap_or(BACKOFF_CAP)
        .min(BACKOFF_CAP);
    Restart::After(base.mul_f64(1.0 + JITTER * jitter.clamp(-1.0, 1.0)))
}

/// A jitter in `[-1, 1]` from the clock; the restart spread does not need a random generator.
pub(crate) fn clock_jitter() -> f64 {
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.subsec_nanos());
    f64::from(nanos % 2001) / 1000.0 - 1.0
}

/// The gap between probes.
pub(crate) const BEAT: Duration = Duration::from_secs(5);
/// How long one probe may take. A runtime busy for longer than this on a single request is not
/// answering in any sense the page could use.
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);
/// Consecutive silent probes before the runtime is treated as hung: with the beat, about twenty
/// seconds without a single answer, well past any pause a healthy runtime takes.
pub(crate) const STRIKES: u32 = 4;

/// One probe's outcome.
#[derive(Debug, PartialEq, Clone, Copy)]
pub(crate) enum Answer {
    /// Any well-formed answer, including 503 `draining`: a runtime that is shutting down is
    /// answering, and the shell's own stop path owns that case.
    Alive,
    Silent,
}

/// Read the status line of an HTTP response and say whether it is an answer from the runtime.
pub(crate) fn classify(response_head: &str) -> Answer {
    let status = response_head.split_whitespace().nth(1).unwrap_or("");
    if response_head.starts_with("HTTP/1.") && matches!(status, "200" | "503") {
        Answer::Alive
    } else {
        Answer::Silent
    }
}

/// Ask `/health` on the runtime's loopback port, bounded by [`PROBE_TIMEOUT`] end to end for the
/// connect, the write and the read. No HTTP client is involved: the request is one line.
pub(crate) fn probe(port: u16) -> Answer {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, PROBE_TIMEOUT) else {
        return Answer::Silent;
    };
    let _ = stream.set_read_timeout(Some(PROBE_TIMEOUT));
    let _ = stream.set_write_timeout(Some(PROBE_TIMEOUT));
    let request =
        format!("GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return Answer::Silent;
    }
    let mut head = [0u8; 64];
    match stream.read(&mut head) {
        Ok(read) if read > 0 => classify(&String::from_utf8_lossy(&head[..read])),
        _ => Answer::Silent,
    }
}

/// The running count of silent probes. A machine that slept between two beats says nothing about
/// the runtime, so a gap far longer than the beat forgives what came before it.
pub(crate) fn next_strikes(strikes: u32, answer: Answer, since_last_beat: Duration) -> u32 {
    if since_last_beat > BEAT * 3 {
        return 0;
    }
    match answer {
        Answer::Alive => 0,
        Answer::Silent => strikes + 1,
    }
}

/// Whether the run of silence is long enough to call the runtime hung.
pub(crate) fn is_hung(strikes: u32) -> bool {
    strikes >= STRIKES
}

#[cfg(test)]
mod tests {
    use super::*;

    fn start() -> Instant {
        Instant::now()
    }

    #[test]
    fn restarts_back_off_and_double_up_to_a_cap() {
        let mut history = Vec::new();
        let at = start();
        let pauses: Vec<_> = (0..MAX_RESTARTS_IN_WINDOW)
            .map(|_| match plan_restart(&mut history, at, 0.0) {
                Restart::After(pause) => pause,
                Restart::GiveUp => panic!("gave up inside the budget"),
            })
            .collect();
        assert_eq!(
            pauses,
            [500, 1000, 2000, 4000, 8000].map(Duration::from_millis)
        );
    }

    #[test]
    fn the_budget_is_spent_after_five_restarts_inside_the_window() {
        let mut history = Vec::new();
        let at = start();
        for _ in 0..MAX_RESTARTS_IN_WINDOW {
            assert!(matches!(
                plan_restart(&mut history, at, 0.0),
                Restart::After(_)
            ));
        }
        assert_eq!(plan_restart(&mut history, at, 0.0), Restart::GiveUp);
    }

    #[test]
    fn a_runtime_that_stayed_up_gets_its_budget_back() {
        let mut history = Vec::new();
        let at = start();
        for _ in 0..MAX_RESTARTS_IN_WINDOW {
            plan_restart(&mut history, at, 0.0);
        }
        let later = at + RESTART_WINDOW + Duration::from_secs(1);
        assert_eq!(
            plan_restart(&mut history, later, 0.0),
            Restart::After(Duration::from_millis(500)),
            "an old crash is forgotten, so the pause starts over"
        );
        assert_eq!(history.len(), 1);
    }

    #[test]
    fn a_crash_now_and_then_never_exhausts_the_budget() {
        let mut history = Vec::new();
        let mut at = start();
        for _ in 0..50 {
            assert!(matches!(
                plan_restart(&mut history, at, 0.0),
                Restart::After(_)
            ));
            at += RESTART_WINDOW / 2;
        }
    }

    #[test]
    fn jitter_moves_the_pause_by_at_most_a_quarter() {
        let at = start();
        let pause = |jitter| match plan_restart(&mut Vec::new(), at, jitter) {
            Restart::After(pause) => pause,
            Restart::GiveUp => panic!("first restart is always allowed"),
        };
        assert_eq!(pause(1.0), Duration::from_millis(625));
        assert_eq!(pause(-1.0), Duration::from_millis(375));
        // Out-of-range input is clamped, never amplified.
        assert_eq!(pause(50.0), pause(1.0));
        assert!((-1.0..=1.0).contains(&clock_jitter()));
    }

    #[test]
    fn only_a_well_formed_health_answer_counts_as_alive() {
        assert_eq!(classify("HTTP/1.1 200 OK\r\n"), Answer::Alive);
        assert_eq!(
            classify("HTTP/1.1 503 Service Unavailable\r\n"),
            Answer::Alive
        );
        assert_eq!(classify("HTTP/1.1 403 Forbidden\r\n"), Answer::Silent);
        assert_eq!(
            classify("HTTP/1.1 500 Internal Server Error\r\n"),
            Answer::Silent
        );
        assert_eq!(classify("not http at all"), Answer::Silent);
        assert_eq!(classify(""), Answer::Silent);
    }

    #[test]
    fn a_silent_port_is_silent_and_a_closed_one_is_too() {
        use std::net::TcpListener;
        // Listening, never answering: the hung runtime. The probe gives up after its timeout.
        let hung = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = hung.local_addr().unwrap().port();
        let started = Instant::now();
        assert_eq!(probe(port), Answer::Silent);
        assert!(started.elapsed() < PROBE_TIMEOUT + Duration::from_secs(2));
        drop(hung);
        // Nothing listening at all.
        assert_eq!(probe(port), Answer::Silent);
    }

    #[test]
    fn a_live_health_endpoint_is_alive() {
        use std::net::TcpListener;
        let server = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = server.local_addr().unwrap().port();
        let serving = std::thread::spawn(move || {
            let (mut stream, _) = server.accept().unwrap();
            let mut request = [0u8; 256];
            let read = stream.read(&mut request).unwrap();
            assert!(String::from_utf8_lossy(&request[..read]).starts_with("GET /health HTTP/1.1"));
            stream
                .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\n{}")
                .unwrap();
        });
        assert_eq!(probe(port), Answer::Alive);
        serving.join().unwrap();
    }

    #[test]
    fn strikes_count_silence_in_a_row_and_an_answer_clears_them() {
        let beat = BEAT;
        let mut strikes = 0;
        for _ in 0..STRIKES - 1 {
            strikes = next_strikes(strikes, Answer::Silent, beat);
            assert!(!is_hung(strikes));
        }
        strikes = next_strikes(strikes, Answer::Alive, beat);
        assert_eq!(strikes, 0);
        for _ in 0..STRIKES {
            strikes = next_strikes(strikes, Answer::Silent, beat);
        }
        assert!(is_hung(strikes));
    }

    #[test]
    fn a_long_gap_between_beats_is_a_sleeping_machine_not_a_hung_runtime() {
        let strikes = next_strikes(STRIKES - 1, Answer::Silent, BEAT * 10);
        assert_eq!(strikes, 0);
        assert!(!is_hung(strikes));
    }
}
