import { useEffect, useSyncExternalStore } from 'react'

import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { loadString, saveString } from '@localixai/plugin-sdk/ui/storage'
import { isDesktop } from '@localixai/kit/environment'
import { tauriInvoke, tauriListen } from '@/shared/lib/tauri'

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
  /**
   * An install is in flight (download, signature check, relaunch). Kept HERE and not in the
   * component that started it: that component can unmount mid-download (a different session's
   * composer, a closed Settings page), and the update must keep reading as in progress.
   */
  installing: boolean
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

/** Delay the first update request past startup, then check once per hour. */
const FIRST_CHECK_DELAY_MS = 30 * 1000
const POLL_MS = 60 * 60 * 1000

/** Shape returned by the Tauri `updater_check` Rust command. */
interface TauriUpdateStatus {
  available: boolean
  currentVersion: string
  latestVersion: string | null
}

const availableMessage = (version: string | null) => `Update ${version} available`

function fromTauri(s: TauriUpdateStatus): DesktopUpdateState {
  return {
    available: s.available,
    // Not "Up to date": the shell answers a failed check (offline, endpoint down) with the same
    // `available: false`, so that is all this can honestly claim.
    message: s.available ? availableMessage(s.latestVersion) : 'No newer version found',
    latestVersion: s.latestVersion,
    currentVersion: s.currentVersion,
    installing: false,
  }
}

// ONE state for every reader. Each hook instance used to keep its own copy, so a check run from
// Settings would have left the rail button silent until its next hourly poll.
let shared: DesktopUpdateState | null = null
const listeners = new Set<() => void>()
function publish(next: DesktopUpdateState | null) {
  shared = next
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// The version whose notice the person hid. Remembered across launches, so a dismissed update does
// not come back on every start; a NEWER version is a different notice and shows again. The rail
// button and Settings still show an available update: this only quiets the composer strip.
const DISMISSED_KEY = 'localix.update.dismissed'
let dismissedVersion: string | null = null
let dismissedRead = false
function dismissed(): string | null {
  if (!dismissedRead && typeof window !== 'undefined') {
    dismissedVersion = loadString(DISMISSED_KEY)
    dismissedRead = true
  }
  return dismissedVersion
}

/** Hide the composer notice for `version`, and keep it hidden until a newer one is available. */
export function dismissUpdateNotice(version: string | null): void {
  dismissedVersion = version
  dismissedRead = true
  // A blocked store keeps it hidden for this launch, which is all that was asked.
  saveString(DISMISSED_KEY, version)
  for (const listener of listeners) listener()
}

/** Whether this window has an updater to ask. False in a browser and in a bridge-less shell. */
export const hasDesktopUpdater = (): boolean => isDesktop && window.__LOCALIX_UPDATER === true

export type DesktopUpdateCheckResult =
  | { ok: true; state: DesktopUpdateState }
  | { ok: false; error: string }

/** Ask the shell now, and publish the answer to every reader. */
// The bridge global is a DIFFERENT global from the one `isDesktop` reads, so "we are in the
// shell" does not imply "we can call it". Both calls say so rather than acting as if they ran.
const NO_BRIDGE = { ok: false, error: 'The desktop bridge is unavailable in this window.' } as const

export async function checkDesktopUpdate(): Promise<DesktopUpdateCheckResult> {
  const invoke = tauriInvoke()
  if (!invoke) return NO_BRIDGE
  try {
    const checked = fromTauri((await invoke('updater_check')) as TauriUpdateStatus)
    // A background check must not rewrite an install that is under way: it would flip the strip
    // back to "available" mid-download and invite a second click.
    const state = shared?.installing
      ? { ...checked, installing: true, message: shared.message }
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

async function applyUpdate(): Promise<DesktopUpdateApplyResult> {
  const invoke = tauriInvoke()
  if (!invoke) return NO_BRIDGE
  if (shared) publish({ ...shared, installing: true, message: 'Starting update…' })
  try {
    // Downloads, installs, and relaunches into the new version (never returns on
    // success). Signature-verified against the configured pubkey natively.
    await invoke('updater_install')
    return { ok: true }
  } catch (cause) {
    // Back to a clickable "available": nothing was installed, and the person has the reason.
    if (shared) {
      publish({ ...shared, installing: false, message: availableMessage(shared.latestVersion) })
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
export function useDesktopUpdate({ poll = true }: { poll?: boolean } = {}): DesktopUpdate {
  const state = useSyncExternalStore(
    subscribe,
    () => shared,
    () => null,
  )
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
    void listen('updater:progress', (e) => {
      const p = (e.payload ?? {}) as { downloaded?: number; total?: number | null }
      const downloaded = p.downloaded ?? 0
      const message =
        typeof p.total === 'number' && p.total > 0
          ? `Downloading update… ${Math.min(100, Math.round((downloaded / p.total) * 100))}%`
          : `Downloading update… ${Math.round(downloaded / 1_000_000)} MB`
      if (shared) publish({ ...shared, message })
    }).then((u) => {
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
    // Nothing about an update is urgent at second zero, and the launch window is
    // the one the user judges the app by — so the first check waits for it. A failed
    // background check stays quiet: only a check the person asked for reports its error.
    let interval: number | undefined
    const first = window.setTimeout(() => {
      void checkDesktopUpdate()
      interval = window.setInterval(() => void checkDesktopUpdate(), POLL_MS)
    }, FIRST_CHECK_DELAY_MS)
    return () => {
      window.clearTimeout(first)
      if (interval !== undefined) window.clearInterval(interval)
    }
  }, [poll])

  return {
    state,
    applyUpdate,
    noticeDismissed: state?.latestVersion != null && state.latestVersion === hiddenVersion,
    dismissNotice: () => dismissUpdateNotice(state?.latestVersion ?? null),
  }
}
