import type { UiSettingsPatch, AgentSettingsPatch, UserProfile } from '@/shared/api/contracts'
import type { UserSettings } from './userSettings'

/**
 * PRECEDENCE RULE — which copy of a setting wins, and why.
 *
 * Three copies of every setting exist: the server profile (authoritative, shared across
 * tabs and devices), the store (what the UI shows), and a `localStorage` blob. They
 * hydrate in this order:
 *
 *   1. Module load  — the store is seeded SYNCHRONOUSLY from `localStorage` so the first
 *                     paint has fonts/keybindings/settings instead of flashing defaults.
 *   2. First paint  — `RootLayout` renders the app immediately; it does NOT gate on
 *                     `synced`. The whole UI, Settings included, is interactive right here,
 *                     on local-only state.
 *   3. Some ms later— `loadFromBackend()` resolves and the server's profile arrives.
 *
 * THE RULE:
 *
 *   **`localStorage` is a CACHE for the first paint. It is never a source of truth, and
 *   never a source of WRITES. A patch may only be flushed to the server if it was computed
 *   against SYNCED state.**
 *
 * Applied per key by `applySyncBarrier` below:
 *
 *   - The server HAS a value  → the server wins in the store, AND any pending flush for
 *     that key is DROPPED. It was computed against a base the server has just superseded,
 *     so sending it would push stale data over newer data.
 *   - The server has NO value → nothing was superseded, so the local value survives into
 *     the store AND its pending flush is KEPT, so a genuine un-synced local edit still
 *     reaches the server. (This is the case a naive "server always wins" would silently
 *     throw away — e.g. a first-run user whose settings would otherwise never persist.)
 *
 * WHY DROPPING THE SUPERSEDED PATCH LOSES NOTHING: the store already discards the local
 * value for a superseded key (the server wins), so that edit is already gone from the
 * screen. Before this barrier existed, the ONLY thing that outlived it was the pending bag,
 * which then pushed it to the server ~800ms later, behind the UI's back — and the legacy
 * profile contract permitted wholesale `agent_settings` replacement, so that stale blob
 * DESTROYED every key another tab or device had set. The store showed one thing, the server
 * held another, and the failure was silent. The barrier makes store and server agree;
 * post-sync writes additionally use top-level atomic patches (`settingsProfilePatch.ts`).
 *
 * TWO COROLLARIES the store enforces, both named at their site in `settingsStore.ts`:
 *
 *   - A flush that comes due BEFORE the first sync is HELD, not sent — its base is the
 *     cache. A successful barrier releases whatever survives.
 *   - A FAILED GET IS NOT A SYNC. If the profile GET throws we learned nothing about the
 *     server, so we cannot prove the pending patch's base isn't stale — the rule ("flush
 *     only against synced state") forbids sending it. The store stays `synced:false` and
 *     HOLDS the patch: a transient GET failure followed by a working PATCH would otherwise
 *     push the (possibly stale) `localStorage` cache over the server. Even an atomic patch
 *     must not overwrite the same top-level key from another tab using a base we never read.
 *
 * This module is pure on purpose: the rule above is the whole of what it does, so it can be
 * read — and pinned by `settingsStore.test.ts`, in both directions — without the store's
 * timers, request ordering and retry backoff in the way.
 */

/** The writes waiting to reach the server, as the store holds them. */
export interface PendingWrites {
  profile: Partial<UserSettings>
  ui: UiSettingsPatch
  agent: AgentSettingsPatch
}

export function applySyncBarrier(
  settings: UserSettings,
  pending: PendingWrites,
  profile: UserProfile,
): { settings: UserSettings; pending: PendingWrites } {
  // `take` is the single expression of the precedence rule: the server wins wherever it has
  // a value, and every key it wins is recorded as SUPERSEDED. Merge and reconciliation
  // therefore read the same decision and cannot drift apart.
  const superseded = new Set<keyof UserSettings>()
  const take = <K extends keyof UserSettings>(
    key: K,
    serverValue: UserSettings[K] | null | undefined,
  ): UserSettings[K] => {
    if (serverValue === null || serverValue === undefined) return settings[key]
    superseded.add(key)
    return serverValue
  }

  const merged: UserSettings = {
    uiSettings: take('uiSettings', profile.uiSettings) ?? {},
    agentSettings: take('agentSettings', profile.agentSettings) ?? {},
  }

  // Drop pending flushes the server just superseded: they were computed against a base that
  // no longer exists. Atomic agent-setting patches prevent unrelated key loss, but cannot
  // make a stale write to the SAME key correct. Anything the server had no value for
  // survives, and the store releases it once `synced` flips.
  const next: PendingWrites = {
    profile: { ...pending.profile },
    ui: pending.ui,
    agent: pending.agent,
  }
  for (const key of superseded) {
    delete next.profile[key]
    if (key === 'uiSettings') next.ui = {}
    if (key === 'agentSettings') next.agent = {}
  }

  return { settings: merged, pending: next }
}
