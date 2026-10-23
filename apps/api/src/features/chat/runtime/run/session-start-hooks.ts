/**
 * Fires the plugin `onSessionStart` lifecycle hooks — once per session, on the
 * session's first run. Each is best-effort + non-blocking (fire-and-forget, never
 * awaited) so a slow or throwing plugin hook never adds latency to the turn.
 *
 * Layer rule (same as execute-run.ts): runtime/infra; never imports
 * features/chat/service*.
 */
import type { LoadedMiniAppHook } from '../../../mini-apps/loader-contract'

export interface FireSessionStartHooksArgs {
  hooks: readonly LoadedMiniAppHook[]
  sessionId: string
  /** Set of session ids whose onSessionStart has already fired (mutated here). */
  startedSessions: Set<string>
}

export function fireSessionStartHooks({
  hooks,
  sessionId,
  startedSessions,
}: FireSessionStartHooksArgs): void {
  if (hooks.length === 0 || startedSessions.has(sessionId)) return
  startedSessions.add(sessionId)
  for (const { app, hooks: appHooks, ctx } of hooks) {
    if (!appHooks.onSessionStart) continue
    Promise.resolve(appHooks.onSessionStart(ctx)).catch((err) => {
      console.warn(
        `[mini-app:${app}] onSessionStart hook failed`,
        err instanceof Error ? err.message : err,
      )
    })
  }
}
