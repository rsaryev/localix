/**
 * "Leaving" as an explicit, testable guarantee.
 *
 * A graceful teardown is a sequence of awaits over subsystems that own foreign children —
 * PTYs, language servers, mini app backends, preview servers. Any one of them can fail to
 * settle, and an unbounded sequence turns that into a process which has stopped serving,
 * never finished its cleanup, and never exits. For a runtime that holds a cross-process
 * lease, that is the worst possible end state: it is indistinguishable from a healthy
 * owner to everyone else, and only a reboot or a deleted state directory clears it.
 *
 * So the sequence gets a deadline, and the deadline's action is to leave anyway. The
 * kernel reclaims what the teardown did not: sockets close, the SQLite lease is released,
 * file descriptors go. An incomplete teardown is a real cost — a detached grandchild may
 * outlive us — but it is a bounded one, and the alternative is not a clean shutdown, it
 * is no shutdown at all.
 *
 * The timer is `unref`'d so that ARMING it can never itself be the reason the process
 * stays alive: if everything else finishes, the runtime exits normally and the deadline
 * is simply never reached.
 */

export interface ShutdownDeadlineOptions {
  /** Total budget for the whole teardown. */
  ms: number
  /** Run just before leaving — best-effort, synchronous, never throws past this call. */
  onExpire?: () => void
  /** Seam for tests. Defaults to `process.exit(0)`. */
  exit?: (code: number) => void
}

export interface ArmedShutdownDeadline {
  /** The teardown finished in time; stand the deadline down. */
  disarm(): void
}

export function armShutdownDeadline(options: ShutdownDeadlineOptions): ArmedShutdownDeadline {
  const exit = options.exit ?? ((code: number) => process.exit(code))
  const timer = setTimeout(() => {
    try {
      options.onExpire?.()
    } catch {
      // A failed best-effort cleanup must not stop us from leaving — leaving IS the point.
    }
    exit(0)
  }, options.ms)
  // Bun/Node timers expose unref; a test's fake timer may not.
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    ;(timer as unknown as { unref(): void }).unref()
  }
  return {
    disarm() {
      clearTimeout(timer)
    },
  }
}
