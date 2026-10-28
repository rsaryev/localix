import { create } from 'zustand'
import { backoffMs } from '@localixai/agent/backoff'
import { backendClient } from '@/shared/api/client'
import type { UiSettingsPatch, AgentSettingsPatch, UserProfile } from '@/shared/api/contracts'
import { setSaveCleanupPrefs } from '@/shared/ui/code-editor/saveCleanup'
import { registerQuitFlush } from '@/shared/lib/quitFlush'
import { createSettingsProblemReport, rawErrorText } from './settingsProblemReport'
import { subsettingDelta, toProfileWirePatch } from './settingsProfilePatch'
import { applyProfileRead } from './settingsProfileRead'
import { currentAgentSettings, loadLocalSettings, saveLocalSettings } from './userSettings'
import type { UserSettings } from './userSettings'

/**
 * THE PROFILE SYNC STATE MACHINE — when settings are read, when they are written, and what
 * happens to a write that fails.
 *
 * It decides WHEN; it does not decide which copy of a setting wins. That is the PRECEDENCE
 * RULE, and it lives in full — with the wholesale-replace defect it exists to prevent — in
 * `settingsSyncBarrier.ts`. Read that first: the three places below that hold, drop or
 * release a pending write are only intelligible against it. The settings shape and the
 * first-paint `localStorage` cache are in `userSettings.ts`, the wire translation in
 * `settingsProfilePatch.ts`, and what a person is told when this keeps failing in
 * `settingsProblemReport.ts`.
 */
const SAVE_RETRY_BACKOFF = { baseMs: 1_000, maxMs: 30_000 }

/** Wait before re-sending a failed profile save: 1s after the first failure, doubling to 30s. */
export function saveRetryDelayMs(consecutiveFailures: number): number {
  return backoffMs(consecutiveFailures - 1, SAVE_RETRY_BACKOFF)
}

interface SettingsState {
  settings: UserSettings
  synced: boolean
  /** Last bootstrap failure. Kept visible for diagnostics while retries continue. */
  syncError: string | null
  _debounceTimer: ReturnType<typeof setTimeout> | null
  _pending: Partial<UserSettings>
  /** Top-level delta only; prevents a stale tab from replacing unrelated UI settings. */
  _pendingUiSettingsPatch: UiSettingsPatch
  /** Top-level delta only; prevents a stale tab from replacing unrelated agent settings. */
  _pendingAgentSettingsPatch: AgentSettingsPatch
}

interface SettingsActions {
  update: (patch: Partial<UserSettings>) => void
  /** Persist all currently pending profile settings before a dependent action continues. */
  flush: () => Promise<void>
  /** Fast-path barrier: `null` when no profile write can affect a dependent action. */
  flushIfPending: () => Promise<void> | null
  /** Resolve one synchronization attempt. `false` tells the bootstrapper to retry. */
  loadFromBackend: () => Promise<boolean>
  applyBackendProfile: (profile: UserProfile) => void
}

// React StrictMode deliberately mounts effects twice in development. More importantly,
// reconnect/focus paths may ask for a sync while the startup attempt is still pending.
// One process-wide flight keeps those callers on the same authoritative profile read.
let syncInFlight: Promise<boolean> | null = null

const report = createSettingsProblemReport()

