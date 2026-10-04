import { memo, useState } from 'react'
import { SquareTerminal, Square, MonitorPlay } from 'lucide-react'

import { Spinner } from '@localixai/kit/spinner'
import { IconButton } from '@localixai/kit/icon-button'
import {
  WorkbenchListRow,
  WorkbenchListRowActions,
  WorkbenchListRowTrigger,
} from '@localixai/kit/workbench-list-row'
import { StatusDot } from '@localixai/kit/status-dot'
import { STATUS_TONE_DOT } from '@localixai/kit/status-dot'
import { CollapsibleStrip } from '@localixai/kit/collapsible-strip'
import { backendClient } from '@/shared/api/client'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { toast } from '@/shared/lib/notify'
import type { SessionWork } from '@/shared/api/contracts'
import { openPreviewFromClick } from '@/features/inspector/model/openPreview'
import { terminal as terminalBus } from '@/shared/lib/terminalBus'
import { useTerminalLiveness } from '@/features/terminal/model/useTerminalLiveness'
import { useChatStore } from '../../model/store'
import { findSessionInState } from '../../model/findSession'

const EMPTY: readonly SessionWork[] = []

/** What a monitor is seeing — the whole reason to look at its row. */
function MonitorSeen({ eventCount, lastEvent }: Pick<SessionWork, 'eventCount' | 'lastEvent'>) {
  return (
    <>
      {eventCount > 0 && (
        <span className="shrink-0 tabular-nums text-2xs text-text-faint">×{eventCount}</span>
      )}
      <span
        className="min-w-0 flex-1 truncate text-xs text-text-faint"
        title={lastEvent ?? undefined}
      >
        {lastEvent ?? 'watching…'}
      </span>
    </>
  )
}

/**
 * The session's running background work — the agent's jobs and streams, calls promoted for
 * outrunning their budget, detached sub-agents, and servers started from the preview — with Open
 * and Stop for each.
 *
 * Reads the `work` the server pushes (`session_work.updated`), so a job appears when it starts and
 * leaves when it ends. It used to poll the terminal list and could show only work that happened to
 * run in a PTY.
 *
 * Monitors are rows here too. A monitor is the one piece of agent state that explains what happens
 * next while the session looks idle — the next turn arrives with nobody typing — so its row says
 * what it is seeing (its latest event, how many so far), which is a field of its work record. It
 * used to have a strip of its own fed by its own push, which drifted from this list.
 *
 * Memoized: both props are primitives that survive a keystroke, so the composer's draft text does
 * not re-render it.
 */
export const WorkStrip = memo(function WorkStrip({
  sessionId,
  isFocused = true,
}: {
  sessionId: string | null
  /** Warm-hidden chat surfaces stay mounted but must not poll or publish singleton liveness. */
  isFocused?: boolean
}) {
  const previewUrls = useTerminalLiveness(sessionId, isFocused)
  const work = useChatStore((state) => findSessionInState(state, sessionId)?.work) ?? EMPTY
  const [stopping, setStopping] = useState<string | null>(null)
  if (!sessionId || work.length === 0) return null

  const stop = async (item: SessionWork) => {
    if (stopping) return
    setStopping(item.id)
    try {
      // A PTY is closed; a monitor is stopped by the service that runs it — a wait resumed after
      // a restart has no live tool call holding an action — and anything else through the action
      // it registered. Either way the server's next push is what removes the row.
      if (item.terminalId) await backendClient.closeTerminal(item.terminalId)
      else if (item.kind === 'monitor') await backendClient.stopSessionMonitor(sessionId, item.id)
      else await backendClient.interact(item.toolCallId, 'kill')
    } catch (error) {
      // Without this a refused Stop surfaced only as an anonymous background-task crash row.
      toast.error('Could not stop the background work', {
        description: errorMessage(error, '') || undefined,
        action: { label: 'Retry', onClick: () => void stop(item) },
      })
    } finally {
      setStopping(null)
    }
  }

  return (
    <CollapsibleStrip
      label={{ expand: 'Show background work', collapse: 'Hide background work' }}
      icon={<SquareTerminal className="size-3.5" />}
      count={work.length}
      title="Background work"
      listLabel="Background work"
      // One monitor alone is the common "waiting on CI" case, and then the row IS the
      // information — what it sees, and its Stop. A chevron would hide the only control over a
      // session that looks idle.
      defaultExpanded={work.length === 1 && work[0]!.kind === 'monitor'}
      summary={<span className="truncate font-mono">{work[0]!.label}</span>}
    >
      {work.map((item) => {
        const previewUrl = item.terminalId ? previewUrls.get(item.terminalId) : undefined
        const isStopping = stopping === item.id
        return (
          <WorkbenchListRow key={item.id} role="listitem" density="dense">
            <StatusDot className={STATUS_TONE_DOT.running} label="running" />
            <WorkbenchListRowTrigger
              onClick={() =>
                item.terminalId &&
                terminalBus.openJob({ terminalId: item.terminalId, sessionId, title: item.label })
              }
              aria-label={`${item.id}: ${item.label}`}
              className="px-0"
              title={item.terminalId ? `Open terminal — ${item.label}` : item.label}
            >
              <span className="shrink-0 font-mono text-2xs text-text-faint">{item.id}</span>
              <span className="truncate font-mono text-xs text-text-soft">{item.label}</span>
              {item.kind === 'monitor' && (
                <MonitorSeen eventCount={item.eventCount} lastEvent={item.lastEvent} />
              )}
            </WorkbenchListRowTrigger>
            <WorkbenchListRowActions aria-label={`${item.id} actions`}>
              {/* This job advertised a dev-server URL — (re)open its preview beside the chat. */}
              {previewUrl && (
                <IconButton
                  size="md"
                  aria-label="Open preview"
                  tooltip={`Open preview — ${previewUrl}`}
                  tooltipSide="top"
                  onClick={() => openPreviewFromClick(sessionId, previewUrl)}
                  className="ring-1 ring-inset ring-control-border/55 hover:bg-surface-hover"
                >
                  <MonitorPlay className="size-3" />
                </IconButton>
              )}
              <IconButton
                size="md"
                tone="danger"
                disabled={isStopping}
                aria-label={`Stop ${item.id}`}
                tooltip={isStopping ? 'Stopping…' : 'Stop'}
                tooltipSide="top"
                onClick={() => void stop(item)}
                className="ring-1 ring-inset ring-control-border/55 hover:bg-status-error/12 hover:ring-status-error/25"
              >
                {isStopping ? (
                  <Spinner size="xs" />
                ) : (
                  <Square className="size-2.5" fill="currentColor" />
                )}
              </IconButton>
            </WorkbenchListRowActions>
          </WorkbenchListRow>
        )
      })}
    </CollapsibleStrip>
  )
})
