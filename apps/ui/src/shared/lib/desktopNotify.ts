import type { NotificationCondition } from '@localixai/notifications'
import { API_BASE_URL, apiFetch } from '@/shared/api/internal'
import { isDesktop } from '@localixai/kit/environment'
import { tauriInvoke } from './tauri'

/** Event class carried for the desktop shell (advisory; the shell may filter). */
export type DesktopNotifyKind = 'hitl' | 'run'

/**
 * Ask the desktop shell to show a NATIVE notification for a notable event (a
 * pending HITL request, a finished run). The shell rechecks window focus against
 * the centralized condition immediately before delivery, closing focus races.
 *
 * Desktop-agnostic by construction: outside the shell this is a no-op (same
 * `isDesktop` feature-detection the updater hook uses). Under the Tauri shell it
 * invokes the native `notify` command directly (the API is a separate process,
 * so there's no embedded HTTP route to POST to); the legacy `/desktop/notify`
 * POST remains as a fallback for any other embedded shell. Both paths are
 * fire-and-forget so a failure can never affect the app.
 */
export function notifyDesktop(
  kind: DesktopNotifyKind,
  title: string,
  body?: string,
  condition: NotificationCondition = 'unfocused',
): void {
  if (!isDesktop) return

  const invoke = tauriInvoke()
  if (invoke) {
    void invoke('notify', { title, body, condition }).catch(() => {
      /* shell unreachable — ignore */
    })
    return
  }

  // `apiFetch` rather than `fetch` for one invariant, not for the barrier: under
  // Tauri this line never runs, and without a shell the barrier is empty. Keeping
  // every API-origin request on one transport is what lets the architecture gate
  // state the rule without carving out exceptions.
  void apiFetch(`${API_BASE_URL}/desktop/notify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, title, body, condition }),
  }).catch(() => {
    /* shell unreachable — ignore */
  })
}