export const useSettingsStore = create<SettingsState & SettingsActions>((set, get) => {
  // Keep profile writes strictly ordered: a slow earlier request must never land after a
  // newer patch and resurrect stale settings. Updates made while a write is running stay in
  // `_pending`; once their debounce comes due, `flushRequested` asks the active request to
  // hand off directly to the next one.
  let flushInFlight: Promise<void> | null = null
  let flushRequested = false
  let consecutiveSaveFailures = 0

  /**
   * Send whatever is pending to the server — but ONLY if it was computed against synced
   * state. Before the first sync, the pending patch's base is the `localStorage` cache,
   * which the server may already have superseded; sending it would push stale settings
   * over newer ones. So we HOLD it here and let `loadFromBackend`'s sync barrier decide:
   * it drops what the server supersedes and releases what survives.
   *
   * Called by the debounce timer, and again by the sync barrier once `synced` flips.
   */
  const flushPending = (): Promise<void> => {
    // HELD, not sent: before the first sync this patch's base is the `localStorage` cache.
    // Corollary of the precedence rule; the barrier releases whatever survives.
    if (!get().synced) return Promise.resolve()
    if (flushInFlight) {
      flushRequested = true
      return flushInFlight
    }
    const toFlush = get()._pending
    const uiSettingsPatch = get()._pendingUiSettingsPatch
    const agentSettingsPatch = get()._pendingAgentSettingsPatch
    const apiPatch = toProfileWirePatch(toFlush, uiSettingsPatch, agentSettingsPatch)
    if (Object.keys(apiPatch).length === 0) {
      set({ _pending: {}, _pendingUiSettingsPatch: {}, _pendingAgentSettingsPatch: {} })
      return Promise.resolve()
    }

    set({ _pending: {}, _pendingUiSettingsPatch: {}, _pendingAgentSettingsPatch: {} })
    let failed = false
    const request = backendClient
      .updateUserProfile(apiPatch)
      .then(() => {
        report.saveRecovered()
        consecutiveSaveFailures = 0
      })
      .catch((error) => {
        failed = true
        consecutiveSaveFailures++
        // Never lose an optimistic local edit on a transient PATCH failure. A
        // later snapshot for the same top-level key wins because it was computed
        // from the newer visible state; unrelated failed keys are retained too.
        set((state) => ({
          _pending: { ...toFlush, ...state._pending },
          _pendingUiSettingsPatch: {
            ...uiSettingsPatch,
            ...state._pendingUiSettingsPatch,
          },
          _pendingAgentSettingsPatch: {
            ...agentSettingsPatch,
            ...state._pendingAgentSettingsPatch,
          },
        }))
        console.warn('[settings.save] profile update failed; retrying', error)
        report.saveFailed(error)
        throw error
      })
    flushInFlight = request
    const settle = () => {
      if (flushInFlight !== request) return
      flushInFlight = null
      if (failed) {
        flushRequested = false
        const retryMs = saveRetryDelayMs(consecutiveSaveFailures)
        const existingTimer = get()._debounceTimer
        if (existingTimer) clearTimeout(existingTimer)
        const retryTimer = setTimeout(() => {
          void flushPending().catch(() => undefined)
        }, retryMs)
        set({ _debounceTimer: retryTimer })
        return
      }
      if (!flushRequested) return
      flushRequested = false
      void flushPending().catch(() => undefined)
    }
    void request.then(settle, settle)
    return request
  }

  return {
    settings: loadLocalSettings(),
    synced: false,
    syncError: null,
    _debounceTimer: null,
    _pending: {},
    _pendingUiSettingsPatch: {},
    _pendingAgentSettingsPatch: {},

    applyBackendProfile: (profile) => set((state) => applyProfileRead(state, profile)),

    loadFromBackend: () => {
      if (syncInFlight) return syncInFlight

      const request = (async (): Promise<boolean> => {
        try {
          const profile = await backendClient.getUserProfile()
          get().applyBackendProfile(profile)
        } catch (error) {
          // A FAILED GET IS NOT A SYNC (second corollary of the precedence rule): we learned
          // nothing about the server, so we cannot prove the pending patch's base isn't stale.
          // Stay unsynced and HOLD it. The app bootstrapper retries this attempt with backoff;
          // recording the error makes a packaged startup failure diagnosable.
          set({ syncError: rawErrorText(error) })
          report.syncFailed(error)
          return false
        }
        report.syncRecovered()
        // Success only: release whatever survived the barrier (a genuine un-synced local edit
        // the server had no value for). No-op when nothing is pending.
        void flushPending().catch(() => undefined)
        return true
      })()

      syncInFlight = request
      void request.finally(() => {
        if (syncInFlight === request) syncInFlight = null
      })
      return request
    },

    update: (patch) => {
      set((state) => {
        const normalizedPatch =
          patch.agentSettings === undefined
            ? patch
            : { ...patch, agentSettings: currentAgentSettings(patch.agentSettings) }
        const next = { ...state.settings, ...normalizedPatch }
        saveLocalSettings(next)

        const {
          uiSettings: nextUiSettings,
          agentSettings: nextAgentSettings,
          ...profilePatch
        } = normalizedPatch
        if (state._debounceTimer) clearTimeout(state._debounceTimer)
        const timer = setTimeout(() => {
          void flushPending().catch(() => undefined)
        }, 800)

        return {
          settings: next,
          _pending: { ...state._pending, ...profilePatch },
          _pendingUiSettingsPatch: subsettingDelta(
            state._pendingUiSettingsPatch,
            state.settings.uiSettings,
            nextUiSettings,
          ) as UiSettingsPatch,
          _pendingAgentSettingsPatch: subsettingDelta(
            state._pendingAgentSettingsPatch,
            state.settings.agentSettings,
            nextAgentSettings,
          ) as AgentSettingsPatch,
          _debounceTimer: timer,
        }
      })
    },

    flush: async () => {
      const timer = get()._debounceTimer
      if (timer) {
        clearTimeout(timer)
        set({ _debounceTimer: null })
      }

      if (!get().synced) {
        const synced = await get().loadFromBackend()
        // The raw reason is in `syncError` for diagnosis and in the Event Center for reading; the
        // sentence a caller puts on a surface must not be whatever text the failed GET carried.
        if (!synced) throw new Error('Your settings are not synchronized with the server yet.')
      }

      // A write can be active while a newer snapshot is pending. Drain both in
      // strict order so a dependent agent run observes the complete latest state.
      while (
        flushInFlight ||
        Object.keys(get()._pending).length > 0 ||
        Object.keys(get()._pendingUiSettingsPatch).length > 0 ||
        Object.keys(get()._pendingAgentSettingsPatch).length > 0
      ) {
        if (flushInFlight) await flushInFlight
        else await flushPending()
      }
    },

    flushIfPending: () =>
      flushInFlight ||
      Object.keys(get()._pending).length > 0 ||
      Object.keys(get()._pendingUiSettingsPatch).length > 0 ||
      Object.keys(get()._pendingAgentSettingsPatch).length > 0
        ? get().flush()
        : null,
  }
})

// Mirror the live `agentSettings.editorSave` on-save-cleanup flags into the
// shared code-editor holder (read by the save path in `shared/api/client.ts`),
// on initial load and on every settings change. Keeps the lowest FSD layer free
// of an upward import into this feature.
function syncSaveCleanup(s: UserSettings): void {
  const es = s.agentSettings?.editorSave
  setSaveCleanupPrefs({
    trimTrailingWhitespace: es?.trimTrailingWhitespace ?? false,
    ensureFinalNewline: es?.ensureFinalNewline ?? false,
  })
}
syncSaveCleanup(useSettingsStore.getState().settings)
useSettingsStore.subscribe((state) => syncSaveCleanup(state.settings))
// A quit inside the 800 ms debounce lost the PATCH, and the next sync let the server copy win.
registerQuitFlush('settings', () => useSettingsStore.getState().flushIfPending())
