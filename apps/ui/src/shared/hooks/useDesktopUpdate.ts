import { useEffect, useSyncExternalStore } from 'react'

import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { isDesktopRuntime } from '@localixai/kit/environment'
import { tauriInvoke, tauriListen } from '@/shared/lib/tauri'
import {
  dismissed,
  dismissUpdateNotice,
  publish,
  sharedUpdate,
  subscribe,
} from './desktopUpdateStore'

/**
 * Auto-updater state for the desktop shell, sourced from the Tauri `updater_check` command.
 * The composer's `UpdateStrip`, the titlebar's `UpdateActionButton` and Settings → System → Updates
 * all render it.
 */
export interface DesktopUpdateState {
  /** A newer version exists, and can be applied now: Tauri downloads and installs in one step
   *  (`applyUpdate`), so there is no separate "downloaded" state to wait for. */
  available: boolean
  /** User-facing line; rewritten with live percentages during a download. */
  message: string
  latestVersion: string | null
  /** The version running now, as the shell reports it. */
  currentVersion: string
  /** Release notes for `latestVersion`, when the feed carries them. */
  notes: string | null
  /**
   * An install is in flight (download, signature check, relaunch). Kept HERE and not in the
   * component that started it: that component can unmount mid-download (a different session's
   * composer, a closed Settings page), and the update must keep reading as in progress.
   */
  installing: boolean
  /**
   * How far the download is, 0–100, while one runs and its size is known; null otherwise. The
   * Event Center's "In progress" and the composer strip draw it as a bar (`message` says it too).
   */
  percent: number | null
}

declare global {
  interface Window {
    /**
     * Set by a desktop shell that provides an auto-updater bridge. Only the Tauri
     * shell does (`src-tauri/src/sidecar.rs` init script); a shell without it is
     * never polled.
     */
    __LOCALIX_UPDATER?: boolean
  }
}

/**
 * Ask a few seconds after launch, then every half hour, and again when the window comes back to
 * the front once the last answer is ten minutes old. The timer alone missed a release for hours:
 * the system slows a background window's timers, and coming back to Localix asked nothing. The
 * check is one small request answered by the shell off the page's thread; the first delay only
 * keeps it out of the first paint.
 */
const FIRST_CHECK_DELAY_MS = 3 * 1000
const POLL_MS = 30 * 60 * 1000
const RETURN_CHECK_AFTER_MS = 10 * 60 * 1000

/** When the shell was last asked, on the clock of whoever asked. */
let lastCheckedAt = Number.NEGATIVE_INFINITY

/** Shape returned by the Tauri `updater_check` Rust command. */
interface TauriUpdateStatus {
  available: boolean
  currentVersion: string
  latestVersion: string | null
  notes?: string | null
}

const availableMessage = (version: string | null) => `Update ${version} available`

/** The feed's notes, or null when it has none: before releases carried their changelog section,
 *  every manifest said only `Localix <version>`, which is no news. */
function releaseNotes(s: TauriUpdateStatus): string | null {
  const notes = s.notes?.trim()
  return notes && notes !== `Localix ${s.latestVersion}` ? notes : null
}

function fromTauri(s: TauriUpdateStatus): DesktopUpdateState {
  return {
    available: s.available,
    // Not "Up to date": the shell answers a failed check (offline, endpoint down) with the same
    // `available: false`, so that is all this can honestly claim.
    message: s.available ? availableMessage(s.latestVersion) : 'No newer version found',
    latestVersion: s.latestVersion,
    currentVersion: s.currentVersion,
    notes: releaseNotes(s),
    installing: false,
    percent: null,
  }
}

export { dismissUpdateNotice }

/** Whether this window has an updater to ask. False in a browser and in a bridge-less shell. */
export const hasDesktopUpdater = (): boolean =>
  isDesktopRuntime() && window.__LOCALIX_UPDATER === true

export type DesktopUpdateCheckResult =
  | { ok: true; state: DesktopUpdateState }
  | { ok: false; error: string }

/** Ask the shell now, and publish the answer to every reader. */
// The bridge global is a DIFFERENT global from the one `isDesktop` reads, so "we are in the
// shell" does not imply "we can call it". Both calls say so rather than acting as if they ran.
const NO_BRIDGE = { ok: false, error: 'The desktop bridge is unavailable in this window.' } as const

export async function checkDesktopUpdate(
  now: () => number = Date.now,
): Promise<DesktopUpdateCheckResult> {
  const invoke = tauriInvoke()
  if (!invoke) return NO_BRIDGE
  lastCheckedAt = now()
  try {
    const checked = fromTauri((await invoke('updater_check')) as TauriUpdateStatus)
    // A background check must not rewrite an install that is under way: it would flip the strip
    // back to "available" mid-download and invite a second click.
    const current = sharedUpdate()
    const state = current?.installing
      ? { ...checked, installing: true, message: current.message, percent: current.percent }
      : checked
    publish(state)
    return { ok: true, state }
  } catch (cause) {
    return { ok: false, error: errorMessage(cause, 'The update check failed.') }
  }
}

