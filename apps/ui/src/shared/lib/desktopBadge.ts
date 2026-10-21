import { platformCapabilities } from './platformCapabilities'

/**
 * Set the native app-icon badge to the given count, through the shell's `set_badge` command.
 *
 * The command, not the window badge API: on Windows there is no numeric badge, and the API alone
 * left the taskbar blank while the shell's command draws a red-dot overlay icon in its place. Two
 * paths to one badge were also how it ended up with two writers that overwrote each other; this is
 * now the only path, called only by `entities/chat/model/useDockBadge.ts`.
 *
 * Outside the desktop shell (the web build, SSR) the bridge is absent and this is a no-op; a
 * failure is swallowed so a badge can never affect the app. `count <= 0` clears it, and an
 * unchanged count makes no native call.
 */
let lastCount = -1

export function setDesktopBadge(count: number): void {
  const next = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  if (next === lastCount) return // dedup — no native call when unchanged
  const call = platformCapabilities().desktop.invoke('set_badge', { count: next })
  // Remember the count only once it reached a shell: a call made before the bridge existed must
  // not dedupe the same count away when the bridge shows up.
  if (!call) return
  lastCount = next
  void call.catch(() => {
    /* command absent in this shell — ignore */
  })
}
