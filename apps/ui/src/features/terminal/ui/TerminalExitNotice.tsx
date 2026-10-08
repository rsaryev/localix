import { useState } from 'react'
import { Button } from '@localixai/kit/button'
import { closeGridTab } from '@/features/workspace-grid/model'
import type { TerminalExit } from '../model/deadTerminalTabs'
import { restartTerminalTab } from '../model/terminalTabs'

/** Outside the scrollback: the last error line stays readable and selectable. */
export function TerminalExitNotice({ paneId, exit }: { paneId: string; exit: TerminalExit }) {
  const [restarting, setRestarting] = useState(false)
  const message =
    exit.exitCode === null
      ? 'Process no longer available.'
      : `Process exited with code ${exit.exitCode}.`
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border-soft px-3 py-1.5">
      <span
        role="status"
        className={`min-w-0 flex-1 text-xs ${
          exit.exitCode !== null && exit.exitCode !== 0 ? 'text-status-error' : 'text-text-soft'
        }`}
      >
        {message}
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={restarting}
        onClick={() => {
          setRestarting(true)
          void restartTerminalTab(paneId).finally(() => setRestarting(false))
        }}
      >
        {restarting ? 'Restarting…' : 'Restart'}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => closeGridTab(paneId)}>
        Close
      </Button>
    </div>
  )
}
