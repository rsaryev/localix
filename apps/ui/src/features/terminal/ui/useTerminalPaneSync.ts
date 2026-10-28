import { useEffect, type RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import { useGridStore } from '@/entities/workspace-grid/model'

/**
 * Keeps an attached terminal in step with its pane: input locks once the process has exited, and a
 * pane that becomes visible again re-fits and clears its unseen-activity mark.
 */
export function useTerminalPaneSync({
  paneId,
  active,
  terminalExit,
  term,
  fit,
  attention,
  onExit,
}: {
  paneId: string
  active: boolean
  terminalExit: unknown
  term: RefObject<Terminal | null>
  fit: RefObject<(() => void) | null>
  attention: RefObject<boolean>
  onExit: () => void
}) {
  useEffect(() => {
    // oxlint-disable-next-line react/immutability -- `term` is the caller's ref to the live xterm instance; setting its option is the imperative integration this hook exists for
    if (term.current) term.current.options.disableStdin = Boolean(terminalExit)
    if (terminalExit) onExit()
    fit.current?.()
  }, [terminalExit, term, fit, onExit])

  // Becoming the active (visible) tab after being display:none means the host went
  // 0×0 → sized; re-fit so the PTY matches the new viewport.
  useEffect(() => {
    if (!active) return
    requestAnimationFrame(() => fit.current?.())
    // Focusing the tab means the user is looking at it → any unseen-activity mark
    // is now seen. (The resize handler covers the shown-but-unfocused case.)
    if (attention.current) {
      // oxlint-disable-next-line react/immutability -- `attention` is the caller's ref to the tab's activity flag, which the caller's imperative xterm callbacks also read
      attention.current = false
      useGridStore.getState().setItemAttention(paneId, false)
    }
  }, [active, paneId, fit, attention])
}

/** Re-fit (and re-sync the PTY) whenever the host is resized; a shown tab clears its activity mark. */
export function observeHostResize(
  host: HTMLElement,
  sizer: { fit: () => void },
  shell: { refresh: () => void },
  attention: { isHidden: () => boolean; clear: () => void },
): ResizeObserver {
  const observer = new ResizeObserver(() => {
    // safeFit gates on real host dimensions AND schedules the (deduped,
    // debounced) PTY resize itself — a hidden/0px fire does nothing, and the
    // re-show fire (0×0 → sized) re-fits + re-syncs the PTY so a full-screen
    // app gets exactly one correct SIGWINCH to repaint by.
    sizer.fit()
    shell.refresh()
    // A hidden→shown transition resizes the host from 0×0 to real dimensions;
    // seeing the tab clears its unseen-activity mark.
    if (!attention.isHidden()) attention.clear()
  })
  observer.observe(host)
  return observer
}
