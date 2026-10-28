import type { NotificationCondition } from '@localixai/notifications'
import { isDesktop } from '@localixai/kit/environment'
import { tauriInvoke } from './tauri'

/**
 * Ask the desktop shell to show a NATIVE notification for a notable event (a
 * pending HITL request, a finished run). The shell rechecks window focus against
 * the centralized condition immediately before delivery, closing focus races.
 *
 * Desktop-agnostic by construction: outside the shell this is a no-op (same
 * `isDesktop` feature-detection the updater hook uses). Under the Tauri shell it
 * invokes the native `notify` command directly (the API is a separate process,
 * so there's no embedded HTTP route to POST to). Fire-and-forget, so a failure can never
 * affect the app.
 */
export function notifyDesktop(
  title: string,
  body?: string,
  condition: NotificationCondition = 'unfocused',
  eventKey?: string,
): void {
  if (!isDesktop) return

  void tauriInvoke()?.('notify', {
    title,
    body,
    condition,
    ...(eventKey ? { eventKey } : {}),
  }).catch(() => {
    /* shell unreachable — ignore */
  })
}
