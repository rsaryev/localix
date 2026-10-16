import { useGridStore } from '@/features/workspace-grid/model'

/**
 * Attention (tab activity dot): raised when output arrives while this pane is
 * hidden (off-screen), cleared once it's shown again. `attention` mirrors the store
 * flag so the hot per-frame `data` handler skips redundant writes, and `settled`
 * suppresses the startup/reconnect replay burst (a bell replayed when the
 * terminal starts up or reconnects must not raise attention).
 */
export function createTabAttention(
  paneId: string,
  host: HTMLElement,
  state: { attention: { current: boolean }; settled: { current: boolean } },
) {
  // A body hidden by the grid (warm/background tab) is `display:none`, so its
  // host has no offsetParent — the reliable "am I currently off-screen?" signal
  // without threading a new prop.
  const isHidden = () => host.offsetParent === null
  return {
    isHidden,
    raise: () => {
      if (state.attention.current || !state.settled.current || !isHidden()) return
      state.attention.current = true
      useGridStore.getState().setItemAttention(paneId, true)
    },
    clear: () => {
      if (!state.attention.current) return
      state.attention.current = false
      useGridStore.getState().setItemAttention(paneId, false)
    },
  }
}