/**
 * Outcome of an apply attempt. `updater_install` NEVER RETURNS on success (it
 * relaunches), so an `ok: false` here is always a real failure the person needs
 * to see — the previous code discarded it and let the button re-enable, which
 * made "Update & Restart" look like a click that did not register.
 */
export type DesktopUpdateApplyResult = { ok: true } | { ok: false; error: string }

export interface DesktopUpdate {
  state: DesktopUpdateState | null
  /** Apply the downloaded update and relaunch into the new version. */
  applyUpdate: () => Promise<DesktopUpdateApplyResult>
  /** The person hid the composer notice for the version now available. */
  noticeDismissed: boolean
  /** Hide the composer notice until a newer version is available. */
  dismissNotice: () => void
}

/**
 * One `updater:progress` event from the shell ({downloaded, total}), published to every reader:
 * the percent when the size is known, and the line that says it. Returns the state it published.
 */
export function reportUpdateProgress(payload: {
  downloaded?: number
  total?: number | null
}): DesktopUpdateState | null {
  const downloaded = payload.downloaded ?? 0
  const percent =
    typeof payload.total === 'number' && payload.total > 0
      ? Math.min(100, Math.round((downloaded / payload.total) * 100))
      : null
  const message =
    percent !== null
      ? `Downloading update… ${percent}%`
      : `Downloading update… ${Math.round(downloaded / 1_000_000)} MB`
  const current = sharedUpdate()
  if (current) publish({ ...current, message, percent })
  return sharedUpdate()
}

async function applyUpdate(): Promise<DesktopUpdateApplyResult> {
  const invoke = tauriInvoke()
  if (!invoke) return NO_BRIDGE
  const before = sharedUpdate()
  if (before) publish({ ...before, installing: true, message: 'Starting update…' })
  try {
    // Downloads, installs, and relaunches into the new version (never returns on
    // success). Signature-verified against the configured pubkey natively.
    await invoke('updater_install')
    return { ok: true }
  } catch (cause) {
    // Back to a clickable "available": nothing was installed, and the person has the reason.
    const current = sharedUpdate()
    if (current) {
      publish({
        ...current,
        installing: false,
        percent: null,
        message: availableMessage(current.latestVersion),
      })
    }
    // `updater_install` is `Result<(), String>` on the Rust side: the reason a
    // download or a signature check failed is right here, and the next status
    // poll is up to an HOUR away and would only report "available" again.
    return { ok: false, error: errorMessage(cause, 'The update could not be installed.') }
  }
}

/**
 * Tracks the desktop auto-updater. `{ state: null }` outside the desktop shell (or in a shell
 * with no updater bridge), so callers can simply render nothing.
 *
 * `poll` belongs to the ONE always-mounted reader (the rail): it owns the hourly check and the
 * download-progress listener. Any other reader passes `poll: false` and sees the same state,
 * rather than starting a second poller.
 */
export function useDesktopUpdate({
  poll = true,
  now = Date.now,
}: {
  poll?: boolean
  /** The clock the return check measures the last answer's age with. */
  now?: () => number
} = {}): DesktopUpdate {
  const state = useSyncExternalStore(subscribe, sharedUpdate, () => null)
  const hiddenVersion = useSyncExternalStore(subscribe, dismissed, () => null)

  // Download progress during updater_install arrives as throttled `updater:progress`
  // events ({downloaded, total}) — surface a percent through `message` so a large
  // download (~90MB with the Bun sidecar) isn't a silent wait.
  useEffect(() => {
    if (!poll || !hasDesktopUpdater()) return
    const listen = tauriListen()
    if (!listen) return
    let unlisten: (() => void) | undefined
    let disposed = false
    void listen(
      'updater:progress',
      (e) =>
        void reportUpdateProgress(
          (e.payload ?? {}) as { downloaded?: number; total?: number | null },
        ),
    ).then((u) => {
      if (disposed) u()
      else unlisten = u
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [poll])

  useEffect(() => {
    if (!poll || !hasDesktopUpdater()) return
    // Nothing about an update is urgent at second zero, and the first paint is the
    // one the user judges the app by — so the first check waits a moment. A failed
    // background check stays quiet: only a check the person asked for reports its error.
    let interval: number | undefined
    const first = window.setTimeout(() => {
      void checkDesktopUpdate(now)
      interval = window.setInterval(() => void checkDesktopUpdate(now), POLL_MS)
    }, FIRST_CHECK_DELAY_MS)
    const onReturn = () => {
      if (document.visibilityState === 'hidden') return
      if (now() - lastCheckedAt >= RETURN_CHECK_AFTER_MS) void checkDesktopUpdate(now)
    }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      window.clearTimeout(first)
      if (interval !== undefined) window.clearInterval(interval)
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [poll, now])

  return {
    state,
    applyUpdate,
    noticeDismissed: state?.latestVersion != null && state.latestVersion === hiddenVersion,
    dismissNotice: () => dismissUpdateNotice(state?.latestVersion ?? null),
  }
}
