/**
 * Crash-proofing for terminal parser/render callbacks.
 *
 * Anything that runs INSIDE xterm's parse/write loop — an OSC 133 handler, a
 * marker/decoration `onRender` or `onclick` closure — must never throw. An
 * exception that escapes such a callback propagates out of xterm's `write()` and
 * aborts the parse loop mid-stream: the bytes already parsed render, but the rest
 * of the frame (and every later frame) never does. The pane looks frozen — output
 * shown, the next prompt never drawn — which is exactly the "typed a command, it
 * echoed, then hung forever" symptom.
 *
 * `createGuard` returns a `guard(label, fn, fallback)` wrapper: it runs `fn`, and
 * if it throws it logs ONCE per label (a pathological stream can't flood the
 * console) and returns `fallback` so a bug degrades a single affordance (a missing
 * exit-code dot / a stale sticky header) instead of bricking the whole terminal.
 * A parser callback must be crash-proof by construction, not by hoping the body is
 * exhaustive.
 */
export function createGuard() {
  const warned = new Set<string>()
  return function guard<T>(label: string, fn: () => T, fallback: T): T {
    try {
      return fn()
    } catch (err) {
      if (!warned.has(label)) {
        warned.add(label)
        console.warn(`[terminal] ${label} failed (suppressed to keep the terminal alive):`, err)
      }
      return fallback
    }
  }
}
