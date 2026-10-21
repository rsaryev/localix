import type { Terminal } from '@xterm/xterm'
import type { TerminalServerFrame } from '@localixai/api/client'
import { terminalTransferReadyKey, workItemTransferReady } from '@/shared/lib/workItemTransferReady'
import { closeTerminal, getTerminalLiveness, terminalStreamUrl } from '../api'
import { useGridStore } from '@/entities/workspace-grid/model'
import { workItemTransferState } from '@/shared/lib/workItemTransferState'
import { shouldClosePty } from '../model/terminalReconnect'
import { finishTerminalTabs } from '../model/deadTerminalTabs'
import { terminalOutput, resetTerminalOutput, retainTerminalOutput } from '../model/terminalOutput'

/** Socket state the pane's send/drop logic shares with the stream. */
export interface TerminalStreamLink {
  ws: WebSocket | null
  dropHandled: boolean
}

export interface TerminalStreamHandlers {
  isDisposed: () => boolean
  /** Live output arrived (raise the hidden tab's attention). */
  onOutput: () => void
  /** The PTY ended (exit or unavailable): the stream is over and needs no notice. */
  onEnded: () => void
  /** The socket opened; the pane resets its notices and re-syncs size. */
  onOpen: () => void
  /** Socket closed or errored while the pane is alive. */
  onDrop: () => void
}

/**
 * Attaches the WebSocket for `terminalId`, writing its output into `term`. Replayed scrollback is
 * retained for dead-tab display; exit/unavailable frames finish the terminal's tabs.
 */
export function openTerminalStream(
  terminalId: string,
  term: Terminal,
  link: TerminalStreamLink,
  handlers: TerminalStreamHandlers,
): void {
  let firstOutput = true
  const ws = new WebSocket(terminalStreamUrl(terminalId))
  link.ws = ws
  const end = (exit: Parameters<typeof finishTerminalTabs>[1]) => {
    link.dropHandled = true
    term.options.disableStdin = true
    handlers.onEnded()
    finishTerminalTabs(terminalId, exit)
  }
  ws.onmessage = (ev) => {
    if (typeof ev.data !== 'string') return
    let frame: TerminalServerFrame
    try {
      frame = JSON.parse(ev.data) as TerminalServerFrame
    } catch {
      return
    }
    if (frame.t === 'data') {
      if (firstOutput) {
        resetTerminalOutput(terminalId)
        firstOutput = false
      }
      retainTerminalOutput(terminalId, frame.data)
      term.write(frame.data)
      handlers.onOutput()
    } else if (frame.t === 'exit') {
      workItemTransferReady.success(terminalTransferReadyKey(terminalId))
      end({
        exitCode: frame.code,
        interactive: frame.interactive,
        command: frame.command,
        cwd: frame.cwd,
      })
    } else if (frame.t === 'unavailable') {
      workItemTransferReady.failure(
        terminalTransferReadyKey(terminalId),
        'The terminal is no longer available',
      )
      const cached = firstOutput ? terminalOutput(terminalId) : undefined
      if (cached !== undefined) term.write(cached)
      end({ exitCode: null })
    }
  }
  ws.onopen = () => {
    if (handlers.isDisposed()) return
    const readyKey = terminalTransferReadyKey(terminalId)
    if (workItemTransferReady.armed(readyKey)) {
      void getTerminalLiveness(terminalId).then((liveness) => {
        if (!handlers.isDisposed() && liveness === 'alive' && ws.readyState === WebSocket.OPEN) {
          workItemTransferReady.success(readyKey)
        }
      })
    }
    link.dropHandled = false
    handlers.onOpen()
  }
  ws.onclose = () => {
    if (handlers.isDisposed()) return // normal teardown (unmount closed the socket) → no notice
    // This also covers the FIRST attach after a reload: an unavailable stream is
    // not evidence the server-owned PTY died. Registry liveness decides
    // retry vs recovery for both initial and post-connect drops.
    handlers.onDrop()
  }
  ws.onerror = () => {
    if (!handlers.isDisposed()) handlers.onDrop()
  }
}

/** Pane unmount: close the server PTY only when this owned tab is really gone. */
export function closeOwnedPtyIfGone(paneId: string, terminalId: string, owned: boolean): void {
  // Kill the PTY ONLY when the user actually closed this tab (the WorkItem is
  // gone from the grid) and this pane owned it. A hidden/warm/reload unmount
  // keeps the item, so the server-side PTY survives to be reattached.
  if (
    shouldClosePty({
      owned,
      receiving: workItemTransferState.receiving(),
      pending: workItemTransferState.pending(paneId),
      unaccepted: workItemTransferState.unaccepted(paneId),
      stillListed: Object.values(useGridStore.getState().items).some(
        (item) => item.kind === 'terminal' && item.payload?.terminalId === terminalId,
      ),
      departed: workItemTransferState.departed(paneId),
    })
  )
    void closeTerminal(terminalId)
}
