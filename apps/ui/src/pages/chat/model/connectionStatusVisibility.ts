import type { RuntimeStatus } from '@/shared/lib/runtimeReady'

/**
 * When the workspace connection indicator belongs on screen.
 *
 * It used to be `!hasHydrated` alone, which covers only the window BEFORE the
 * workspace loads. A runtime that dies AFTER that — and `sidecar.rs` deliberately
 * reports an owned runtime's exit — flipped this state to `error` with nothing
 * rendering it: the app silently stopped answering, with no explanation and no
 * way back short of quitting it. A failure the shell has already declared has to
 * be visible whenever it happens, not only during startup.
 *
 * Deliberately NOT keyed on realtime-socket liveness: a brief reconnect is normal
 * and must not flash an indicator. This fires only on a verdict the shell reached
 * about its own child process.
 */
export function shouldShowConnectionStatus(
  hasHydrated: boolean,
  runtimeState: RuntimeStatus | undefined,
): boolean {
  return !hasHydrated || runtimeState === 'error'
}
